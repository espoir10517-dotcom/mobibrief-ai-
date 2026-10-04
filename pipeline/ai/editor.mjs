// AI 편집국: 평가 → 선정 → 요약
// 1) 평가: 후보 기사 전부를 편집 기준(config/editorial.md)으로 평가하고 필요 없는 기사는 걸러냄
// 2) 선정: 분야별 상위 후보 중 같은 사건은 하나만 남기고 TOP 5, 오늘의 핵심 이슈 3개, 한 줄 브리핑
// 3) 요약: 선정된 기사만 3줄 요약·분석 작성 → 기사에 없는 숫자가 들어간 문장은 자동 삭제(근거 검증)

import { totalScore } from '../../public/js/core/scoring.js';

const CATS = ['auto', 'mobility', 'insurance', 'ai'];
const CAT_NAME = { auto: '자동차보험', mobility: '모빌리티', insurance: '보험', ai: 'AI 기술' };
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

// ───────── 근거 검증: 기사(제목·요약문)에 없는 숫자가 나오는 문장은 버림 ─────────
const NUM = /\d[\d,.]*/g;
export function numbersSupported(sentence, sourceText) {
  const src = sourceText.replace(/,/g, '');
  for (const n of String(sentence).match(NUM) || []) {
    const bare = n.replace(/,/g, '').replace(/\.$/, '');
    if (!src.includes(bare)) return false;
  }
  return true;
}
function keepSupported(list, source, dropped) {
  return (list || []).filter((s) => {
    const ok = typeof s === 'string' && s.trim() && numbersSupported(s, source);
    if (!ok && s) dropped.push(s);
    return ok;
  });
}

// ───────── 1) 평가 ─────────
function evaluatePrompt(editorial) {
  return `${editorial}

---
너는 위 독자를 위한 뉴스 편집자다. 주어진 기사 목록을 하나씩 평가하라.
각 기사에 대해:
- keep: 위 기준에서 독자에게 보여줄 가치가 있으면 true, '걸러낼 뉴스'에 해당하거나 분야와 무관하면 false
- category: auto | mobility | insurance | ai 중 가장 알맞은 분야 (hint 는 참고만)
- importance, relevance, impact, novelty: 0~100 정수
  · importance: 산업적으로 얼마나 중요한가 (여러 언론사 보도 = coverage 가 크면 참고)
  · relevance: 손해보험사 자동차보험 부서 업무와 얼마나 관련 있는가 (편집 기준의 분야별 우선순위 반영)
  · impact: 앞으로 업무·산업에 영향을 줄 가능성
  · novelty: 새로운 내용인가 (AI 분야는 '진짜 새롭거나 놀라운 기술'일 때만 높게)
- reason: 평가 이유 한 줄 (한국어, 30자 내외)
- keywords: 핵심 키워드 2~3개 (한국어 우선, 고유명사는 원어 가능)
제목·요약문에 있는 정보만으로 판단하고 추측하지 마라.
반드시 JSON 만 출력: {"items":[{"id":"...","keep":true,"category":"auto","importance":0,"relevance":0,"impact":0,"novelty":0,"reason":"...","keywords":["..."]}]}`;
}

async function evaluate({ candidates, client, editorial, criteria, recencyOf, cfg, log }) {
  const system = evaluatePrompt(editorial);
  const out = new Map();
  for (const batch of chunk(candidates, cfg.evaluateBatchSize || 30)) {
    const user = JSON.stringify(
      batch.map((a) => ({ id: a.id, title: a.title, summary: (a.description || '').slice(0, 200), source: a.source, lang: a.lang, coverage: a.coverage, hint: a.category })),
    );
    const res = await client.callJson({ system, user, tier: 'fast', maxTokens: 6000 });
    for (const r of res.items || []) {
      const a = batch.find((x) => x.id === r.id);
      if (!a) continue;
      const scores = {
        importance: clamp(r.importance),
        relevance: clamp(r.relevance),
        recency: recencyOf(a),
        impact: clamp(r.impact),
        novelty: clamp(r.novelty),
      };
      out.set(a.id, {
        ...a,
        keep: r.keep !== false,
        category: CATS.includes(r.category) ? r.category : a.category,
        keywords: Array.isArray(r.keywords) && r.keywords.length ? r.keywords.slice(0, 4).map(String) : a.keywords,
        reason: String(r.reason || ''),
        scores,
        total: totalScore(scores, criteria),
      });
    }
  }
  log(`   평가 완료: ${out.size}건 중 통과 ${[...out.values()].filter((a) => a.keep).length}건`);
  return [...out.values()];
}

