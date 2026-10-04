// AI 편집국 점검 (실제 AI 대신 가짜 응답으로 전 과정 실행): npm run test:ai
// 실제 키 없이도 평가 → 선정 → 요약 → 근거 검증 → 발행 파일 생성이 맞게 동작하는지 확인합니다.

import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { numbersSupported, aiBriefing } from '../pipeline/ai/editor.mjs';
import { extractJson, detectProvider, createClient } from '../pipeline/ai/client.mjs';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${msg}`);
  if (!cond) fails++;
};
console.log('\nAI 편집국 점검 (가짜 AI 응답)\n');

// 근거 검증
ok(numbersSupported('손해율이 85%를 넘었다', '자동차보험 손해율 85% 돌파'), '기사에 있는 숫자는 통과');
ok(!numbersSupported('손해율이 92%를 넘었다', '자동차보험 손해율 85% 돌파'), '기사에 없는 숫자는 걸러냄');
ok(numbersSupported('5천만원 편취', '13차례 고의사고로 5천만원 보험금 편취'), '한글 단위가 붙은 숫자 인식');
ok(extractJson('설명입니다 ```json\n{"a":1}\n```').a === 1, 'AI 응답에서 JSON 추출');
ok(detectProvider({ provider: 'auto' }, {}) === null, '키가 없으면 AI 사용 안 함');
ok(detectProvider({ provider: 'auto' }, { OPENAI_API_KEY: 'x' }) === 'openai', 'OpenAI 키만 있으면 GPT 사용');
ok(detectProvider({ provider: 'auto' }, { ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' }) === 'anthropic', '둘 다 있으면 설정 순서대로');

// 가짜 후보 12건 (분야별 3건 + 무관한 기사)
const now = Date.parse('2026-10-04T08:00:00Z');
const mk = (id, category, title, description = '') => ({ id, category, title, description, source: '테스트일보', url: `https://ex.com/${id}`, publishedAt: '2026-10-04T05:00:00Z', lang: 'ko', coverage: 1, sources: [], keywords: ['키워드'], oneLiner: '' });
const today = [
  mk('a1', 'auto', '자동차보험 손해율 85% 돌파', '주요 손보사 자동차보험 손해율이 85%를 넘었다.'),
  mk('a2', 'auto', '경상환자 보상 기준 개정', '금융당국이 경상환자 보상 기준을 바꾼다.'),
  mk('a3', 'auto', '프로야구 개막전 결과', '스포츠 기사'),
  mk('m1', 'mobility', '자율주행 사고 책임 법안 발의'),
  mk('m2', 'mobility', '로보택시 서비스 확대'),
  mk('i1', 'insurance', '손보사 3분기 실적 발표', '손해보험사들이 3분기 실적을 발표했다.'),
  mk('i2', 'insurance', '금융권 해킹 긴급 점검'),
  mk('t1', 'ai', '새 멀티모달 모델 공개', '이미지와 영상을 함께 이해하는 모델이 공개됐다.'),
  mk('t2', 'ai', 'AI 교육 업무협약 체결'),
  mk('t3', 'ai', 'Robot learns new skill', 'A robot learned a skill.'),
];
today[9].lang = 'en';

let calls = { evaluate: 0, edit: 0, write: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const sys = body.system;
  const items = JSON.parse(body.messages[0].content);
  let out;
  if (sys.includes('평가하라')) {
    calls.evaluate++;
    out = { items: items.map((a) => ({ id: a.id, keep: !['a3', 't2'].includes(a.id), category: a.hint, importance: 80, relevance: a.id.startsWith('a') ? 95 : 70, impact: 75, novelty: a.id === 't1' ? 95 : 60, reason: '테스트', keywords: ['테스트'] })) };
  } else if (sys.includes('편집장')) {
    calls.edit++;
    out = { top: { auto: ['a1', 'a2', 'a3', 'zzz'], mobility: ['m1'], insurance: ['i1', 'i2'], ai: ['t1', 't3'] }, issues: [{ title: '자동차보험 손해율 비상', summary: '손해율이 높아졌다.', articleIds: ['a1', 'nope'] }], headline: '자동차보험 손해율이 오르고 있습니다.', keywords: ['손해율', '자율주행', '해킹', '멀티모달', '경상환자'] };
  } else {
    calls.write++;
    out = {
      items: items.map((a) => ({
        id: a.id,
        titleKo: a.lang === 'en' ? '로봇이 새 기술을 배우다' : a.title,
        oneLiner: a.id === 'a1' ? '손해율이 85%를 넘었다.' : `${a.title} 소식이다.`,
        summary3: a.id === 'a1' ? ['손해율이 85%를 넘었다.', '보험료가 7% 오를 전망이다.'] : ['요약 문장.'],
        keyPoints: ['핵심'],
        whyImportant: '업무에 중요하다.',
        perspective: '보험 관점 의미.',
        watchNext: ['후속 발표'],
        limitedInfo: false,
      })),
    };
  }
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 1000, output_tokens: 300 } }), { status: 200 });
};

