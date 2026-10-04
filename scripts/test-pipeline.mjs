// 뉴스 수집기 점검 (인터넷 없이 샘플 데이터로 실행): npm run test:pipeline

import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRss } from '../pipeline/collectors/google-news.mjs';
import { parseResponse } from '../pipeline/collectors/naver-news.mjs';
import { dedupe } from '../pipeline/dedupe.mjs';
import { outletFromUrl } from '../pipeline/lib/outlets.mjs';
import { stripHtml, kstDate } from '../pipeline/lib/text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = (f) => readFile(path.join(root, 'scripts/fixtures', f), 'utf8');
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${msg}`);
  if (!cond) fails++;
};

console.log('\n뉴스 수집기 점검\n');

const rss = await fx('google-news-ko.xml');
const g = parseRss(rss, { lang: 'ko', query: '자동차보험' });
ok(g.length === 5, `구글뉴스 RSS 기사 5건 읽기 (${g.length})`);
ok(g[0].source === '테스트경제' && !g[0].title.endsWith('테스트경제'), '제목 끝 언론사 꼬리표 분리');
ok(g[0].publishedAt === '2026-10-04T03:00:00.000Z', '발행시각 변환');

const nv = parseResponse(await fx('naver-news.json'), { query: '자동차보험' });
ok(nv.length === 2, `네이버 응답 2건 읽기 (${nv.length})`);
ok(nv[0].title === '"車보험 손해율 상승"…자동차보험 보험료 인상 압력 커져', `네이버 제목 태그·특수문자 정리 (${nv[0].title})`);
ok(nv[0].source === '한국경제' && nv[1].source === '조선비즈', `원문 주소로 언론사 추정 (${nv[0].source}, ${nv[1].source})`);
ok(!/<b>|&apos;/.test(nv[0].description), '요약문 태그 제거');
ok(nv[0].publishedAt === '2026-10-04T04:20:00.000Z', '한국시간(+0900) → 표준시 변환');

ok(outletFromUrl('https://m.yna.co.kr/view/AKR123') === '연합뉴스', '모바일 주소도 언론사 인식');
ok(outletFromUrl('https://unknown-site.example/a') === 'unknown-site.example', '모르는 언론사는 도메인 표시');
ok(stripHtml('A &amp;lt;b&amp;gt;B') === 'A B' || stripHtml('A <b>B</b>') === 'A B', 'HTML 제거');
ok(kstDate(new Date('2026-10-04T16:00:00Z')) === '2026-10-05', '한국시간 날짜 계산 (UTC 16시 = 다음날 01시)');

// 중복 묶기: 손해율 기사 3건(구글 2 + 네이버 1)은 하나의 이슈로
const items = [...g, ...nv].map((x) => ({ ...x, category: 'auto' }));
items.push({ ...nv[1], category: 'insurance' });
const clusters = dedupe(items, { threshold: 0.5 });
const lossRatio = clusters.find((c) => c.title.includes('손해율'));
ok(lossRatio && lossRatio.coverage === 3, `같은 사건 3개 언론사 → 1개 이슈로 묶음 (보도 ${lossRatio?.coverage}곳)`);
ok(lossRatio?.provider === 'naver-news' && lossRatio.description, '대표 기사는 요약문이 있는 기사로 선택');
const ai = clusters.find((c) => c.title.includes('생성형'));
ok(ai && ai.categoryHints.includes('auto') && ai.categoryHints.includes('insurance'), '여러 분야에서 검색된 기사는 분야 후보 모두 기록');
ok(clusters.every((c) => /^[0-9a-f]{12}$/.test(c.id)), '기사마다 고유 id');

// 전체 실행: 네트워크를 샘플로 대체
const realFetch = globalThis.fetch;
const nvJson = await fx('naver-news.json');
const empty = '<rss><channel></channel></rss>';
globalThis.fetch = async (url) => {
  const u = String(url);
  const body = u.includes('openapi.naver.com') ? nvJson : u.includes('hl=ko') ? rss : empty;
  return new Response(body, { status: 200 });
};
process.env.NAVER_CLIENT_ID = 'test';
process.env.NAVER_CLIENT_SECRET = 'test';
const { runCollect } = await import('../pipeline/collect.mjs');
const outDir = await mkdtemp(path.join(tmpdir(), 'mb-collect-'));
const out = await runCollect({ now: new Date('2026-10-04T07:00:00Z'), log: () => {}, outDir });
globalThis.fetch = realFetch;
ok(out.stats.naver.enabled && out.stats.naver.ok > 0 && out.stats.google.ok > 0, '구글뉴스·네이버 모두 호출');
ok(!out.articles.some((a) => a.title.includes('오래된 기사')), '36시간 지난 기사 제외');
ok(!out.articles.some((a) => a.title.includes('[포토]')), '[포토] 등 제외 패턴 적용');
ok(out.articles.length > 0 && out.articles.length <= 4 * 40, `후보 ${out.articles.length}건, 분야별 상한 이하`);
const saved = JSON.parse(await readFile(path.join(outDir, `${out.date}.json`), 'utf8'));
ok(saved.articles.length === out.articles.length && saved.date === '2026-10-04', '날짜별 파일 저장');
ok(saved.articles.every((a) => a.title && a.source && a.url && a.publishedAt && a.category), '저장 항목: 제목·언론사·발행시각·링크·분야');
ok(!JSON.stringify(saved).includes('NAVER_CLIENT'), '결과 파일에 API 키 없음');

console.log(fails ? `\n❌ ${fails}개 항목 실패\n` : '\n🎉 수집기 점검 통과\n');
process.exit(fails ? 1 : 0);
