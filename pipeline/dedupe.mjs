// 중복 기사 묶기
// 같은 사건을 여러 언론사가 보도하면 제목이 비슷합니다. 제목의 글자쌍(bigram) 유사도로 묶고,
// 묶음마다 대표 기사 하나 + 함께 보도한 언론사 목록을 남깁니다.
// 보도한 언론사 수(coverage)는 '여러 출처에서 확인된 이슈'인지 판단하는 참고값이 됩니다.

import { createHash } from 'node:crypto';
import { normalizeTitle, bigrams, jaccard } from './lib/text.mjs';

export function articleId(url) {
  return createHash('sha1').update(String(url)).digest('hex').slice(0, 12);
}

function pickRepresentative(items) {
  // 요약문이 있는 기사(네이버) 우선 → 한국어 우선 → 가장 먼저 보도한 기사
  return [...items].sort((a, b) => {
    const d = (b.description ? 1 : 0) - (a.description ? 1 : 0);
    if (d) return d;
    const l = (b.lang === 'ko' ? 1 : 0) - (a.lang === 'ko' ? 1 : 0);
    if (l) return l;
    return a.publishedAt.localeCompare(b.publishedAt);
  })[0];
}

export function dedupe(items, { threshold = 0.5 } = {}) {
  // 1) 같은 URL 은 바로 합치기
  const byUrl = new Map();
  for (const it of items) {
    const key = it.url.replace(/[?#].*$/, '');
    if (!byUrl.has(key)) byUrl.set(key, { ...it, categories: new Set([it.category]), queries: new Set([it.query]) });
    else {
      const ex = byUrl.get(key);
      ex.categories.add(it.category);
      ex.queries.add(it.query);
    }
  }
  const uniq = [...byUrl.values()].map((it) => ({ ...it, _bg: bigrams(normalizeTitle(it.title)) }));

  // 2) 제목이 비슷한 기사끼리 묶기
  const clusters = [];
  for (const it of uniq) {
    let best = null;
    let bestSim = 0;
    for (const c of clusters) {
      const s = jaccard(it._bg, c.lead._bg);
      if (s > bestSim) {
        bestSim = s;
        best = c;
      }
    }
    if (best && bestSim >= threshold) best.items.push(it);
    else clusters.push({ lead: it, items: [it] });
  }

  // 3) 묶음마다 대표 기사 선택
  return clusters.map(({ items: group }) => {
    const rep = pickRepresentative(group);
    const categoryVotes = {};
    const queries = new Set();
    for (const g of group) {
      for (const c of g.categories) categoryVotes[c] = (categoryVotes[c] || 0) + 1;
      for (const q of g.queries) queries.add(q);
    }
    const categoryHints = Object.entries(categoryVotes)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
    const outlets = new Map();
    for (const g of group) if (!outlets.has(g.source)) outlets.set(g.source, { name: g.source, url: g.url, publishedAt: g.publishedAt });
    const { _bg, categories, queries: _q, category, query, ...clean } = rep;
    return {
      ...clean,
      id: articleId(rep.url),
      category: categoryHints[0],
      categoryHints,
      matchedQueries: [...queries],
      coverage: outlets.size,
      sources: [...outlets.values()].slice(0, 6),
      firstSeenAt: group.map((g) => g.publishedAt).sort()[0],
      topical: group.some((g) => g.topical) || undefined,
    };
  });
}