const logs = [];
const client = createClient({ provider: 'auto', anthropic: { fastModel: 'm', deepModel: 'm', prices: { m: [1, 5] } }, maxCallsPerRun: 25, maxCostPerRunUSD: 1 }, { ANTHROPIC_API_KEY: 'test' }, { log: (m) => logs.push(m) });
const criteria = JSON.parse(await readFile(new URL('../config/scoring.json', import.meta.url), 'utf8')).criteria;
const res = await aiBriefing({ today, client, editorial: '편집 기준', criteria, cfg: { evaluateBatchSize: 30, editorCandidatesPerCategory: 12, writeBatchSize: 5 }, recencyOf: () => 90, log: (m) => logs.push(m) });

ok(calls.evaluate === 1 && calls.edit === 1 && calls.write >= 1, `평가→선정→요약 순서로 호출 (평가 ${calls.evaluate}, 선정 ${calls.edit}, 요약 ${calls.write})`);
ok(!res.categories.auto.includes('a3'), 'AI가 걸러낸 스포츠 기사는 선정 안 됨');
ok(!res.categories.auto.includes('zzz'), '존재하지 않는 id 는 무시');
ok(!res.categories.ai.includes('t2'), 'MOU·교육성 기사 제외');
ok(res.issues.length === 1 && res.issues[0].articleIds.join() === 'a1', '핵심 이슈의 잘못된 근거 id 제거');
const a1 = res.articles.find((a) => a.id === 'a1');
ok(a1.summary3.length === 1 && a1.summary3[0].includes('85%'), `기사에 없는 숫자(7%) 문장 자동 삭제 → ${JSON.stringify(a1.summary3)}`);
ok(a1.analysis === 'ai' && a1.rank === 1 && a1.whyImportant, 'AI 분석 결과·순위 반영');
const t3 = res.articles.find((a) => a.id === 't3');
ok(t3.title === '로봇이 새 기술을 배우다' && t3.originalTitle === 'Robot learns new skill', '영어 기사 제목 번역 + 원제 보존');
const m1 = res.articles.find((a) => a.id === 'm1');
ok(m1.limitedInfo === true, '요약문 없는 기사는 정보 제한 표시');
ok(client.usage.calls === calls.evaluate + calls.edit + calls.write && client.usage.costUSD > 0, `사용량·예상 비용 기록 ($${client.usage.costUSD.toFixed(4)})`);

// 키가 틀렸을 때: 재시도 없이 실패 → 규칙 방식으로 대신 발행
globalThis.fetch = async () => new Response('{"error":"invalid x-api-key"}', { status: 401 });
const { buildBriefing } = await import('../pipeline/build-briefing.mjs');
const outDir = await mkdtemp(path.join(tmpdir(), 'mb-brief-'));
const b = await buildBriefing({ log: () => {}, env: { ANTHROPIC_API_KEY: 'wrong' }, outDir });
ok(b.analysis === 'rules' && b.aiError?.includes('401'), '키 오류 시 규칙 방식으로 자동 대체 발행');
const saved = JSON.parse(await readFile(path.join(outDir, 'briefing.json'), 'utf8'));
ok(!JSON.stringify(saved).includes('wrong'), '발행 파일에 API 키 없음');
globalThis.fetch = realFetch;

// 키가 없을 때: 이번 주에 만든 AI 브리핑은 유지, 오래된 AI 브리핑은 규칙 방식으로 새로 발행
const { writeFile: wf } = await import('node:fs/promises');
const fresh = { analysis: 'ai', generatedAt: new Date(Date.now() - 86400000).toISOString(), marker: 'keep' };
await wf(path.join(outDir, 'briefing.json'), JSON.stringify(fresh));
const k1 = await buildBriefing({ log: () => {}, env: {}, outDir });
ok(k1.marker === 'keep', '키 없음: 이번 주 AI 브리핑 유지');
await wf(path.join(outDir, 'briefing.json'), JSON.stringify({ ...fresh, generatedAt: new Date(Date.now() - 8 * 86400000).toISOString() }));
const k2 = await buildBriefing({ log: () => {}, env: {}, outDir });
ok(!k2.marker && k2.analysis === 'rules', '키 없음: 지난주 AI 브리핑은 새 뉴스로 교체 (앱 멈춤 방지)');

console.log(fails ? `\n❌ ${fails}개 항목 실패\n` : '\n🎉 AI 편집국 점검 통과\n');
process.exit(fails ? 1 : 0);
