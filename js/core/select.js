// TOP N 선정 — 단순 점수순이 아니라 주제 다양성을 고려합니다.
// 1) 점수 높은 순으로 후보를 보며
// 2) 이미 뽑힌 기사와 주제가 겹치면(유사도 ≥ similarityThreshold) 감점
// 3) 사실상 같은 기사(유사도 ≥ duplicateThreshold)는 제외
// 브라우저와 Node 양쪽에서 사용합니다.

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'with', '및', '등', '것', '위해', '대한', '관련']);

export function tokens(article) {
  const set = new Set();
  for (const k of article.keywords || []) set.add(norm(k));
  const words = String(article.title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
  for (const w of words) set.add(w);
  return set;
}

export function similarity(a, b) {
  const ta = a._tokens || tokens(a);
  const tb = b._tokens || tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function selectTop(articles, opts = {}) {
  const { topN = 5, similarityThreshold = 0.34, duplicateThreshold = 0.75, diversityPenalty = 12 } = opts;
  const pool = articles
    .map((a) => ({ ...a, _tokens: tokens(a) }))
    .sort((x, y) => (y.total ?? 0) - (x.total ?? 0));
  const picked = [];

  while (picked.length < topN && pool.length) {
    let bestIdx = -1;
    let bestAdj = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let overlaps = 0;
      let dup = false;
      for (const p of picked) {
        const s = similarity(cand, p);
        if (s >= duplicateThreshold) dup = true;
        if (s >= similarityThreshold) overlaps++;
      }
      if (dup) continue;
      const adj = (cand.total ?? 0) - overlaps * diversityPenalty;
      if (adj > bestAdj) {
        bestAdj = adj;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    picked.push(pool.splice(bestIdx, 1)[0]);
  }

  return picked.map(({ _tokens, ...a }, i) => ({ ...a, rank: i + 1 }));
}

function norm(s) {
  return String(s).trim().toLowerCase();
}
