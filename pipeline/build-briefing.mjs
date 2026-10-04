// 앱에 보여줄 오늘의 브리핑 만들기 (AI 없이 규칙 기반)
// 실행: npm run build:briefing   (수집 후 실행)
// 입력: data/collected/YYYY-MM-DD.json (날짜별 수집 결과)
// 출력: public/data/live/briefing.json   오늘의 TOP 5 · 핵심 이슈 3 · 핵심 키워드
//       public/data/live/archive.json    최근 14일 기사 (검색·MY NEWS 용)
//       public/data/live/keyword-stats.json  날짜별 키워드 등장 수 (HOT TOPIC 용)

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totalScore } from '../public/js/core/scoring.js';
import { similarity } from '../public/js/core/select.js';
import { compileDictionary, relevantHits, scoreArticle } from './rules.mjs';
import { normalizeTitle, bigrams, jaccard } from './lib/text.mjs';
import { createClient } from './ai/client.mjs';
import { aiBriefing } from './ai/editor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const CATS = ['auto', 'mobility', 'insurance', 'ai'];

function pickCategory(a, hits) {
  if (hits[a.category]?.length) return a.category;
  for (const c of a.categoryHints || []) if (hits[c]?.length) return c;
  const best = CATS.map((c) => [c, hits[c]?.length || 0]).sort((x, y) => y[1] - x[1])[0];
  return best[1] > 0 ? best[0] : null; // 어느 분야 키워드에도 해당하지 않으면 제외
}

// 같은 분야에서 제목이 꽤 비슷하고 주요 키워드가 같으면 같은 이슈로 묶음
// (언론사마다 제목을 다르게 쓰는 경우를 잡기 위한 2차 묶기)
// 제목의 고유한 단어 (조사 떼고 2글자 이상, 흔한 단어 제외)
const JOSA = /(으로|에서|에게|까지|부터|하고|이다|에는|과의|와의|은|는|이|가|을|를|에|의|도|로|와|과|만)$/;
const COMMON = new Set(['ai', '속보', '단독', '종합', '오늘', '내년', '올해', '위해', '대한', '관련', '확대', '추진', '강화', '본격', '국내', '글로벌', 'the', 'and', 'for', 'with']);
function titleWords(title) {
  const set = new Set();
  for (let w of String(title).toLowerCase().split(/[^\p{L}\p{N}+]+/u)) {
    if (w.length > 2) w = w.replace(JOSA, '');
    if (w.length >= 2 && !COMMON.has(w) && !/^\d+$/.test(w)) set.add(w);
  }
  return set;
}

function sameIssue(a, b) {
  if (a.category !== b.category) return false;
  const sim = jaccard(a._bg, b._bg);
  if (sim >= 0.35) return true;
  // 주요 키워드 하나 이상 + 고유 단어 2개 이상 겹치면 같은 이슈 (예: 'LG유플러스, 구글…크리에이터' / 'LG U+·구글…크리에이터')
  const sharedKw = a.keywords.some((k) => k !== 'AI' && b.keywords.includes(k));
  let shared = 0;
  for (const w of a._words) if (b._words.has(w)) shared++;
  if (sharedKw && shared >= 2) return true;
  const ka = [...a.keywords].sort().join('|');
  const kb = [...b.keywords].sort().join('|');
  return a.keywords.length >= 2 && ka === kb && sim >= 0.12;
}

function mergeIssues(items) {
  const groups = [];
  for (const it of items) {
    const g = groups.find((g) => g.some((x) => sameIssue(x, it)));
    if (g) g.push(it);
    else groups.push([it]);
  }
  return groups.map((g) => {
    if (g.length === 1) return g[0];
    // 대표: 요약문 있는 기사 → 한국어 → 보도 언론사 많은 기사
    const rep = [...g].sort(
      (a, b) => (b.description ? 1 : 0) - (a.description ? 1 : 0) || (b.lang === 'ko' ? 1 : 0) - (a.lang === 'ko' ? 1 : 0) || b.coverage - a.coverage,
    )[0];
    const outlets = new Map();
    for (const x of g) for (const s of x.sources?.length ? x.sources : [{ name: x.source, url: x.url, publishedAt: x.publishedAt }]) if (!outlets.has(s.name)) outlets.set(s.name, s);
    return { ...rep, coverage: outlets.size, sources: [...outlets.values()].slice(0, 8), publishedAt: g.map((x) => x.publishedAt).sort().pop() };
  });
}

