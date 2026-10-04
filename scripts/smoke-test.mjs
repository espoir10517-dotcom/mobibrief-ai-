// 기본 점검: npm test
// 데이터 형식, 카테고리별 TOP 5, 점수 계산, 트렌드 계산, 화면 파일 존재 여부를 확인합니다.

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totalScore } from '../public/js/core/scoring.js';
import { selectTop, similarity } from '../public/js/core/select.js';
import { computeTrends } from '../public/js/core/trend.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8'));
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${msg}`);
  if (!cond) fails++;
};

console.log('\nMobiBrief AI 점검\n');

for (const f of ['public/index.html', 'public/js/app.js', 'public/css/app.css', 'public/manifest.webmanifest', 'public/sw.js', 'public/icons/icon-192.png', 'public/icons/icon-512.png']) {
  ok(await access(path.join(root, f)).then(() => true, () => false), `파일 존재: ${f}`);
}

const config = await json('config/scoring.json');
const b = await json('public/data/demo/briefing.json');
const s = await json('public/data/demo/keyword-stats.json');

const REQUIRED = ['id', 'category', 'title', 'source', 'url', 'oneLiner', 'summary3', 'keyPoints', 'whyImportant', 'perspective', 'watchNext', 'keywords', 'scores', 'total'];
ok(b.articles.length === 20, `Demo 기사 20건 (${b.articles.length})`);
ok(new Set(b.articles.map((a) => a.id)).size === b.articles.length, '기사 id 중복 없음');
ok(b.articles.every((a) => REQUIRED.every((k) => a[k] != null)), '모든 기사에 필수 항목 존재');
ok(b.articles.every((a) => a.isSample === true), '모든 Demo 기사에 SAMPLE 표시');
ok(b.articles.every((a) => a.summary3.length === 3), '3줄 요약은 정확히 3줄');
ok(b.articles.every((a) => a.keywords.length >= 2 && a.keywords.length <= 4), '키워드 2~4개');
for (const cat of ['auto', 'mobility', 'insurance', 'ai']) {
  ok(b.categories[cat]?.length === 5, `${cat} TOP 5`);
}
ok(b.articles.every((a) => a.total === totalScore(a.scores, config.criteria)), '종합점수 = 가중치 계산과 일치');
ok(b.issues.length === 3 && b.issues.every((i) => i.articleIds.every((id) => b.articles.some((a) => a.id === id))), '핵심 이슈 3개, 관련 기사 연결 정상');
ok(b.keywords.length === 5, '오늘의 핵심 키워드 5개');

// 다양성 선택: 거의 같은 기사 두 개 중 하나만 뽑혀야 함
const dupA = { id: 'x1', title: '로보택시 서비스 확대 발표', keywords: ['로보택시', '자율주행'], total: 95 };
const dupB = { id: 'x2', title: '로보택시 서비스 확대 발표', keywords: ['로보택시', '자율주행'], total: 94 };
const other = { id: 'x3', title: '보험사 AI 상담 도입', keywords: ['보험', 'AI'], total: 70 };
const top = selectTop([dupA, dupB, other], { topN: 2, ...config.selection });
ok(top.map((a) => a.id).join() === 'x1,x3', `중복 기사 제외 후 다양성 선정 (${top.map((a) => a.id)}) · 유사도 ${similarity(dupA, dupB).toFixed(2)}`);

// 트렌드: 14일 미만이면 화살표 없음
const days = s.days.map((d, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, counts: d.counts }));
const t14 = computeTrends(days);
const t5 = computeTrends(days.slice(-5));
ok(t14.canTrend && t14.items.some((i) => i.direction === 'up') && t14.items.some((i) => i.direction === 'down'), '14일 데이터: 상승/하락 계산');
ok(!t5.canTrend && t5.items.every((i) => i.direction === null), '5일 데이터: 상승/하락 표시 안 함');

console.log(fails ? `\n❌ ${fails}개 항목 실패\n` : '\n🎉 모든 점검 통과\n');
process.exit(fails ? 1 : 0);
