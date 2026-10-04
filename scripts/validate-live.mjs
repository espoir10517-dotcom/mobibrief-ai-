// 발행 데이터 점검: npm run validate
// 앱에 올라갈 실제 뉴스 데이터에 빈 값·깨진 링크·중복이 없는지 확인합니다.
// 치명적인 문제(제목·링크 없음, 분야가 비어 있음 등)는 실패 처리해서 잘못된 데이터가 배포되지 않게 합니다.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2] || path.join(root, 'public/data/live');
const read = async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8'));
const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const isUrl = (u) => /^https?:\/\/[^\s]+$/.test(u || '');
const isDate = (d) => Number.isFinite(Date.parse(d));

const b = await read('briefing.json');
const archive = await read('archive.json');
const stats = await read('keyword-stats.json');
const byId = new Map(b.articles.map((a) => [a.id, a]));

if (!b.headline?.trim()) err('한 줄 브리핑(headline)이 비어 있음');
if (!isDate(b.generatedAt)) err('업데이트 시각이 올바르지 않음');
if ((b.keywords || []).length < 3) warn(`핵심 키워드가 ${b.keywords?.length || 0}개뿐`);
if ((b.issues || []).length < 3) warn(`핵심 이슈가 ${b.issues?.length || 0}개뿐`);
for (const it of b.issues || []) {
  if (!it.title?.trim() || !it.summary?.trim()) err(`이슈 '${it.id}' 제목/설명 비어 있음`);
  if (!it.articleIds?.length) err(`이슈 '${it.title}' 관련 기사 없음`);
  for (const id of it.articleIds || []) if (!byId.has(id)) err(`이슈 '${it.title}' 의 기사 ${id} 를 찾을 수 없음`);
}

const topN = b.topN || 5;
const seenTop = new Set();
let withSummary = 0;
let topTotal = 0;
for (const [cat, ids] of Object.entries(b.categories || {})) {
  if (!ids.length) err(`${cat} 분야 기사가 하나도 없음`);
  else if (ids.length < topN) warn(`${cat} 분야 ${ids.length}/${topN}건`);
  const titles = new Set();
  ids.forEach((id, i) => {
    const a = byId.get(id);
    if (!a) return err(`${cat} 의 기사 ${id} 없음`);
    topTotal++;
    if (seenTop.has(id)) err(`기사 ${id} 가 여러 분야 TOP 에 중복`);
    seenTop.add(id);
    if (titles.has(a.title)) err(`${cat} TOP 에 같은 제목 중복: ${a.title}`);
    titles.add(a.title);
    if (a.rank !== i + 1) warn(`${cat} ${i + 1}위 기사 순위 표시가 ${a.rank}`);
    if (a.oneLiner?.trim()) withSummary++;
  });
}
for (const a of b.articles) {
  const where = `기사 '${(a.title || a.id).slice(0, 30)}'`;
  if (!a.title?.trim()) err(`${a.id} 제목 없음`);
  if (!a.source?.trim()) err(`${where} 언론사 없음`);
  if (!isUrl(a.url)) err(`${where} 원문 링크 이상: ${a.url}`);
  if (!isDate(a.publishedAt)) err(`${where} 발행시각 이상`);
  if (!(a.keywords || []).length) warn(`${where} 키워드 없음`);
  if (typeof a.total !== 'number') err(`${where} 점수 없음`);
  if (a.analysis === 'ai' && !(a.summary3 || []).length) warn(`${where} AI 요약 비어 있음`);
  for (const s of a.sources || []) if (!isUrl(s.url)) warn(`${where} 함께 보도 링크 이상 (${s.name})`);
}

const aIds = new Set();
for (const a of archive.articles || []) {
  if (aIds.has(a.id)) err(`보관함 id 중복: ${a.id}`);
  aIds.add(a.id);
  if (!a.title || !isUrl(a.url)) err(`보관함 기사 제목/링크 이상: ${a.id}`);
}
if (!aIds.size) err('검색 보관함이 비어 있음');
if (!(stats.days || []).length) warn('HOT TOPIC 통계가 비어 있음');

console.log(`\n발행 데이터 점검 (${b.periodStart || b.date} ~ ${b.periodEnd || b.date}, ${b.analysis === 'ai' ? 'AI' : '규칙'} 방식)`);
console.log(`  TOP 기사 ${topTotal}건 · 요약문 있음 ${withSummary}건 · 보관함 ${aIds.size}건 · 통계 ${stats.days.length}일`);
for (const w of warns) console.log(`  ⚠️  ${w}`);
for (const e of errors) console.log(`  ❌ ${e}`);
console.log(errors.length ? `\n❌ 치명적 문제 ${errors.length}건 — 배포하지 않습니다\n` : '\n✅ 배포 가능\n');
process.exit(errors.length ? 1 : 0);
