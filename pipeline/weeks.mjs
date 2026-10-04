// 지난 주간 브리핑 보관
// - 발행할 때마다 그 주 브리핑 전체를 weeks/<발행일>.json 으로 저장하고, 목록(weeks/index.json)을 갱신합니다.
// - 같은 주(월~일, 한국시간)에 여러 번 발행하면 마지막 것만 남깁니다.
// - 최근 keepWeeks 주만 보관하고, 오래된 파일은 지웁니다.

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

// 'YYYY-MM-DD' → 그 주 월요일 'YYYY-MM-DD'
export function weekOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0 … 일=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function summaryOf(b) {
  const counts = {};
  for (const [c, ids] of Object.entries(b.categories || {})) counts[c] = ids.length;
  return {
    date: b.date,
    week: weekOf(b.date),
    periodStart: b.periodStart || b.date,
    periodEnd: b.periodEnd || b.date,
    generatedAt: b.generatedAt,
    analysis: b.analysis,
    headline: b.headline || '',
    issues: (b.issues || []).slice(0, 3).map((i) => i.title),
    counts,
  };
}

export async function saveWeek(outDir, briefing, { keepWeeks = 52 } = {}) {
  if (!briefing?.date || briefing.mode === 'demo') return null;
  const dir = path.join(outDir, 'weeks');
  await mkdir(dir, { recursive: true });
  let index = [];
  try {
    index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8')).weeks || [];
  } catch {
    /* 처음 */
  }
  const entry = summaryOf(briefing);
  // 같은 주의 이전 발행본은 교체
  index = index.filter((w) => w.week !== entry.week && w.date !== entry.date);
  index.push(entry);
  index.sort((a, b) => b.date.localeCompare(a.date));
  index = index.slice(0, keepWeeks);

  const { ai, ...publicBriefing } = briefing; // AI 사용량 기록은 보관본에서 제외
  await writeFile(path.join(dir, `${entry.date}.json`), JSON.stringify(publicBriefing));
  await writeFile(path.join(dir, 'index.json'), JSON.stringify({ schemaVersion: 1, weeks: index }));

  // 목록에 없는 파일 정리
  const keep = new Set(index.map((w) => `${w.date}.json`));
  for (const f of await readdir(dir)) if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f) && !keep.has(f)) await unlink(path.join(dir, f));
  return entry;
}
