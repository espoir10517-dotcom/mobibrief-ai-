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

// 규칙 기반 분류: 영어 약어는 단어 단위로만 인식
const { compileDictionary, matchTerms } = await import('../pipeline/rules.mjs');
const dict = JSON.parse(await readFile(path.join(root, 'config/keywords.json'), 'utf8'));
const cd = compileDictionary(dict);
ok(matchTerms('New EV subsidy announced', cd).mobility.includes('전기차'), "영어 'EV' 단어 인식");
ok(!matchTerms('Every driver should check', cd).mobility.includes('전기차'), "'Every' 안의 ev 는 인식하지 않음");
ok(matchTerms('車보험 손해율 상승', cd).auto.includes('손해율'), '한국어 키워드 인식');

// 언론사 RSS / Atom 읽기
const { parseFeed } = await import('../pipeline/collectors/rss.mjs');
const rssXml = `<?xml version="1.0"?><rss version="2.0"><channel><item><title><![CDATA[보험사, <b>자동차보험</b> 할인 특약 확대]]></title><link>https://www.example.co.kr/news/1</link><description><![CDATA[<p>손해보험사들이 자동차보험 할인 특약을 늘리고 있다.</p>]]></description><pubDate>Sun, 04 Oct 2026 09:00:00 +0900</pubDate></item><item><title>링크 없는 기사</title><pubDate>Sun, 04 Oct 2026 09:00:00 +0900</pubDate></item></channel></rss>`;
const fr = parseFeed(rssXml, { name: '테스트 피드', source: '테스트신문' });
ok(fr.length === 1 && fr[0].title === '보험사, 자동차보험 할인 특약 확대' && fr[0].source === '테스트신문', 'RSS 2.0 읽기 (CDATA·태그 정리, 링크 없는 항목 제외)');
ok(fr[0].description === '손해보험사들이 자동차보험 할인 특약을 늘리고 있다.', 'RSS 요약문 정리');
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Waymo expands robotaxi</title><link rel="alternate" href="https://ex.com/a"/><updated>2026-10-04T01:00:00Z</updated><summary>Short summary</summary></entry></feed>`;
const fa = parseFeed(atom, { name: 'Atom', lang: 'en' });
ok(fa.length === 1 && fa[0].url === 'https://ex.com/a' && fa[0].publishedAt === '2026-10-04T01:00:00.000Z', 'Atom 피드 읽기');
const { fetchText } = await import('../pipeline/lib/http.mjs');
const saveFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]), { headers: { 'content-type': 'text/xml; charset=EUC-KR' } });
ok((await fetchText('https://x.example')) === '한글', 'EUC-KR 인코딩 피드 한글 변환');
globalThis.fetch = saveFetch;

// 지난 주간 브리핑 보관
{
  const { saveWeek, weekOf } = await import('../pipeline/weeks.mjs');
  const { readdir: rd, readFile: rf } = await import('node:fs/promises');
  ok(weekOf('2026-10-04') === '2026-09-28' && weekOf('2026-10-05') === '2026-10-05' && weekOf('2026-10-11') === '2026-10-05', '주 계산: 월~일 한 주');
  const out = await mkdtemp(path.join(tmpdir(), 'mb-weeks-'));
  const mk = (date) => ({ date, periodStart: date, periodEnd: date, generatedAt: `${date}T00:00:00Z`, analysis: 'ai', headline: date, issues: [{ title: 'i' }], categories: { auto: ['a'] }, articles: [{ id: 'a' }], ai: { costUSD: 1 } });
  await saveWeek(out, mk('2026-10-04'));
  await saveWeek(out, mk('2026-10-12'));
  await saveWeek(out, mk('2026-10-13')); // 같은 주 재발행 → 교체
  const idx = JSON.parse(await rf(path.join(out, 'weeks/index.json'), 'utf8')).weeks;
  ok(idx.map((w) => w.date).join() === '2026-10-13,2026-10-04', '같은 주에 다시 발행하면 마지막 것만 남김 · 최신순');
  ok(!(await rd(path.join(out, 'weeks'))).includes('2026-10-12.json'), '교체된 주의 파일은 정리');
  ok(!('ai' in JSON.parse(await rf(path.join(out, 'weeks/2026-10-13.json'), 'utf8'))), '보관본에 AI 사용량 기록 제외');
  for (const d of ['2026-10-19', '2026-10-26']) await saveWeek(out, mk(d), { keepWeeks: 3 });
  const idx2 = JSON.parse(await rf(path.join(out, 'weeks/index.json'), 'utf8')).weeks;
  ok(idx2.length === 3 && !(await rd(path.join(out, 'weeks'))).includes('2026-10-04.json'), '보관 기간 지난 주는 자동 삭제');
}

console.log(fails ? `\n❌ ${fails}개 항목 실패\n` : '\n🎉 수집기 점검 통과\n');
process.exit(fails ? 1 : 0);