function analyze(file, { compiled, criteria, prevTitles, recencyHours }) {
  const now = Date.parse(file.collectedAt);
  const tagged = [];
  for (const a of file.articles) {
    const hits = relevantHits(a.title, a.description, compiled);
    const category = pickCategory(a, hits);
    if (!category) continue;
    const keywords = [...new Set([...(hits[category] || []), ...CATS.flatMap((c) => (c === category ? [] : hits[c] || []))])].slice(0, 4);
    tagged.push({ ...a, category, keywords, _hits: hits, _bg: bigrams(normalizeTitle(a.title)), _words: titleWords(a.title) });
  }
  const out = [];
  for (const a of mergeIssues(tagged)) {
    const isNew = !prevTitles.some((p) => jaccard(p, a._bg) >= 0.5);
    const scores = scoreArticle(a, { hits: a._hits, compiled, now, isNew, recencyHours });
    const desc = (a.description || '').trim();
    out.push({
      id: a.id,
      category: a.category,
      title: a.title,
      source: a.source,
      url: a.url,
      publishedAt: a.publishedAt,
      lang: a.lang,
      coverage: a.coverage || 1,
      sources: a.sources || [],
      keywords: a.keywords,
      scores,
      total: totalScore(scores, criteria),
      // 검색 API가 제공한 요약문(있을 때만). AI가 쓴 문장이 아닙니다.
      oneLiner: desc ? (desc.length > 110 ? `${desc.slice(0, 108)}…` : desc) : '',
      description: desc,
      analysis: 'rules',
    });
  }
  return out;
}

// AI 없이 고르는 TOP N: 이미 뽑힌 기사들이 다루지 않은 주제(키워드)를 가진 기사를 우선 선택하고,
// 자리가 남으면 점수순으로 채움. 비슷한 내용의 기사가 TOP 5를 독차지하지 않게 합니다.
function diverseTop(list, n) {
  const sorted = [...list].sort((a, b) => b.total - a.total);
  const picked = [];
  const covered = new Set();
  for (const a of sorted) {
    if (picked.length >= n) break;
    const own = a.keywords.length ? a.keywords : [a.title];
    if (own.some((k) => !covered.has(k)) && !picked.some((p) => similarity(p, a) >= 0.5)) {
      picked.push(a);
      own.forEach((k) => covered.add(k));
    }
  }
  for (const a of sorted) {
    if (picked.length >= n) break;
    if (!picked.includes(a) && !picked.some((p) => similarity(p, a) >= 0.5)) picked.push(a);
  }
  return picked.sort((a, b) => b.total - a.total).map((a, i) => ({ ...a, rank: i + 1 }));
}

