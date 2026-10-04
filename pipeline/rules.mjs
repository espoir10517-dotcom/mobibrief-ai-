// AI 없이 기사를 분류·평가하는 규칙
// - 키워드 사전(config/keywords.json)으로 분야·주요 키워드를 찾고
// - 보도 언론사 수 · 최신성 · 분야 관련도 · 영향 단어 · 새로움으로 0~100점 평가
// AI가 연결되면(Phase 3) 이 규칙 대신 AI 평가를 사용하게 됩니다.

const isAscii = (s) => /^[\x00-\x7F]+$/.test(s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileDictionary(dict) {
  const cats = {};
  for (const [cat, terms] of Object.entries(dict.categories)) {
    cats[cat] = terms.map((t) => ({
      term: t.term,
      // 영어 단어는 단어 경계로(예: 'EV'가 'every'에 걸리지 않도록), 한글은 포함 여부로 찾음
      res: t.aliases.map((a) => a.startsWith('re:') ? new RegExp(a.slice(3), 'i') : (isAscii(a) ? new RegExp(`(^|[^A-Za-z0-9])${esc(a)}($|[^A-Za-z0-9])`, /[a-z]/.test(a) ? 'i' : '') : new RegExp(esc(a), 'i'))),
    }));
  }
  const impact = (dict.impactTerms || []).map((a) => (isAscii(a) ? new RegExp(`\\b${esc(a)}\\b`, 'i') : new RegExp(esc(a))));
  return { cats, impact };
}

export function matchTerms(text, compiled) {
  const hits = {};
  for (const [cat, terms] of Object.entries(compiled.cats)) {
    hits[cat] = terms.filter((t) => t.res.some((re) => re.test(text))).map((t) => t.term);
  }
  return hits;
}

const DOMESTIC = new Set(['auto', 'insurance']);
// 제목에 분야 키워드가 있으면 제목+요약에서 키워드를 모으고,
// 제목에 하나도 없으면 요약에서 한 분야 키워드가 2개 이상 나올 때만 인정합니다.
// (예: 골프 기사 요약에 후원사 'OO손해보험'이 한 번 나오는 경우 제외)
export function relevantHits(title, description, compiled) {
  const t = matchTerms(title, compiled);
  const anyTitle = Object.values(t).some((v) => v.length);
  const d = matchTerms(description || '', compiled);
  const out = {};
  for (const c of Object.keys(t)) {
    out[c] = anyTitle ? [...new Set([...t[c], ...d[c]])] : d[c].length >= 2 ? d[c] : [];
  }
  return out;
}

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

export function scoreArticle(a, { hits, compiled, now, isNew }) {
  const own = hits[a.category] || [];
  const ageH = (now - Date.parse(a.publishedAt)) / 3600000;
  const text = `${a.title} ${a.description || ''}`;
  const impactHits = compiled.impact.filter((re) => re.test(text)).length;
  const coverageScore = [0, 55, 70, 80, 88, 93][Math.min(5, a.coverage || 1)] + (a.coverage > 5 ? Math.min(7, a.coverage - 5) : 0);
  return {
    importance: clamp(coverageScore), // 여러 언론사가 보도할수록 중요한 이슈로 판단
    // 분야 키워드가 많을수록 높게. 한국어 기사 가산, 자동차보험·보험은 국내 제도 중심이라 해외 기사 감점
    relevance: clamp(40 + own.length * 18 + (a.lang === 'ko' ? 12 : DOMESTIC.has(a.category) ? -12 : 0)),
    recency: clamp(ageH <= 6 ? 100 : ageH <= 12 ? 90 : ageH <= 24 ? 75 : 60),
    impact: clamp(50 + impactHits * 12 + (a.coverage >= 3 ? 10 : 0)), // 정책·출시·투자 같은 변화 단어
    novelty: isNew ? 88 : 45, // 최근 3일 안에 비슷한 기사가 없었으면 새로운 이슈
  };
}