// ───────── 2) 선정 ─────────
async function edit({ evaluated, client, editorial, cfg, log }) {
  const pool = {};
  for (const c of CATS) {
    pool[c] = evaluated
      .filter((a) => a.keep && a.category === c)
      .sort((a, b) => b.total - a.total)
      .slice(0, cfg.editorCandidatesPerCategory || 12);
  }
  const system = `${editorial}

---
너는 오늘 아침 브리핑의 편집장이다. 분야별 후보(점수순)에서:
1. top: 분야별로 꼭 봐야 할 기사 5개를 고른다. **같은 사건·같은 발표를 다룬 기사는 하나만** 고른다. 후보가 5개보다 적으면 있는 만큼만.
2. issues: 전체 후보 중 오늘 꼭 알아야 할 이슈 3개. title 은 이슈를 요약한 짧은 제목(25자 이내, 기사 제목 복사 금지), summary 는 1~2문장, articleIds 는 근거 기사 id(1~4개).
3. headline: 오늘 전체 흐름을 1~2문장으로. 후보 제목·이유에 있는 내용만 사용.
4. keywords: 오늘의 핵심 키워드 5개.
id 는 반드시 후보에 있는 것만 쓴다. JSON 만 출력:
{"top":{"auto":["id"],"mobility":[],"insurance":[],"ai":[]},"issues":[{"title":"","summary":"","articleIds":[""]}],"headline":"","keywords":[""]}`;
  const user = JSON.stringify(
    Object.fromEntries(CATS.map((c) => [c, pool[c].map((a) => ({ id: a.id, title: a.title, source: a.source, score: a.total, coverage: a.coverage, reason: a.reason }))])),
  );
  const res = await client.callJson({ system, user, tier: 'deep', maxTokens: 3000 });
  const byId = new Map(evaluated.map((a) => [a.id, a]));

  const top = {};
  for (const c of CATS) {
    const ids = [...new Set((res.top?.[c] || []).filter((id) => pool[c].some((a) => a.id === id)))].slice(0, 5);
    // AI 가 5개를 못 채우면 점수순으로 채움
    for (const a of pool[c]) if (ids.length < 5 && !ids.includes(a.id)) ids.push(a.id);
    top[c] = ids;
  }
  const issues = (res.issues || [])
    .map((it, i) => ({
      id: `issue-${i + 1}`,
      title: String(it.title || '').slice(0, 40),
      summary: String(it.summary || ''),
      articleIds: (it.articleIds || []).filter((id) => byId.has(id)).slice(0, 4),
    }))
    .filter((it) => it.title && it.articleIds.length)
    .slice(0, 3);
  log(`   선정 완료: TOP ${CATS.map((c) => top[c].length).join('/')} · 이슈 ${issues.length}개`);
  return { top, issues, headline: String(res.headline || ''), keywords: (res.keywords || []).slice(0, 5).map(String) };
}

