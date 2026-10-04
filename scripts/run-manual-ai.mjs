// 수동 AI 실행: data/manual-ai/ 의 평가·선정·요약 결과를 실제 AI 응답처럼 넣어
// 운영 파이프라인(검증·근거 확인 포함)을 그대로 거쳐 브리핑을 만듭니다.
// 실행:
//   node scripts/run-manual-ai.mjs                     → 이번 주 브리핑 (data/manual-ai/*.json)
//   node scripts/run-manual-ai.mjs --week 2026-09-27   → 지난 주 브리핑 (data/manual-ai/2026-09-27/*.json)
//      그 날짜까지의 7일치로 그 주 월요일에 발행했던 것처럼 만들어 '지난 브리핑'과 검색 보관함에만 넣습니다.
//      (지금 앱에 보이는 이번 주 브리핑은 건드리지 않음)
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBriefing } from '../pipeline/build-briefing.mjs';
import { saveWeek } from '../pipeline/weeks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wi = process.argv.indexOf('--week');
const week = wi > 0 ? process.argv[wi + 1] : null;
if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error('--week 날짜는 YYYY-MM-DD');
const srcDir = path.join(root, 'data/manual-ai', week || '');
const load = async (f) => JSON.parse(await readFile(path.join(srcDir, f), 'utf8'));
const evaluate = await load('evaluate.json');
const edit = await load('edit.json');
const write = await load('write.json');

const usage = { calls: 0, input: 0, output: 0, costUSD: 0 };
const client = {
  provider: 'claude-manual',
  usage,
  async callJson({ system, user }) {
    usage.calls++;
    const batch = JSON.parse(user);
    if (system.includes('평가하라')) {
      const ids = new Set(batch.map((a) => a.id));
      // 목록에 없는 기사 = AI 가 걸러낸 기사 (keep:false)
      return { items: [...evaluate.items.filter((i) => ids.has(i.id)), ...batch.filter((a) => !evaluate.items.some((i) => i.id === a.id)).map((a) => ({ id: a.id, keep: false }))] };
    }
    if (system.includes('편집장')) return edit;
    const ids = new Set(batch.map((a) => a.id));
    return { items: write.items.filter((i) => ids.has(i.id)) };
  },
};

if (!week) {
  const b = await buildBriefing({ clientOverride: client });
  console.log(`\n✅ 발행 데이터 생성: ${b.analysis} · TOP ${Object.values(b.categories).map((x) => x.length).join('/')} · 기사 ${b.articles.length}건`);
} else {
  const live = path.join(root, 'public/data/live');
  const tmp = await mkdtemp(path.join(tmpdir(), 'mb-week-'));
  const b = await buildBriefing({ clientOverride: client, asOf: week, outDir: tmp, env: {}, log: () => {} });
  if (b.analysis !== 'ai') throw new Error(`AI 편집이 적용되지 않았습니다: ${b.aiError || ''}`);
  const scoring = JSON.parse(await readFile(path.join(root, 'config/scoring.json'), 'utf8'));
  await saveWeek(live, b, { keepWeeks: scoring.briefing?.historyWeeks || 52 });

  // 검색 보관함: 그 주 AI 요약 기사로 교체·추가 (이번 주 기사는 그대로)
  const archive = JSON.parse(await readFile(path.join(live, 'archive.json'), 'utf8'));
  const current = JSON.parse(await readFile(path.join(live, 'briefing.json'), 'utf8'));
  const currentIds = new Set(current.articles.map((a) => a.id));
  const byId = new Map(archive.articles.map((a) => [a.id, a]));
  let added = 0;
  for (const a of b.articles) {
    if (a.analysis !== 'ai' || currentIds.has(a.id)) continue;
    const { rank, reason, ...rest } = a; // 순위는 그 주 화면에서만 의미 있음
    byId.set(a.id, rest);
    added++;
  }
  await writeFile(path.join(live, 'archive.json'), JSON.stringify({ ...archive, articles: [...byId.values()] }));
  console.log(`✅ 지난 브리핑 추가: ${b.periodStart} ~ ${b.periodEnd} · AI 편집 · TOP ${Object.values(b.categories).map((x) => x.length).join('/')} · 보관함 AI 요약 ${added}건 반영 (AI 호출 ${usage.calls}회)`);
}
