// Demo Mode 데이터 생성기
// scripts/demo/articles.mjs (가상 기사) + config/scoring.json (가중치)
//   → public/data/demo/briefing.json, public/data/demo/keyword-stats.json
// 실행: npm run build:demo

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { articles, briefingMeta, keywordTotals } from './demo/articles.mjs';
import { totalScore } from '../public/js/core/scoring.js';
import { selectTop } from '../public/js/core/select.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'config/scoring.json'), 'utf8'));
const CATEGORY_ORDER = ['auto', 'mobility', 'insurance', 'ai'];

const scored = articles.map((a) => ({
  ...a,
  url: `https://example.com/mobibrief-sample/${a.id}`,
  total: totalScore(a.scores, config.criteria),
  isSample: true,
}));

const categories = {};
const ranked = [];
for (const cat of CATEGORY_ORDER) {
  const top = selectTop(
    scored.filter((a) => a.category === cat),
    { topN: config.selection.topN, ...config.selection },
  );
  categories[cat] = top.map((a) => a.id);
  ranked.push(...top);
  if (top.length !== 5) throw new Error(`${cat} 카테고리 기사가 5개가 아닙니다: ${top.length}`);
}

// 이슈에 연결된 기사 id 검증
const ids = new Set(ranked.map((a) => a.id));
for (const issue of briefingMeta.issues) {
  for (const id of issue.articleIds) if (!ids.has(id)) throw new Error(`이슈 ${issue.id} 의 기사 ${id} 없음`);
}

const briefing = {
  schemaVersion: 1,
  mode: 'demo',
  generatedAt: null, // 앱에서 열 때 '오늘' 기준으로 채워집니다
  headline: briefingMeta.headline,
  keywords: briefingMeta.keywords,
  issues: briefingMeta.issues,
  criteria: Object.fromEntries(
    Object.entries(config.criteria).map(([k, v]) => [k, { label: v.label, weight: v.weight }]),
  ),
  categories,
  articles: ranked,
};

// 키워드 14일 통계: [이전 7일 합, 최근 7일 합]을 날짜별로 결정적으로 분배
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function spread(total, n) {
  const w = Array.from({ length: n }, () => 0.5 + rand());
  const s = w.reduce((x, y) => x + y, 0);
  const out = w.map((x) => Math.floor((x / s) * total));
  let rest = total - out.reduce((x, y) => x + y, 0);
  for (let i = n - 1; rest > 0; i = (i - 1 + n) % n, rest--) out[i]++;
  return out;
}
const days = Array.from({ length: 14 }, (_, i) => ({ offset: i - 13, counts: {} }));
for (const [kw, [prev, recent]] of Object.entries(keywordTotals)) {
  const p = spread(prev, 7);
  const r = spread(recent, 7);
  [...p, ...r].forEach((v, i) => (days[i].counts[kw] = v));
}

await mkdir(path.join(root, 'public/data/demo'), { recursive: true });
await writeFile(path.join(root, 'public/data/demo/briefing.json'), JSON.stringify(briefing, null, 2));
await writeFile(
  path.join(root, 'public/data/demo/keyword-stats.json'),
  JSON.stringify({ schemaVersion: 1, mode: 'demo', relativeDays: true, days }, null, 2),
);

console.log('✅ Demo 데이터 생성 완료');
for (const cat of CATEGORY_ORDER) {
  console.log(
    `  ${cat.padEnd(9)} ` + categories[cat].map((id) => `${id}(${ranked.find((a) => a.id === id).total})`).join('  '),
  );
}