// ───────── 3) 요약 ─────────
async function write({ articles, client, editorial, cfg, log }) {
  const system = `${editorial}

---
각 기사에 대해 아래 항목을 작성하라. 입력된 title·summary 에 없는 사실·숫자·회사명은 절대 쓰지 마라.
- titleKo: 영어 기사면 자연스러운 한국어 제목, 한국어 기사면 원래 제목 그대로
- oneLiner: 핵심을 한 문장으로 (사실만)
- summary3: 사실 요약 최대 3문장. 정보가 부족하면 1~2문장만. (요약문이 없는 기사는 제목에서 확인되는 사실만)
- keyPoints: 핵심 내용 2~4개 (짧은 구, 사실만)
- whyImportant: 독자(자동차보험 부서)에게 왜 중요한지 1~2문장 (해석)
- perspective: 자동차보험·보험 관점의 의미 1~2문장. 관련이 약하면 억지로 연결하지 말고 해당 산업 관점으로.
- watchNext: 앞으로 확인할 것 1~3개
- limitedInfo: 제목 외 정보가 거의 없어 내용이 제한적이면 true
JSON 만 출력: {"items":[{"id":"","titleKo":"","oneLiner":"","summary3":[],"keyPoints":[],"whyImportant":"","perspective":"","watchNext":[],"limitedInfo":false}]}`;
  const out = new Map();
  let droppedTotal = 0;
  for (const batch of chunk(articles, cfg.writeBatchSize || 5)) {
    const user = JSON.stringify(batch.map((a) => ({ id: a.id, title: a.title, summary: a.description || '', source: a.source, lang: a.lang, category: CAT_NAME[a.category], coverage: a.coverage })));
    let res;
    try {
      res = await client.callJson({ system, user, tier: 'deep', maxTokens: 5000 });
    } catch (e) {
      log(`   ⚠️ 요약 일부 실패: ${e.message}`);
      continue;
    }
    for (const r of res.items || []) {
      const a = batch.find((x) => x.id === r.id);
      if (!a) continue;
      const source = `${a.title} ${a.description || ''}`;
      const dropped = [];
      const sentence = (s) => (typeof s === 'string' && s.trim() && numbersSupported(s, source) ? s.trim() : (s && dropped.push(s), ''));
      const w = {
        titleKo: a.lang !== 'ko' && r.titleKo ? String(r.titleKo) : '',
        oneLiner: sentence(r.oneLiner),
        summary3: keepSupported(r.summary3, source, dropped).slice(0, 3),
        keyPoints: keepSupported(r.keyPoints, source, dropped).slice(0, 4),
        whyImportant: sentence(r.whyImportant),
        perspective: sentence(r.perspective),
        watchNext: keepSupported(r.watchNext, source, dropped).slice(0, 3),
        limitedInfo: Boolean(r.limitedInfo) || !a.description,
      };
      droppedTotal += dropped.length;
      out.set(a.id, w);
    }
  }
  log(`   요약 완료: ${out.size}건${droppedTotal ? ` (근거 없는 숫자가 있어 삭제한 문장 ${droppedTotal}개)` : ''}`);
  return out;
}

export async function aiBriefing({ today, client, editorial, criteria, cfg, recencyOf, log = console.log }) {
  const evaluated = await evaluate({ candidates: today, client, editorial, criteria, recencyOf, cfg, log });
  const edited = await edit({ evaluated, client, editorial, cfg, log });
  const byId = new Map(evaluated.map((a) => [a.id, a]));
  const chosenIds = [...new Set([...CATS.flatMap((c) => edited.top[c]), ...edited.issues.flatMap((i) => i.articleIds)])];
  const written = await write({ articles: chosenIds.map((id) => byId.get(id)), client, editorial, cfg, log });

  const articles = chosenIds.map((id) => {
    const a = byId.get(id);
    const w = written.get(id) || {};
    const rank = (() => {
      const i = edited.top[a.category]?.indexOf(id);
      return i >= 0 ? i + 1 : undefined;
    })();
    return {
      id: a.id,
      category: a.category,
      title: w.titleKo || a.title,
      originalTitle: w.titleKo ? a.title : undefined,
      source: a.source,
      url: a.url,
      publishedAt: a.publishedAt,
      lang: a.lang,
      coverage: a.coverage,
      sources: a.sources,
      keywords: a.keywords,
      scores: a.scores,
      total: a.total,
      rank,
      reason: a.reason,
      oneLiner: w.oneLiner || a.oneLiner || '',
      description: a.description,
      summary3: w.summary3 || [],
      keyPoints: w.keyPoints || [],
      whyImportant: w.whyImportant || '',
      perspective: w.perspective || '',
      watchNext: w.watchNext || [],
      limitedInfo: w.limitedInfo ?? !a.description,
      analysis: written.has(id) ? 'ai' : 'rules',
    };
  });

  // 카테고리 순위는 AI 선정 순서 그대로
  return {
    categories: edited.top,
    issues: edited.issues,
    headline: edited.headline,
    keywords: edited.keywords,
    articles,
    evaluated,
  };
}
