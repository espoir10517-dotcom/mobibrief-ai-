// 뉴스 수집 실행 파일 (Phase 2)
// 실행: npm run collect
// 결과: data/collected/YYYY-MM-DD.json (한국시간 기준 날짜), data/collected/latest.json
//
// 순서: 분야별 검색어로 수집 → 오래된 기사·사진/인사/부고 제외 → 중복 묶기 → 분야별 후보 상위 N개만 남김
// 남긴 후보만 Phase 3의 AI 평가로 넘어가므로, 검색어를 늘려도 AI 비용은 늘지 않습니다.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as google from './collectors/google-news.mjs';
import * as naver from './collectors/naver-news.mjs';
import * as rss from './collectors/rss.mjs';
import { compileDictionary, relevantHits } from './rules.mjs';
import { dedupe } from './dedupe.mjs';
import { kstDate } from './lib/text.mjs';
import { sleep } from './lib/http.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// PC에서 실행할 때 .env 파일 읽기 (GitHub Actions 에서는 비밀값이 환경변수로 들어옴)
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// 옵션 (지난 기사 채우기용): dateRange = 구글뉴스 날짜 지정, lookbackHours = 기간 덮어쓰기,
// rssCache = 언론사 RSS 를 한 번만 받아 여러 날짜에 나눠 쓰기, backfill = true 면 latest.json 을 건드리지 않음
export async function runCollect({ now = new Date(), log = console.log, outDir = path.join(root, 'data/collected'), dateRange, lookbackHours, rssCache, backfill = false, perQueryLimit } = {}) {
  const cfg = JSON.parse(await readFile(path.join(root, 'config/sources.json'), 'utf8'));
  const useNaver = naver.isConfigured();
  const compiled = compileDictionary(JSON.parse(await readFile(path.join(root, 'config/keywords.json'), 'utf8')));
  const stats = { google: { ok: 0, fail: 0, items: 0 }, naver: { ok: 0, fail: 0, items: 0, enabled: useNaver }, rss: { ok: 0, fail: 0, items: 0, kept: 0 } };
  const feedResults = [];
  const errors = [];

  const jobs = [];
  for (const [category, q] of Object.entries(cfg.categories)) {
    for (const query of q.ko || []) {
      jobs.push({ category, query, run: () => google.collect(query, 'ko', perQueryLimit || cfg.perQueryLimit, dateRange), provider: 'google' });
      if (useNaver && !dateRange) jobs.push({ category, query, run: () => naver.collect(query, cfg.perQueryLimit), provider: 'naver' });
    }
    for (const query of q.en || []) {
      jobs.push({ category, query, run: () => google.collect(query, 'en', perQueryLimit || cfg.perQueryLimit, dateRange), provider: 'google' });
    }
  }
  for (const feed of cfg.rssFeeds || []) {
    jobs.push({
      feed,
      query: feed.name,
      provider: 'rss',
      run: async () => {
        if (!rssCache) return rss.collect(feed);
        if (!rssCache.has(feed.url)) rssCache.set(feed.url, rss.collect(feed).catch((e) => e));
        const r = await rssCache.get(feed.url);
        if (r instanceof Error) throw r;
        return r;
      },
    });
  }
  log(`🔎 검색·피드 ${jobs.length}건 실행 (구글뉴스${useNaver ? ' + 네이버' : ', 네이버 키 없음 → 건너뜀'})`);

  const raw = [];
  const CONCURRENCY = 4;
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        const items = await job.run();
        stats[job.provider].ok++;
        stats[job.provider].items += items.length;
        if (job.provider === 'rss') {
          // 언론사 섹션 피드: 키워드 사전에 해당하는 기사만, 가장 많이 맞는 분야로
          let kept = 0;
          for (const it of items) {
            const hits = relevantHits(it.title, it.description, compiled);
            const best = Object.entries(hits).sort((a, b) => b[1].length - a[1].length)[0];
            if (best && best[1].length) {
              raw.push({ ...it, category: best[0], topical: Boolean(job.feed.topical) });
              kept++;
            } else if (job.feed.topical) {
              // 보험·자동차·AI 전문지는 키워드가 없어도 모아서 AI 가 판단
              raw.push({ ...it, category: job.feed.category, topical: true });
              kept++;
            }
          }
          stats.rss.kept += kept;
          feedResults.push({ name: job.feed.name, url: job.feed.url, ok: true, items: items.length, kept });
        } else {
          for (const it of items) raw.push({ ...it, category: job.category });
        }
      } catch (e) {
        stats[job.provider].fail++;
        errors.push(`${job.provider} "${job.query}": ${e.message}`);
        if (job.provider === 'rss') feedResults.push({ name: job.feed.name, url: job.feed.url, ok: false, error: e.message });
      }
      await sleep(dateRange ? 400 : 250);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const since = now.getTime() - (lookbackHours || cfg.lookbackHours) * 3600000;
  const exclude = (cfg.excludeTitlePatterns || []).map((p) => (p.startsWith('(?i)') ? new RegExp(p.slice(4), 'i') : new RegExp(p)));
  const blockedSources = new Set((cfg.excludeSources || []).map((s) => s.toLowerCase()));
  const fresh = raw.filter(
    (it) => Date.parse(it.publishedAt) >= since && Date.parse(it.publishedAt) <= now.getTime() + 3600000 && !exclude.some((re) => re.test(it.title)) && !blockedSources.has(String(it.source).toLowerCase()),
  );
  const clusters = dedupe(fresh, { threshold: cfg.duplicateTitleSimilarity });

  // 분야별 후보: 여러 언론사가 보도한 이슈 → 최신 순
  const articles = [];
  const perCategory = {};
  for (const category of Object.keys(cfg.categories)) {
    const list = clusters
      .filter((c) => c.category === category)
      .sort(
        (a, b) =>
          b.coverage - a.coverage ||
          (b.lang === 'ko') - (a.lang === 'ko') ||
          Boolean(b.description) - Boolean(a.description) ||
          b.publishedAt.localeCompare(a.publishedAt),
      )
      .slice(0, cfg.maxCandidatesPerCategory);
    perCategory[category] = list.length;
    articles.push(...list);
  }

  const date = kstDate(now);
  const out = {
    schemaVersion: 1,
    date,
    ...(backfill ? { backfill: true } : {}),
    collectedAt: now.toISOString(),
    stats: { searches: jobs.length, ...stats, raw: raw.length, fresh: fresh.length, clusters: clusters.length, candidates: articles.length, perCategory },
    errors: errors.slice(0, 30),
    feeds: feedResults,
    articles,
  };

  const dir = outDir;
  await mkdir(dir, { recursive: true });
  // 실행 기록은 항상 남기고(문제 확인용), 기사가 없으면 기존 결과를 덮어쓰지 않음
  if (!backfill) await writeFile(path.join(dir, 'last-run.json'), JSON.stringify({ date, collectedAt: out.collectedAt, stats: out.stats, errors: out.errors, feeds: feedResults }, null, 2));
  if (articles.length) {
    await writeFile(path.join(dir, `${date}.json`), JSON.stringify(out, null, 2));
    if (!backfill) await writeFile(path.join(dir, 'latest.json'), JSON.stringify(out, null, 2));
  }

  log(`📥 수집 ${raw.length}건 → 최근 ${cfg.lookbackHours}시간 ${fresh.length}건 → 중복 묶은 뒤 ${clusters.length}개 이슈`);
  log(`🗂  분야별 후보: ${Object.entries(perCategory).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  log(`   구글뉴스 성공 ${stats.google.ok}/실패 ${stats.google.fail} · 언론사 RSS 성공 ${stats.rss.ok}/실패 ${stats.rss.fail} (관련 기사 ${stats.rss.kept}건) · 네이버 ${useNaver ? `성공 ${stats.naver.ok}/실패 ${stats.naver.fail}` : '미사용'}`);
  if (errors.length) log(`⚠️  실패한 검색 ${errors.length}건 (예: ${errors[0]})`);
  log(`💾 data/collected/${date}.json 저장`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let out;
  try {
    out = await runCollect();
  } catch (e) {
    console.error('❌ 수집 중 오류:', e);
    await mkdir(path.join(root, 'data/collected'), { recursive: true });
    await writeFile(path.join(root, 'data/collected/last-run.json'), JSON.stringify({ collectedAt: new Date().toISOString(), fatal: String(e?.stack || e) }, null, 2));
    process.exit(1);
  }
  if (!out.articles.length) {
    console.error('❌ 수집된 기사가 없습니다. 인터넷 연결이나 API 키를 확인하세요.');
    process.exit(1);
  }
  // 상위 몇 건 미리보기
  for (const a of out.articles.slice(0, 5)) console.log(`   · [${a.category}] ${a.title} — ${a.source} (${a.coverage}곳 보도)`);
}
