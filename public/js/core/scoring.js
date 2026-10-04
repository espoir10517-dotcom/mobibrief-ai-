// 종합점수 계산 — 브라우저와 Node(수집 파이프라인) 양쪽에서 같은 로직을 사용합니다.
// criteria: config/scoring.json 의 criteria 객체

export function totalScore(scores = {}, criteria = {}) {
  let sum = 0;
  let weightSum = 0;
  for (const [key, def] of Object.entries(criteria)) {
    const w = Number(def.weight) || 0;
    const v = clamp(Number(scores[key]) || 0, 0, 100);
    sum += v * w;
    weightSum += w;
  }
  if (weightSum === 0) return 0;
  return Math.round(sum / weightSum);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
