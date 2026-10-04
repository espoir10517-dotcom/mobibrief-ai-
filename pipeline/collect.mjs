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

export async function runCollect({ now = new Date(), log = console.log, outDir = path.join(root, 'data/collected') } = {}) {
  const cfg = JSON.parse(await readFile(path.join(root, 'config/sources.json'), 'utf8'));
  const useNaver = naver.isConfigured();
  const stats = { google: { ok: 0, fail: 0, items: 0 }, naver: { ok: 0, fail: 0, items: 0, enabled: useNaver } };
  const errors = [];

  const jobs = [];
  for (const [category, q] of Object.entries(cfg.categories)) {
    for (const query of q.ko || []) {
      jobs.push({ category, query, run: () => google.collect(query, 'ko', cfg.perQueryLimit), provider: 'google' });
      if (useNaver) jobs.push({ category, query, run: () => naver.collect(query, cfg.perQueryLimit), provider: 'naver' });
    }
    for (const query of q.en || []) {
      jobs.push({ category, query, run: () => google.collect(query, 'en', cfg.perQueryLimit), provider: 'google' });
    }
  }
  log(`🔎 검색 ${jobs.length}건 실행 (구글뉴스${useNaver ? ' + 네이버' : ', 네이버 키 없음 → 건너뜀'})`);

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
        for (const it of items) raw.push({ ...it, category: job.category });
      } catch (e) {
        stats[job.provider].fail++;
        errors.push(`${job.provider} "${job.query}": ${e.message}`);
      }
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const since = now.getTime() - cfg.lookbackHours * 3600000;
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
      .sort((a, b) => b.coverage - a.coverage || b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, cfg.maxCandidatesPerCategory);
    perCategory[category] = list.length;
    articles.push(...list);
  }

  const date = kstDate(now);
  const out = {
    schemaVersion: 1,
    date,
    collectedAt: now.toISOString(),
    stats: { searches: jobs.length, ...stats, raw: raw.length, fresh: fresh.length, clusters: clusters.length, candidates: articles.length, perCategory },
    errors: errors.slice(0, 30),
    articles,
  };

  const dir = outDir;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${date}.json`), JSON.stringify(out, null, 2));
  await writeFile(path.join(dir, 'latest.json'), JSON.stringify(out, null, 2));

  log(`📥 수집 ${raw.length}건 → 최근 ${cfg.lookbackHours}시간 ${fresh.length}건 → 중복 묶은 뒤 ${clusters.length}개 이슈`);
  log(`🗂  분야별 후보: ${Object.entries(perCategory).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  log(`   구글뉴스 성공 ${stats.google.ok}/실패 ${stats.google.fail} · 네이버 ${useNaver ? `성공 ${stats.naver.ok}/실패 ${stats.naver.fail}` : '미사용'}`);
  if (errors.length) log(`⚠️  실패한 검색 ${errors.length}건 (예: ${errors[0]})`);
  log(`💾 data/collected/${date}.json 저장`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await runCollect();
  if (!out.articles.length) {
    console.error('❌ 수집된 기사가 없습니다. 인터넷 연결이나 API 키를 확인하세요.');
    process.exit(1);
  }
  // 상위 몇 건 미리보기
  for (const a of out.articles.slice(0, 5)) console.log(`   · [${a.category}] ${a.title} — ${a.source} (${a.coverage}곳 보도)`);
}
