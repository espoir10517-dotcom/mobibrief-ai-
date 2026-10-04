// 수동 AI 실행: data/manual-ai/ 의 평가·선정·요약 결과를 실제 AI 응답처럼 넣어
// 운영 파이프라인(검증·근거 확인 포함)을 그대로 거쳐 브리핑을 만듭니다.
// 실행: node scripts/run-manual-ai.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBriefing } from '../pipeline/build-briefing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (f) => JSON.parse(await readFile(path.join(root, 'data/manual-ai', f), 'utf8'));
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
const b = await buildBriefing({ clientOverride: client });
console.log(`\n✅ 발행 데이터 생성: ${b.analysis} · TOP ${Object.values(b.categories).map((x) => x.length).join('/')} · 기사 ${b.articles.length}건`);
