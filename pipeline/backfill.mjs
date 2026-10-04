// 지난 기사 채우기 (처음 시작할 때 1회용)
// 실행: node pipeline/backfill.mjs --days 7
// - 구글뉴스는 날짜를 지정해 그날 기사만 검색 (after:/before:)
// - 언론사 RSS 는 최근 기사만 제공하므로 한 번 받아서 발행일에 맞는 날짜로 나눠 넣음
// - 이미 그 날짜 파일이 있으면 건너뜀 (정상 수집분을 덮어쓰지 않음)
// - 채워 넣은 날짜 파일에는 backfill: true 표시 → 트렌드(↑↓) 계산에서는 제외 (수집 방식이 달라 비교가 공정하지 않음)

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCollect } from './collect.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.indexOf('--days');
const days = Math.min(14, Math.max(1, Number(arg > 0 ? process.argv[arg + 1] : 7) || 7));

const ymd = (d) => d.toISOString().slice(0, 10);
const todayKst = new Date(Date.now() + 9 * 3600000); // 한국 날짜 계산용 (UTC 필드로 읽음)
const rssCache = new Map();
let made = 0;

for (let i = days; i >= 1; i--) {
  const day = new Date(Date.UTC(todayKst.getUTCFullYear(), todayKst.getUTCMonth(), todayKst.getUTCDate() - i));
  const date = ymd(day);
  if (existsSync(path.join(root, 'data/collected', `${date}.json`))) {
    console.log(`⏭  ${date} 이미 있음 — 건너뜀`);
    continue;
  }
  const next = new Date(day.getTime() + 86400000);
  // 그날 한국시간 23:59:59 를 기준 시각으로, 24시간 범위만 남김
  const now = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59) - 9 * 3600000);
  console.log(`\n📅 ${date} 채우는 중`);
  const out = await runCollect({
    now,
    dateRange: { after: ymd(new Date(day.getTime() - 86400000)), before: ymd(next) },
    lookbackHours: 24,
    rssCache,
    backfill: true,
    perQueryLimit: 25,
  });
  if (out.articles.length) made++;
}
console.log(`\n✅ 지난 기사 채우기 완료: ${made}일치 생성`);