export async function buildBriefing({ log = console.log, env = process.env, outDir = path.join(root, 'public/data/live') } = {}) {
  const scoring = await readJson(path.join(root, 'config/scoring.json'));
  const dict = await readJson(path.join(root, 'config/keywords.json'));
  const compiled = compileDictionary(dict);
  const dir = path.join(root, 'data/collected');
  const dates = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!dates.length) throw new Error('수집된 데이터가 없습니다. 먼저 npm run collect 를 실행하세요.');

  const files = {};
  for (const f of dates.slice(-30)) files[f] = await readJson(path.join(dir, f));
  const recent = Object.keys(files);

  // 날짜별 분석 (새로움 판단: 그 이전 3일치 제목과 비교)
  const analyzed = {};
  for (let i = 0; i < recent.length; i++) {
    const prevTitles = recent
      .slice(Math.max(0, i - 3), i)
      .flatMap((f) => files[f].articles.map((a) => bigrams(normalizeTitle(a.title))));
    analyzed[recent[i]] = analyze(files[recent[i]], { compiled, criteria: scoring.criteria, prevTitles });
  }

  const latestKey = recent[recent.length - 1];
  const latest = files[latestKey];
  const bcfg = scoring.briefing || { cadence: 'daily', windowDays: 1 };
  const weekly = bcfg.cadence === 'weekly';
  const topN = scoring.selection.topN || 5;
  const recencyHours = weekly ? [24, 72, 120] : [6, 12, 24];

  // 주간 발행: 최근 windowDays 일 동안 수집한 기사를 합쳐서 한 번에 분석 (같은 기사·같은 이슈는 묶음)
  let today;
  let periodStart = latest.date;
  if (weekly) {
    const endT = Date.parse(`${latest.date}T00:00:00Z`);
    const inWindow = (f) => endT - Date.parse(`${files[f].date}T00:00:00Z`) < (bcfg.windowDays || 7) * 86400000;
    const windowKeys = recent.filter(inWindow);
    const beforeKeys = recent.filter((f) => !inWindow(f)).slice(-7);
    periodStart = files[windowKeys[0]].date;
    const byId = new Map();
    for (const f of windowKeys) for (const a of files[f].articles) byId.set(a.id, a);
    const prevTitles = beforeKeys.flatMap((f) => files[f].articles.map((a) => bigrams(normalizeTitle(a.title))));
    today = analyze({ collectedAt: latest.collectedAt, articles: [...byId.values()] }, { compiled, criteria: scoring.criteria, prevTitles, recencyHours });
    log(`🗓  주간 브리핑: ${periodStart} ~ ${latest.date} (${windowKeys.length}일치 수집분)`);
  } else {
    today = analyzed[latestKey];
  }

  // 분야별 TOP N (점수 + 주제 다양성)
  const categories = {};
  const chosen = new Map();
  for (const c of CATS) {
    const top = diverseTop(today.filter((a) => a.category === c), topN);
    categories[c] = top.map((a) => a.id);
    for (const a of top) chosen.set(a.id, a);
  }

  // 꼭 알아야 할 3가지: 가장 많은 언론사가 보도한 이슈 (비슷한 주제는 하나만)
  const byCoverage = [...today].sort((a, b) => b.coverage - a.coverage || b.total - a.total);
  const issueLeads = [];
  for (const a of byCoverage) {
    if (issueLeads.length >= 3) break;
    if (issueLeads.some((x) => similarity(x, a) >= 0.25 || (x.keywords[0] && x.keywords[0] === a.keywords[0] && x.category === a.category))) continue;
    issueLeads.push(a);
  }
  const issues = issueLeads.map((lead) => {
    const related = today
      .filter((a) => a.id !== lead.id && a.category === lead.category && a.keywords.some((k) => lead.keywords.includes(k)))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    for (const a of [lead, ...related]) if (!chosen.has(a.id)) chosen.set(a.id, a);
    const names = lead.sources.map((s) => s.name).slice(0, 3);
    return {
      id: `issue-${lead.id}`,
      title: lead.title,
      summary:
        lead.coverage > 1
          ? `${names.join(', ')}${lead.coverage > 3 ? ' 등' : ''} ${lead.coverage}개 언론사가 보도한 이슈입니다.`
          : `${lead.source}가 보도한 이슈입니다.`,
      articleIds: [lead.id, ...related.map((a) => a.id)],
      sources: lead.sources,
    };
  });

  // 핵심 키워드: 기간 내 기사에서 가장 많이 등장한 키워드 5개
  const kwCount = {};
  for (const a of today) for (const k of a.keywords) kwCount[k] = (kwCount[k] || 0) + 1;
  const keywords = Object.entries(kwCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  const lead = issues[0];
  let briefing = {
    schemaVersion: 1,
    mode: 'live',
    analysis: 'rules',
    generatedAt: latest.collectedAt,
    date: latest.date,
    cadence: weekly ? 'weekly' : 'daily',
    periodStart,
    periodEnd: latest.date,
    topN,
    headline: lead ? lead.title : '오늘 수집된 주요 뉴스가 없습니다.',
    headlineNote: lead ? lead.summary : '',
    keywords,
    issues,
    criteria: Object.fromEntries(Object.entries(scoring.criteria).map(([k, v]) => [k, { label: v.label, weight: v.weight }])),
    categories,
    articles: [...chosen.values()],
  };

  // ───────── AI 키가 있으면 AI 편집국 방식으로 교체 (실패하면 위의 규칙 방식 결과를 그대로 사용) ─────────
  let aiResult = null;
  const aiCfg = await readJson(path.join(root, 'config/ai.json'));
  const client = createClient(aiCfg, env, { log });
  if (client) {
    try {
      const editorial = await readFile(path.join(root, 'config/editorial.md'), 'utf8');
      const now = Date.parse(latest.collectedAt);
      const recencyOf = (a) => {
        const h = (now - Date.parse(a.publishedAt)) / 3600000;
        return h <= recencyHours[0] ? 100 : h <= recencyHours[1] ? 90 : h <= recencyHours[2] ? 75 : 60;
      };
      // 비용 제한: 분야별 규칙 점수 상위 후보만 AI 에게 보냄
      const perCat = aiCfg.aiCandidatesPerCategory || 60;
      const candidates = CATS.flatMap((c) => today.filter((a) => a.category === c).sort((a, b) => b.total - a.total).slice(0, perCat));
      aiResult = await aiBriefing({ today: candidates, client, editorial, criteria: scoring.criteria, cfg: { ...aiCfg, topN }, recencyOf, period: weekly ? '이번 주' : '오늘', log });
      briefing = {
        ...briefing,
        analysis: 'ai',
        headline: aiResult.headline || briefing.headline,
        headlineNote: '',
        keywords: aiResult.keywords.length ? aiResult.keywords : briefing.keywords,
        issues: aiResult.issues.length ? aiResult.issues : briefing.issues,
        categories: aiResult.categories,
        articles: aiResult.articles,
        ai: { provider: client.provider, calls: client.usage.calls, inputTokens: client.usage.input, outputTokens: client.usage.output, estCostUSD: Number(client.usage.costUSD.toFixed(4)) },
      };
      log(`💰 AI 사용량: 호출 ${client.usage.calls}회 · 입력 ${client.usage.input} / 출력 ${client.usage.output} 토큰 · 약 $${client.usage.costUSD.toFixed(3)}`);
    } catch (e) {
      log(`⚠️ AI 처리 실패 → 규칙 방식으로 대신 발행합니다: ${e.message}`);
      briefing.aiError = String(e.message).slice(0, 200);
      if (client.usage.calls) briefing.ai = { provider: client.provider, calls: client.usage.calls, estCostUSD: Number(client.usage.costUSD.toFixed(4)) };
    }
  }

  // 키워드 통계 (날짜별 등장 기사 수)
  // 채워 넣은(backfill) 날짜는 수집 방식이 달라 추세 비교에서 제외
  const days = recent.filter((f) => !files[f].backfill).map((f) => {
    const counts = {};
    for (const a of analyzed[f]) for (const k of a.keywords) counts[k] = (counts[k] || 0) + 1;
    return { date: files[f].date, counts };
  });

  // 검색용 보관함: 최근 14일, 같은 기사는 가장 최근 것만
  const archiveMap = new Map();
  for (const f of recent.slice(-(bcfg.archiveDays || 14))) {
    for (const a of analyzed[f]) {
      const { scores, description, sources, ...light } = a;
      archiveMap.set(a.id, { ...light, oneLiner: light.oneLiner.slice(0, 90) });
    }
  }
  // AI 결과가 있으면: 오늘 기사 중 AI가 걸러낸 기사는 보관함에서 빼고, 선정 기사는 AI 제목·요약으로 교체
  if (aiResult) {
    for (const e of aiResult.evaluated) if (!e.keep) archiveMap.delete(e.id);
    for (const a of aiResult.articles) {
      archiveMap.set(a.id, { id: a.id, category: a.category, title: a.title, originalTitle: a.originalTitle, source: a.source, url: a.url, publishedAt: a.publishedAt, lang: a.lang, coverage: a.coverage, keywords: a.keywords, total: a.total, oneLiner: (a.oneLiner || '').slice(0, 90), analysis: a.analysis });
    }
  }

  // 보관함이 너무 커지지 않도록 점수 상위만 (휴대폰 데이터 절약)
  if (archiveMap.size > (bcfg.archiveMaxArticles || 1500)) {
    const keep = [...archiveMap.values()].sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, bcfg.archiveMaxArticles || 1500);
    archiveMap.clear();
    for (const a of keep) archiveMap.set(a.id, a);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'briefing.json'), JSON.stringify(briefing));
  await writeFile(path.join(outDir, 'keyword-stats.json'), JSON.stringify({ schemaVersion: 1, mode: 'live', days }));
  await writeFile(path.join(outDir, 'archive.json'), JSON.stringify({ schemaVersion: 1, articles: [...archiveMap.values()] }));

  log(`📰 ${latest.date} 브리핑 (${briefing.analysis === 'ai' ? 'AI 편집' : '규칙 기반'}): 후보 ${today.length}건 중 TOP ${CATS.map((c) => `${c} ${briefing.categories[c].length}`).join(' · ')}`);
  log(`🔥 핵심 이슈: ${briefing.issues.map((i) => i.title.slice(0, 30)).join(' / ')}`);
  log(`🏷  핵심 키워드: ${briefing.keywords.join(', ')}`);
  log(`🗄  보관함 ${archiveMap.size}건 · 키워드 통계 ${days.length}일`);
  return briefing;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildBriefing();
}
