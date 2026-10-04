// 최근 7일 HOT TOPIC 계산
// stats: [{ date: 'YYYY-MM-DD', counts: { 키워드: 기사수 } }, ...] (날짜 오름차순)
// 데이터가 minDaysForTrend 일보다 적으면 상승/하락을 표시하지 않습니다 (direction: null).

export function computeTrends(stats = [], opts = {}) {
  const { windowDays = 7, minDaysForTrend = 14, risePercent = 20, minAbsoluteChange = 2, limit = 7 } = opts;
  const days = [...stats].sort((a, b) => a.date.localeCompare(b.date));
  const recent = days.slice(-windowDays);
  const previous = days.slice(-windowDays * 2, -windowDays);
  const canTrend = days.length >= minDaysForTrend && previous.length === windowDays;

  const sum = (list) => {
    const acc = {};
    for (const d of list) for (const [k, v] of Object.entries(d.counts || {})) acc[k] = (acc[k] || 0) + v;
    return acc;
  };
  const now = sum(recent);
  const before = sum(previous);

  const items = Object.entries(now)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword, count]) => {
      const prev = before[keyword] || 0;
      let direction = null;
      let changePct = null;
      if (canTrend) {
        const diff = count - prev;
        changePct = prev === 0 ? null : Math.round((diff / prev) * 100);
        if (prev === 0 && count >= minAbsoluteChange) direction = 'new';
        else if (Math.abs(diff) < minAbsoluteChange) direction = 'flat';
        else if (changePct >= risePercent) direction = 'up';
        else if (changePct <= -risePercent) direction = 'down';
        else direction = 'flat';
      }
      return { keyword, count, prev, direction, changePct, spark: recent.map((d) => d.counts?.[keyword] || 0) };
    });

  return { canTrend, daysAvailable: days.length, items };
}
