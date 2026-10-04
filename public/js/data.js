// 데이터 불러오기
// - 실데이터: data/live/*.json (Phase 2~4 의 자동 수집 파이프라인이 매일 생성)
// - Demo: data/demo/*.json (가상 기사 20건)
// 설정의 '데이터 모드'가 auto 이면 실데이터가 있을 때 실데이터를, 없으면 Demo 를 보여줍니다.

import { getSettings } from './store.js';
import { dayKey } from './util.js';

let cache = null;

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function hydrateDemo(briefing, stats) {
  const now = new Date();
  // 가상 데이터를 '방금 업데이트된 오늘 브리핑'처럼 보이도록 현재 시각 기준으로 배치
  const gen = new Date(now.getTime() - 12 * 60000);
  const articles = briefing.articles.map((a) => ({
    ...a,
    publishedAt: new Date(gen.getTime() - a.hoursAgo * 3600000).toISOString(),
  }));
  const days = (stats?.days || []).map((d) => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + d.offset);
    return { date: dayKey(dt), counts: d.counts };
  });
  return { briefing: { ...briefing, generatedAt: gen.toISOString(), articles }, stats: { ...stats, days } };
}

export async function loadData({ force = false } = {}) {
  if (cache && !force) return cache;
  const settings = getSettings();
  const inline = typeof window !== 'undefined' ? window.__MOBIBRIEF_INLINE__ : null;

  let mode = 'demo';
  let briefing = null;
  let stats = null;
  let archive = null;

  if (inline) {
    ({ briefing, stats } = hydrateDemo(inline.briefing, inline.stats));
  } else {
    if (settings.dataMode !== 'demo') {
      try {
        briefing = await fetchJson('data/live/briefing.json');
        mode = 'live';
        stats = await fetchJson('data/live/keyword-stats.json').catch(() => ({ days: [] }));
        archive = await fetchJson('data/live/archive.json').catch(() => null);
      } catch {
        briefing = null;
        mode = 'demo';
      }
    }
    if (!briefing) {
      const [b, s] = await Promise.all([fetchJson('data/demo/briefing.json'), fetchJson('data/demo/keyword-stats.json')]);
      ({ briefing, stats } = hydrateDemo(b, s));
    }
  }

  // 검색 대상: 과거 기사 아카이브 + 오늘 기사 (id 기준 중복 제거)
  const byId = new Map();
  for (const a of archive?.articles || []) byId.set(a.id, a);
  for (const a of briefing.articles) byId.set(a.id, a);

  cache = {
    mode,
    briefing,
    stats: stats || { days: [] },
    articles: briefing.articles,
    all: [...byId.values()].sort((x, y) => String(y.publishedAt).localeCompare(String(x.publishedAt))),
    byId,
  };
  return cache;
}

export function topOf(data, cat) {
  return (data.briefing.categories?.[cat] || []).map((id) => data.byId.get(id)).filter(Boolean);
}
