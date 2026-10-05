import { CATEGORIES, CATEGORY_ORDER, esc, safeUrl, timeAgo, formatFullDate, formatTime, formatShortDate, dayKey, articleMatches, ICON } from './util.js';
import { topOf } from './data.js';
import { computeTrends } from './core/trend.js';
import * as store from './store.js';
import { verifyAdminCode } from './admin.js';
import { PUSH_API } from './config.js';
import * as push from './push.js';

// ───────────────── components ─────────────────

function catLabel(cat) {
  const c = CATEGORIES[cat];
  return c ? `<span class="cat-label cat-${cat}"><span class="cat-dot"></span>${esc(c.name)}</span>` : '';
}

const isRules = (a) => a?.analysis === 'rules';

function outletList(sources = []) {
  if (!sources.length) return '';
  return `<ul class="outlets">${sources
    .map(
      (s) =>
        `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer"><span class="outlets__name">${esc(s.name)}</span><time datetime="${esc(s.publishedAt)}">${esc(timeAgo(s.publishedAt))}</time>${ICON.ext}</a></li>`,
    )
    .join('')}</ul>`;
}

function sampleTag(a) {
  return a.isSample ? '<span class="tag-sample">SAMPLE</span>' : '';
}

function metaLine(a) {
  const lang = a.lang && a.lang !== 'ko' ? `<span class="tag-lang">${esc(a.lang.toUpperCase())}</span>` : '';
  return `${esc(a.source)} · <time datetime="${esc(a.publishedAt)}">${esc(timeAgo(a.publishedAt))}</time> ${lang} ${sampleTag(a)}`;
}

export function card(a, { showRank = true, showCat = false, suffix = '' } = {}) {
  const saved = store.isSaved(a.id);
  const href = `/article/${esc(a.id)}${esc(suffix)}`;
  const kws = (a.keywords || []).slice(0, 3).map((k) => `<span class="chip chip--sm chip--hash">${esc(k)}</span>`).join('');
  return `
  <article class="card cat-${esc(a.category)} ${showRank && a.rank ? '' : 'card--norank'}">
    ${showRank && a.rank ? `<a class="card__rank" href="#${href}" data-nav="${href}" aria-hidden="true" tabindex="-1">${a.rank}</a>` : ''}
    <a href="#${href}" data-nav="${href}" style="display:grid;gap:4px;min-width:0">
      ${showCat ? `<div>${catLabel(a.category)}</div>` : ''}
      <h3 class="card__title">${esc(a.title)}</h3>
      <div class="card__meta">${metaLine(a)}</div>
      ${
        a.oneLiner
          ? `<p class="card__one">${esc(a.oneLiner)}</p>`
          : `<p class="card__one card__one--none">${a.coverage > 1 ? `${esc(a.coverage)}개 언론사 보도` : esc(a.source)} · 요약문이 제공되지 않은 기사예요. 원문에서 확인하세요.</p>`
      }
    </a>
    <div class="card__foot">
      <div class="chips">${kws}</div>
      <span class="score">${isRules(a) ? '중요도' : 'AI 중요도'} <b>${esc(a.total)}</b></span>
    </div>
    <button class="card__star icon-btn ${saved ? 'is-on' : ''}" data-star="${esc(a.id)}" aria-pressed="${saved}" aria-label="${saved ? '저장 취소' : '저장하기'}">${ICON.star}</button>
  </article>`;
}

function sparkline(values) {
  const w = 64, h = 22, pad = 3;
  const max = Math.max(1, ...values);
  const step = (w - pad * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1] || [0, 0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2"/></svg>`;
}

function trendBlock(stats) {
  const t = computeTrends(stats.days || []);
  if (!t.items.length) {
    return `<div class="trend"><p class="trend__note" style="padding:14px 0">아직 집계할 뉴스 데이터가 없습니다. 뉴스가 쌓이면 자주 등장하는 주제를 보여드립니다.</p></div>`;
  }
  const dirHtml = (it) => {
    if (it.direction === 'up') return `<span class="dir-up">↑${it.changePct != null ? ` ${it.changePct}%` : ''}</span>`;
    if (it.direction === 'down') return `<span class="dir-down">↓ ${Math.abs(it.changePct)}%</span>`;
    if (it.direction === 'flat') return `<span class="dir-flat">→</span>`;
    if (it.direction === 'new') return `<span class="dir-new">NEW</span>`;
    return '<span class="dir-flat" aria-label="추세 계산 불가">·</span>';
  };
  const rows = t.items
    .map(
      (it, i) => `
      <a class="trend__row" href="#/search?q=${encodeURIComponent(it.keyword)}" data-nav="/search?q=${encodeURIComponent(it.keyword)}">
        <span class="trend__rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="trend__kw">${esc(it.keyword)}<span class="trend__count">${it.count}건</span></span>
        ${sparkline(it.spark)}
        <span class="trend__dir">${dirHtml(it)}</span>
      </a>`,
    )
    .join('');
  const note = t.canTrend
    ? '최근 7일 등장 기사 수를 그 이전 7일과 비교했습니다. ±20% 이상 변하면 화살표로 표시합니다.'
    : `데이터가 ${t.daysAvailable}일치뿐이라 상승·하락은 아직 표시하지 않습니다. (14일 이상 쌓이면 표시)`;
  return `<div class="trend">${rows}<p class="trend__note">${note}</p></div>`;
}

function empty(icon, title, desc, action = '') {
  return `<div class="empty"><div class="empty__icon" aria-hidden="true">${icon}</div><b>${esc(title)}</b><p>${desc}</p>${action}</div>`;
}

function topbar(title, actions = '') {
  return `<div class="topbar">
    <button class="icon-btn" data-back aria-label="뒤로">${ICON.back}</button>
    <div class="topbar__title">${esc(title)}</div>
    ${actions}
  </div>`;
}

// 발행 주기에 따른 문구 (주간 = '이번 주', 일간 = '오늘')
export function periodOf(b) {
  const weekly = b?.cadence === 'weekly';
  return { weekly, P: weekly ? '이번 주' : '오늘', Pof: weekly ? '이번 주' : '오늘의' };
}
function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isFinite(d.getTime()) ? `${d.getMonth() + 1}.${d.getDate()}` : '';
}
function nextMonday(from) {
  const d = new Date(from);
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d;
}


// ───────── 브리핑 공통 조각 (이번 주 홈 · 지난 브리핑 화면이 같이 사용) ─────────
const FIRST = 5; // 5위까지 먼저 보여주고 나머지는 펼치기

function issuesHtml(b, suffix = '') {
  return (b.issues || [])
    .slice(0, 3)
    .map((it, i) => {
      const href = `/issue/${esc(it.id)}${esc(suffix)}`;
      return `
      <a class="issue" href="#${href}" data-nav="${href}">
        <span class="issue__num">${i + 1}</span>
        <span><span class="issue__title">${esc(it.title)}</span><span class="issue__meta" style="display:block">관련 뉴스 ${it.articleIds.length}건</span></span>
        ${ICON.chev}
      </a>`;
    })
    .join('');
}

function sectionsHtml(data, P, { suffix = '', more = true } = {}) {
  return CATEGORY_ORDER.map((c) => {
    const list = topOf(data, c);
    return `
    <section class="section cat-section cat-${c}" id="sec-${c}">
      <div class="section__head">
        <h2 class="section__title">${CATEGORIES[c].emoji} ${esc(CATEGORIES[c].name)} <small>TOP ${list.length}</small></h2>
        ${more ? `<a class="section__more" href="#/category/${c}" data-nav="/category/${c}">전체보기</a>` : ''}
      </div>
      <div class="cards">${list.slice(0, FIRST).map((a) => card(a, { suffix })).join('') || empty('📭', `${P} 선정된 뉴스가 없습니다`, '')}</div>
      ${
        list.length > FIRST
          ? `<div class="cards" id="more-${c}" hidden>${list.slice(FIRST).map((a) => card(a, { suffix })).join('')}</div>
      <button class="btn more-btn" type="button" data-more="${c}" aria-expanded="false" aria-controls="more-${c}">${FIRST + 1}~${list.length}위 더 보기</button>`
          : ''
      }
    </section>`;
  }).join('');
}

function mountMore(root) {
  root.querySelectorAll('[data-more]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const box = root.querySelector(`#more-${btn.dataset.more}`);
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) btn.textContent = '접기';
      else {
        btn.textContent = `${FIRST + 1}~${FIRST + box.children.length}위 더 보기`;
        root.querySelector(`#sec-${btn.dataset.more}`)?.scrollIntoView({ block: 'start' });
      }
    }),
  );
}

// ───────────────── HOME ─────────────────

export function home(data) {
  const b = data.briefing;
  const gen = new Date(b.generatedAt);
  const total = CATEGORY_ORDER.reduce((n, c) => n + topOf(data, c).length, 0);
  const rules = b.analysis === 'rules';
  const { weekly, P, Pof } = periodOf(b);

  const issues = issuesHtml(b);

  const jump = CATEGORY_ORDER.map(
    (c) => `<a class="chip cat-${c}" href="#sec-${c}" data-jump="${c}"><span class="cat-dot"></span>${esc(CATEGORIES[c].name)}</a>`,
  ).join('');

  const sections = sectionsHtml(data, P);

  return {
    html: `
    <header class="masthead">
      <div class="masthead__row">
        <div class="brand">MobiBrief <span class="brand__ai">AI</span></div>
        <a class="icon-btn" href="#/search" data-nav="/search" aria-label="뉴스 검색">${ICON.search}</a>
      </div>
      <p class="masthead__tagline">${
        weekly
          ? rules
            ? '매주 월요일 자동으로 골라주는 이번 주 핵심 뉴스'
            : 'AI가 매주 골라주는 이번 주 핵심 뉴스'
          : rules
            ? '매일 아침 자동으로 골라주는 오늘의 핵심 뉴스'
            : 'AI가 골라주는 오늘의 핵심 뉴스'
      }</p>
      ${
        weekly && b.periodStart
          ? `<div class="masthead__date"><b>${esc(shortDate(b.periodStart))} ~ ${esc(shortDate(b.periodEnd))} 주간 브리핑</b><span>업데이트 ${esc(formatShortDate(gen))} ${esc(formatTime(gen))}</span><span>다음 ${esc(formatShortDate(nextMonday(new Date(Math.max(Date.now(), gen.getTime())))))}</span><span>핵심 뉴스 ${total}건</span><a class="masthead__past" href="#/weeks" data-nav="/weeks">지난 브리핑 ›</a></div>`
          : `<div class="masthead__date"><b>${esc(formatFullDate(new Date()))}</b><span>업데이트 ${esc(formatTime(gen))}${gen.toDateString() !== new Date().toDateString() ? ` (${esc(formatShortDate(gen))})` : ''}</span><span>핵심 뉴스 ${total}건</span></div>`
      }
      ${
        weekly && Date.now() - gen.getTime() > 8 * 86400000
          ? '<p class="masthead__stale">이번 주 브리핑을 준비하고 있어요. 지금은 지난 브리핑을 보여드려요.</p>'
          : ''
      }
    </header>

    <section class="brief" aria-label="${rules ? `${P} 가장 많이 보도된 뉴스` : `${Pof} AI 한 줄 브리핑`}">
      <div class="eyebrow">${rules ? `✦ ${P} 가장 많이 보도된 뉴스` : `✦ ${Pof} AI 한 줄 브리핑`}</div>
      ${
        rules && b.issues?.[0]
          ? `<a class="brief__text brief__link" href="#/issue/${esc(b.issues[0].id)}" data-nav="/issue/${esc(b.issues[0].id)}">${esc(b.headline)}</a>`
          : `<p class="brief__text">${esc(b.headline)}</p>`
      }
      ${b.headlineNote ? `<p class="brief__note">${esc(b.headlineNote)}</p>` : ''}
      <div>
        <div class="brief__kw-label">${Pof} 핵심 키워드</div>
        <div class="chips">${(b.keywords || []).map((k) => `<a class="chip chip--hash" href="#/search?q=${encodeURIComponent(k)}" data-nav="/search?q=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div>
      </div>
    </section>

    <section class="section">
      <div class="section__head"><h2 class="section__title">🔥 ${P} 꼭 알아야 할 3가지</h2></div>
      <div class="issues">${issues}</div>
    </section>

    <nav class="jump" aria-label="분야 바로가기">${jump}</nav>
    ${sections}

    <section class="section">
      <div class="section__head"><h2 class="section__title">📈 최근 7일 HOT TOPIC</h2></div>
      ${trendBlock(data.stats)}
    </section>

    ${
      weekly
        ? `<section class="section"><a class="row-link" href="#/weeks" data-nav="/weeks"><span><b>📚 지난 주간 브리핑</b><small>지난주들의 TOP 10·핵심 이슈를 다시 볼 수 있어요</small></span>${ICON.chev}</a></section>`
        : ''
    }

    <p class="footer-note">${
      rules
        ? '여러 언론사 보도·최신성·업무 연관도를 기준으로 선정한 뉴스입니다.<br>기사 내용은 반드시 원문에서 확인하세요.'
        : '요약과 분석은 수집된 기사 정보만을 근거로 AI가 작성합니다.<br>중요한 판단 전에는 반드시 원문을 확인하세요.'
    }</p>`,
    mount(root) {
      mountMore(root);
      root.querySelectorAll('[data-jump]').forEach((el) =>
        el.addEventListener('click', (e) => {
          e.preventDefault();
          root.querySelector(`#sec-${el.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }),
      );
    },
  };
}

// ───────────────── CATEGORY ─────────────────

export function category(data, cat) {
  const current = CATEGORIES[cat] ? cat : 'auto';
  const tabs = CATEGORY_ORDER.map(
    (c) =>
      `<a class="chip cat-${c} ${c === current ? 'is-active' : ''}" href="#/category/${c}" data-nav="/category/${c}" data-replace><span class="cat-dot"></span>${esc(CATEGORIES[c].name)}</a>`,
  ).join('');
  const top = topOf(data, current);
  const topIds = new Set(top.map((a) => a.id));
  const others = data.all.filter((a) => a.category === current && !topIds.has(a.id));

  return {
    html: `
    <header class="page-head">
      <span class="eyebrow">${esc(CATEGORIES[current].en)}</span>
      <h1>${CATEGORIES[current].emoji} ${esc(CATEGORIES[current].name)}</h1>
      <p>${data.briefing.analysis === 'rules' ? '보도 언론사 수·분야 키워드·최신성 등으로 자동 선정한' : 'AI가 중요도·업무 연관도·최신성·영향도·참신성을 평가해 고른'} ${periodOf(data.briefing).Pof} TOP ${top.length}</p>
    </header>
    <div class="chips" style="margin-bottom:6px">${tabs}</div>
    <section class="section cat-${current}" style="margin-top:16px">
      <div class="cards">${top.map((a) => card(a)).join('') || empty('📭', `${periodOf(data.briefing).P} 선정된 뉴스가 없습니다`, '')}</div>
    </section>
    ${
      others.length
        ? `<section class="section"><div class="section__head"><h2 class="section__title">함께 수집된 뉴스</h2></div><div class="cards">${others
            .slice(0, 30)
            .map((a) => card(a, { showRank: false }))
            .join('')}</div></section>`
        : ''
    }`,
  };
}

// ───────────────── ARTICLE ─────────────────

export function article(data, id) {
  const a = data.byId.get(id) || store.getSaved().find((s) => s.id === id);
  if (!a) {
    return { title: '기사', html: topbar('기사') + empty('🔎', '기사를 찾을 수 없습니다', '데이터가 업데이트되어 더 이상 보관되지 않는 기사일 수 있습니다.') };
  }
  const saved = store.isSaved(a.id);
  const criteria = data.briefing.criteria || {};
  const bars = Object.entries(criteria)
    .map(([k, c]) => {
      const v = a.scores?.[k] ?? 0;
      return `<div class="bar"><span>${esc(c.label)} <span class="bar__w">×${Math.round(c.weight * 100)}%</span></span><span class="bar__track"><span class="bar__fill" style="width:${Math.max(0, Math.min(100, v))}%"></span></span><span class="bar__val">${esc(v)}</span></div>`;
    })
    .join('');
  const li = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const url = safeUrl(a.url);
  const coverage = a.coverage > 1 ? `같은 이슈를 ${a.coverage}개 매체가 보도했습니다.` : '단일 매체 보도입니다. 다른 출처로 교차 확인이 필요할 수 있습니다.';
  const rules = isRules(a);
  const bodyHtml = rules
    ? `
    <section class="panel panel--fact" aria-label="기사 정보">
      <div class="panel__label"><span class="eyebrow">📄 기사 정보 · FACT</span></div>
      ${
        a.description
          ? `<div class="block"><h2>검색 결과 요약</h2><p>${esc(a.description)}</p><p class="panel__note">뉴스 검색 서비스가 제공한 요약문입니다.</p></div>`
          : '<p class="panel__note">이 기사는 제목과 출처만 제공됩니다. 내용은 원문에서 확인하세요.</p>'
      }
      ${a.sources?.length > 1 ? `<div class="block"><h2>함께 보도한 언론사 ${a.sources.length}곳</h2>${outletList(a.sources)}</div>` : ''}
    </section>
    <p class="notice" style="margin-top:14px">보도한 언론사 수, 최신성, 업무 연관도를 기준으로 선정한 기사입니다.</p>`
    : `
    <section class="panel panel--fact" aria-label="기사 요약">
      <div class="panel__label"><span class="eyebrow">📄 기사 요약 · FACT</span></div>
      <p class="panel__note">${a.limitedInfo ? '이 기사는 제목·짧은 요약문만 제공되어 내용이 제한적입니다. 자세한 내용은 원문에서 확인하세요.' : '원문 기사에 나온 내용만 정리했습니다.'}</p>
      ${a.summary3?.length ? `<div class="block"><h2>${a.summary3.length >= 3 ? '3줄 요약' : '요약'}</h2><ol class="sum3">${li(a.summary3)}</ol></div>` : ''}
      ${a.keyPoints?.length ? `<div class="block"><h2>핵심 내용</h2><ul class="points">${li(a.keyPoints)}</ul></div>` : ''}
      ${a.sources?.length > 1 ? `<div class="block"><h2>함께 보도한 언론사 ${a.sources.length}곳</h2>${outletList(a.sources)}</div>` : ''}
    </section>

    <section class="panel panel--ai" aria-label="AI 분석">
      <div class="panel__label"><span class="eyebrow">✦ AI 분석 · 해석과 전망</span></div>
      <p class="panel__note">AI의 해석입니다. 기사에서 확인되지 않은 사실은 포함하지 않도록 작성되며, 판단의 참고용으로만 활용하세요.</p>
      ${a.whyImportant ? `<div class="block"><h2>왜 중요한가?</h2><p>${esc(a.whyImportant)}</p></div>` : ''}
      ${a.perspective ? `<div class="block"><h2>보험·모빌리티 관점</h2><p>${esc(a.perspective)}</p></div>` : ''}
      ${a.watchNext?.length ? `<div class="block"><h2>앞으로 볼 것</h2><ul class="points">${li(a.watchNext)}</ul></div>` : ''}
    </section>`;

  return {
    title: a.title,
    html: `
    ${topbar('', `
      <button class="icon-btn" data-share="${esc(a.id)}" aria-label="공유하기">${ICON.share}</button>
      <button class="icon-btn ${saved ? 'is-on' : ''}" data-star="${esc(a.id)}" aria-pressed="${saved}" aria-label="${saved ? '저장 취소' : '저장하기'}">${ICON.star}</button>`)}
    <header class="article-head">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${catLabel(a.category)}${a.rank ? `<span class="eyebrow">TOP ${a.rank}</span>` : ''}</div>
      <h1>${esc(a.title)}</h1>
      ${a.originalTitle && a.originalTitle !== a.title ? `<p class="article-orig">원제: ${esc(a.originalTitle)}</p>` : ''}
      <div class="card__meta">${metaLine(a)}</div>
      <div class="chips">${(a.keywords || []).map((k) => `<a class="chip chip--sm chip--hash" href="#/search?q=${encodeURIComponent(k)}" data-nav="/search?q=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div>
    </header>

    <div class="scorebox">
      <div class="scorebox__head">
        <span class="eyebrow">${rules ? '자동 중요도 점수' : 'AI 종합점수'}</span>
        <span class="scorebox__total">${esc(a.total)}<small>/100</small></span>
      </div>
      <details>
        <summary>평가 항목 자세히 보기 ▾</summary>
        <div class="bars">${bars}</div>
        ${rules ? '<p class="panel__note" style="margin-top:10px">평가 기준: 중요도=보도 언론사 수, 업무 연관도=분야 키워드, 최신성=발행 시각, 영향도=정책·출시·투자 등 변화 단어, 참신성=최근 3일 내 비슷한 기사 여부.</p>' : ''}
      </details>
    </div>

    ${bodyHtml}

    <section class="source-box" aria-label="원문">
      <a class="btn btn--primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ICON.ext} 원문 보기 · ${esc(a.source)}</a>
      <div class="btn-row">
        <button class="btn" data-share="${esc(a.id)}">${ICON.share} 공유하기</button>
        <button class="btn" data-star="${esc(a.id)}" data-star-label>${saved ? '★ 저장됨' : '☆ 저장하기'}</button>
      </div>
      <p class="source-meta">출처: ${esc(a.source)} · 발행 ${esc(new Date(a.publishedAt).toLocaleString('ko-KR'))}<br>${esc(coverage)}${a.isSample ? '<br><b>이 기사는 Demo Mode 의 가상 기사이며 실제 보도가 아닙니다.</b>' : ''}</p>
    </section>`,
  };
}

// ───────────────── ISSUE ─────────────────

export function issue(data, id) {
  const it = (data.briefing.issues || []).find((x) => x.id === id);
  if (!it) return { html: topbar('이슈') + empty('🔎', '이슈를 찾을 수 없습니다', '') };
  const idx = data.briefing.issues.indexOf(it) + 1;
  const list = it.articleIds.map((x) => data.byId.get(x)).filter(Boolean);
  const suffix = data.week ? `?w=${data.week}` : '';
  const label = data.week ? `${weekRange(data.briefing)} 꼭 알아야 할 3가지` : `${periodOf(data.briefing).P} 꼭 알아야 할 3가지`;
  return {
    title: it.title,
    html: `
    ${topbar(label)}
    <header class="page-head">
      <span class="eyebrow">ISSUE ${idx} / ${data.briefing.issues.length}</span>
      <h1 style="font-family:var(--font-serif)">${esc(it.title)}</h1>
    </header>
    ${
      data.briefing.analysis === 'rules'
        ? `<section class="panel panel--fact" style="margin-top:0">
      <div class="panel__label"><span class="eyebrow">📊 보도 현황 · 자동 집계</span></div>
      <p>${esc(it.summary)}</p>
      ${outletList(it.sources || [])}
    </section>`
        : `<section class="panel panel--ai" style="margin-top:0">
      <div class="panel__label"><span class="eyebrow">✦ AI 종합 분석</span></div>
      <p>${esc(it.summary)}</p>
      <p class="panel__note">아래 관련 기사 ${list.length}건을 근거로 작성되었습니다.</p>
    </section>`
    }
    <section class="section"><div class="section__head"><h2 class="section__title">관련 뉴스</h2></div>
      <div class="cards">${list.map((a) => card(a, { showRank: false, showCat: true, suffix })).join('')}</div>
    </section>`,
  };
}


// ───────────────── 지난 주간 브리핑 ─────────────────

function weekRange(b) {
  return `${shortDate(b.periodStart || b.date)} ~ ${shortDate(b.periodEnd || b.date)}`;
}

export function loading(title) {
  return { title, html: `${topbar(title)}<div class="empty"><div class="spinner" aria-hidden="true"></div><p>불러오는 중…</p></div>` };
}

export function loadFailed(title) {
  return { title, html: topbar(title) + empty('📡', '불러오지 못했습니다', '인터넷 연결을 확인한 뒤 다시 열어 주세요.') };
}

export function weeks(data, list) {
  const cur = data.briefing?.date;
  const items = list
    .map((w) => {
      const isCur = w.date === cur;
      const href = isCur ? '/home' : `/week/${w.date}`;
      const n = Object.values(w.counts || {}).reduce((x, y) => x + y, 0);
      return `
      <a class="week-item" href="#${href}" data-nav="${href}">
        <div class="week-item__head">
          <b>${esc(shortDate(w.periodStart))} ~ ${esc(shortDate(w.periodEnd))}</b>
          ${isCur ? '<span class="week-item__now">이번 주</span>' : ''}
          <span class="week-item__meta">${w.analysis === 'ai' ? 'AI 편집' : '자동 선정'} · ${n}건</span>
        </div>
        ${w.headline ? `<p class="week-item__headline">${esc(w.headline)}</p>` : ''}
        ${w.issues?.length ? `<ol class="week-item__issues">${w.issues.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
      </a>`;
    })
    .join('');
  const onlyCurrent = list.length <= 1;
  return {
    title: '지난 브리핑',
    html: `
    ${topbar('지난 주간 브리핑')}
    <header class="page-head">
      <span class="eyebrow">ARCHIVE</span>
      <h1>📚 지난 주간 브리핑</h1>
      <p>매주 월요일 발행된 브리핑을 최근 1년치까지 다시 볼 수 있어요.</p>
    </header>
    <div class="weeks">${items || ''}</div>
    ${onlyCurrent ? '<p class="footer-note">지난 브리핑은 다음 주 월요일부터 여기에 하나씩 쌓여요.</p>' : ''}`,
  };
}

export function week(wdata) {
  const b = wdata.briefing;
  const gen = new Date(b.generatedAt);
  const rules = b.analysis === 'rules';
  const suffix = `?w=${wdata.week}`;
  const total = CATEGORY_ORDER.reduce((n, c) => n + topOf(wdata, c).length, 0);
  return {
    title: `${weekRange(b)} 브리핑`,
    html: `
    ${topbar('지난 주간 브리핑')}
    <header class="page-head">
      <span class="eyebrow">WEEKLY BRIEFING</span>
      <h1>${esc(weekRange(b))} 주간 브리핑</h1>
      <p>발행 ${esc(formatShortDate(gen))} · ${rules ? '자동 선정' : 'AI 편집'} · 핵심 뉴스 ${total}건</p>
    </header>

    <section class="brief">
      <div class="eyebrow">${rules ? '✦ 가장 많이 보도된 뉴스' : '✦ AI 한 줄 브리핑'}</div>
      <p class="brief__text">${esc(b.headline || '')}</p>
      ${
        b.keywords?.length
          ? `<div><div class="brief__kw-label">핵심 키워드</div><div class="chips">${b.keywords.map((k) => `<a class="chip chip--hash" href="#/search?q=${encodeURIComponent(k)}" data-nav="/search?q=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div></div>`
          : ''
      }
    </section>

    ${
      b.issues?.length
        ? `<section class="section"><div class="section__head"><h2 class="section__title">🔥 꼭 알아야 할 3가지</h2></div><div class="issues">${issuesHtml(b, suffix)}</div></section>`
        : ''
    }

    ${sectionsHtml(wdata, '이 주에', { suffix, more: false })}

    <p class="footer-note">${
      rules ? '여러 언론사 보도·최신성·업무 연관도를 기준으로 선정한 뉴스입니다.' : '요약과 분석은 수집된 기사 정보만을 근거로 AI가 작성했습니다.'
    }<br>지난 기사는 원문 링크가 바뀌었을 수 있어요.</p>`,
    mount(root) {
      mountMore(root);
    },
  };
}

// ───────────────── MY NEWS ─────────────────

export function my(data) {
  const kws = store.getKeywords();
  const groups = kws.map((k) => ({ k, items: data.all.filter((a) => articleMatches(a, k)) }));
  const withNews = groups.filter((g) => g.items.length);
  const seen = new Set();

  const chips = kws.length
    ? kws.map((k) => {
        const n = groups.find((g) => g.k === k).items.length;
        return `<span class="chip">${esc(k)} <b style="font-family:var(--font-mono);font-size:11px;color:var(--ink-3)">${n}</b><button class="chip__x" data-remove-kw="${esc(k)}" aria-label="${esc(k)} 삭제">×</button></span>`;
      }).join('')
    : '<p class="result-count">아직 등록한 키워드가 없습니다. 입력하거나 아래 추천을 눌러 추가하세요.</p>';
  const suggestions = store.SUGGESTED_KEYWORDS.filter((k) => !kws.some((x) => x.toLowerCase() === k.toLowerCase()));
  const suggestHtml = suggestions.length
    ? `<div class="filter-group" style="margin-top:14px"><span class="filter-label">추천 키워드 · 눌러서 추가</span><div class="chips">${suggestions
        .map((k) => `<button type="button" class="chip chip--hash" data-add-kw="${esc(k)}">${esc(k)}</button>`)
        .join('')}</div></div>`
    : '';

  const body = withNews.length
    ? withNews
        .map((g) => {
          const items = g.items.filter((a) => !seen.has(a.id));
          items.forEach((a) => seen.add(a.id));
          if (!items.length) return '';
          return `<section class="section"><div class="section__head"><h2 class="section__title"># ${esc(g.k)}</h2><a class="section__more" href="#/search?q=${encodeURIComponent(g.k)}" data-nav="/search?q=${encodeURIComponent(g.k)}">${g.items.length}건 모두 보기</a></div><div class="cards">${items.map((a) => card(a, { showRank: false, showCat: true })).join('')}</div></section>`;
        })
        .join('')
    : empty('🗂️', '관심 키워드와 일치하는 뉴스가 아직 없습니다', '키워드를 추가하면 새로 들어온 뉴스 중 관련 기사를 여기에 모아 드립니다.');

  return {
    html: `
    <header class="page-head">
      <span class="eyebrow">MY NEWS</span>
      <h1>관심 키워드 뉴스</h1>
      <p>등록한 키워드가 들어간 뉴스를 모아 보여드립니다. 키워드는 이 휴대폰에만 저장되어 다른 사람에게 보이지 않습니다.</p>
    </header>
    <form class="field" id="kw-form" autocomplete="off">
      <div class="input-row">
        <input class="input" id="kw-input" name="kw" placeholder="예: Waymo, 보험사기" maxlength="30" aria-label="관심 키워드 입력">
        <button class="btn btn--primary btn--sm" type="submit">추가</button>
      </div>
    </form>
    <div class="chips" style="margin-top:12px">${chips}</div>
    ${suggestHtml}
    ${body}`,
    mount(root, ctx) {
      root.querySelector('#kw-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = root.querySelector('#kw-input');
        if (store.addKeyword(input.value)) ctx.rerender();
        else if (input.value.trim()) ctx.toast('이미 등록된 키워드입니다');
      });
      root.querySelectorAll('[data-add-kw]').forEach((b) =>
        b.addEventListener('click', () => {
          store.addKeyword(b.dataset.addKw);
          ctx.rerender();
        }),
      );
      root.querySelectorAll('[data-remove-kw]').forEach((b) =>
        b.addEventListener('click', () => {
          store.removeKeyword(b.dataset.removeKw);
          ctx.rerender();
        }),
      );
    },
  };
}

// ───────────────── SAVED ─────────────────

export function saved() {
  const list = store.getSaved();
  return {
    html: `
    <header class="page-head">
      <span class="eyebrow">SAVED</span>
      <h1>저장한 뉴스</h1>
      <p>${list.length ? `${list.length}건 · 이 휴대폰에만 저장됩니다.` : '⭐ 버튼을 눌러 나중에 다시 볼 뉴스를 저장하세요.'}</p>
    </header>
    <div class="cards">${list.map((a) => card(a, { showRank: false, showCat: true })).join('') || empty('☆', '저장한 뉴스가 없습니다', '뉴스 카드나 상세 화면의 ⭐ 버튼을 누르면 여기에 모입니다.')}</div>`,
  };
}

// ───────────────── SEARCH ─────────────────

export function search(data, params) {
  const sources = [...new Set(data.all.map((a) => a.source))].sort((a, b) => a.localeCompare(b, 'ko'));
  const state = {
    q: params.get('q') || '',
    period: params.get('period') || 'all',
    cat: params.get('cat') || 'all',
    source: params.get('source') || 'all',
  };

  const periodBtns = [
    ['all', '전체'],
    ['1', '오늘'],
    ['7', '7일'],
    ['30', '30일'],
  ];
  const catBtns = [['all', '전체'], ...CATEGORY_ORDER.map((c) => [c, CATEGORIES[c].name])];

  function results() {
    const now = Date.now();
    const list = data.all.filter((a) => {
      if (state.q && !articleMatches(a, state.q)) return false;
      if (state.cat !== 'all' && a.category !== state.cat) return false;
      if (state.source !== 'all' && a.source !== state.source) return false;
      if (state.period !== 'all') {
        const days = Number(state.period);
        const t = new Date(a.publishedAt).getTime();
        if (days === 1) {
          if (new Date(t).toDateString() !== new Date().toDateString()) return false;
        } else if (now - t > days * 86400000) return false;
      }
      return true;
    });
    if (!list.length) return empty('🔎', '검색 결과가 없습니다', '다른 키워드나 기간으로 검색해 보세요.');
    let lastDay = '';
    const rows = list
      .map((a) => {
        const d = new Date(a.publishedAt);
        const k = dayKey(d);
        const head = k !== lastDay ? `<div class="date-head">${esc(formatShortDate(d))}</div>` : '';
        lastDay = k;
        return head + card(a, { showRank: false, showCat: true });
      })
      .join('');
    return `<p class="result-count">${state.q ? `‘${esc(state.q)}’ ` : ''}검색 결과 <b>${list.length}</b>건 · 최신순</p><div class="cards">${rows}</div>`;
  }

  const seg = (name, items) =>
    `<div class="seg" role="group">${items.map(([v, l]) => `<button type="button" data-${name}="${esc(v)}" class="${state[name] === v ? 'is-active' : ''}">${esc(l)}</button>`).join('')}</div>`;

  return {
    html: `
    ${topbar('뉴스 검색')}
    <form id="search-form" class="field" role="search" autocomplete="off" style="margin-top:6px">
      <div class="input-row">
        <input class="input" id="search-q" type="search" placeholder="키워드 (예: Waymo, 손해율)" value="${esc(state.q)}" aria-label="검색어" enterkeyhint="search">
      </div>
    </form>
    <div style="display:grid;gap:14px;margin-top:14px">
      <div class="filter-group"><span class="filter-label">기간</span>${seg('period', periodBtns)}</div>
      <div class="filter-group"><span class="filter-label">카테고리</span><div class="chips">${catBtns
        .map(([v, l]) => `<button type="button" class="chip ${state.cat === v ? 'is-active' : ''}" data-cat="${esc(v)}">${esc(l)}</button>`)
        .join('')}</div></div>
      <div class="filter-group"><label class="filter-label" for="search-source">언론사</label>
        <select class="input" id="search-source"><option value="all">전체 언론사</option>${sources
          .map((s) => `<option value="${esc(s)}" ${state.source === s ? 'selected' : ''}>${esc(s)}</option>`)
          .join('')}</select>
      </div>
    </div>
    <section class="section" id="search-results" aria-live="polite">${results()}</section>`,
    mount(root) {
      const out = root.querySelector('#search-results');
      const update = () => (out.innerHTML = results());
      const input = root.querySelector('#search-q');
      let t;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.q = input.value.trim();
          update();
        }, 180);
      });
      root.querySelector('#search-form').addEventListener('submit', (e) => {
        e.preventDefault();
        state.q = input.value.trim();
        input.blur();
        update();
      });
      root.querySelectorAll('[data-period]').forEach((b) =>
        b.addEventListener('click', () => {
          state.period = b.dataset.period;
          root.querySelectorAll('[data-period]').forEach((x) => x.classList.toggle('is-active', x === b));
          update();
        }),
      );
      root.querySelectorAll('[data-cat]').forEach((b) =>
        b.addEventListener('click', () => {
          state.cat = b.dataset.cat;
          root.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('is-active', x === b));
          update();
        }),
      );
      root.querySelector('#search-source').addEventListener('change', (e) => {
        state.source = e.target.value;
        update();
      });
      if (!state.q) input.focus({ preventScroll: true });
    },
  };
}

// ───────────────── SETTINGS ─────────────────

export function settings(data) {
  const s = store.getSettings();
  if (s.theme !== 'dark') s.theme = 'light';
  const seg = (key, items) =>
    `<div class="seg" role="group">${items.map(([v, l]) => `<button type="button" data-set="${key}" data-val="${esc(v)}" class="${String(s[key]) === v ? 'is-active' : ''}">${esc(l)}</button>`).join('')}</div>`;
  const sw = (id, key) => `<label class="switch"><input type="checkbox" id="${id}" data-toggle="${key}" ${s[key] ? 'checked' : ''}><span></span></label>`;
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;

  return {
    html: `
    <header class="page-head">
      <span class="eyebrow">SETTINGS</span>
      <h1>설정</h1>
    </header>
    <div class="settings">
      <div class="group">
        <div class="group__title">화면</div>
        <div class="list">
          <div class="row row--stack"><div class="row__text"><span class="row__label">테마</span></div>${seg('theme', [['light', '라이트'], ['dark', '다크']])}</div>
        </div>
      </div>

      <div class="group" id="push-group">
        <div class="group__title">알림</div>
        <div class="list">
          <div class="row"><div class="row__text"><label class="row__label" for="sw-push">주간 브리핑 알림</label><span class="row__desc">매주 월요일, 이번 주 브리핑이 나오면 알려드려요</span></div><label class="switch"><input type="checkbox" id="sw-push" ${s.pushOn ? 'checked' : ''}><span></span></label></div>
          <div class="row"><div class="row__text"><label class="row__label" for="push-hour">받을 시간</label><span class="row__desc">월요일</span></div>
            <select class="input time-input" id="push-hour">${Array.from({ length: 16 }, (_, k) => k + 7).map((h) => `<option value="${h}" ${Number(s.pushHour) === h ? 'selected' : ''}>${h < 12 ? `오전 ${h}시` : h === 12 ? '낮 12시' : `오후 ${h - 12}시`}</option>`).join('')}</select></div>
          <button class="row row--btn" id="push-test" type="button" ${s.pushOn && PUSH_API ? '' : 'disabled'}>시험 알림 보내기</button>
        </div>
        <p class="notice" id="push-note" hidden></p>
        ${PUSH_API ? '' : '<p class="panel__note" id="push-pending" style="padding-left:4px">알림 연결 준비 중이에요. 지금 켜 두시면 연결되는 대로 자동으로 받게 됩니다.</p>'}
      </div>

      <div class="group">
        <div class="group__title">데이터</div>
        <div class="list">
          <div class="row"><div class="row__text"><span class="row__label">뉴스 데이터</span><span class="row__desc">현재: <b>${data.mode === 'live' ? (data.briefing.analysis === 'rules' ? '실제 뉴스 (자동 선정)' : '실제 뉴스 (AI 분석)') : 'Demo (가상 데이터)'}</b>${data.mode === 'live' ? '' : ' · 실제 뉴스 수집이 연결되면 자동으로 전환됩니다'}</span></div></div>
          <div class="row"><div class="row__text"><span class="row__label">마지막 업데이트</span></div><span class="row__desc" style="font-family:var(--font-mono)">${esc(new Date(data.briefing.generatedAt).toLocaleString('ko-KR'))}</span></div>
        </div>
      </div>

      <div class="group">
        <div class="group__title">앱 설치</div>
        <div class="list">
          ${
            isStandalone
              ? '<div class="row"><div class="row__text"><span class="row__label">✅ 홈 화면 앱으로 실행 중</span></div></div>'
              : `${window.__mbInstall ? '<div class="row"><div class="row__text"><span class="row__label">이 휴대폰에 바로 설치</span><span class="row__desc">버튼 한 번으로 홈 화면에 앱 아이콘이 생겨요</span></div><button class="btn btn--primary" type="button" id="install-btn" style="white-space:nowrap;flex:none">📲 설치</button></div>' : ''}
          <div class="row row--stack"><div class="row__text"><span class="row__label">휴대폰 홈 화면에 추가하기</span>
          <span class="row__desc install-steps"><b>iPhone (Safari)</b> 아래쪽 공유 버튼(□↑) → ‘홈 화면에 추가’ → ‘추가’<br>
          <b>Android (Chrome)</b> 주소창 오른쪽 ⋮ → ‘설치 및 바로가기 만들기’ → ‘설치’<br><span class="install-steps__sub">메뉴 이름이 ‘홈 화면에 추가’ 또는 ‘앱 설치’로 보이는 버전도 있어요</span><br>
          <b>삼성 인터넷</b> 아래쪽 ≡ → ‘현재 페이지 추가’ → ‘홈 화면’<br>
          <b>카카오톡에서 열었다면</b> 오른쪽 ⋮ → ‘다른 브라우저로 열기’를 먼저 눌러 주세요</span></div></div>`
          }
        </div>
      </div>

      <div class="group">
        <div class="group__title">개인 데이터</div>
        <div class="list">
${store.isAdmin() ? `          <div class="row"><div class="row__text"><span class="row__label">관심 키워드</span><span class="row__desc">${store.getKeywords().length}개 · MY NEWS 에서 관리</span></div><a class="section__more" href="#/my" data-nav="/my">관리 ›</a></div>` : ''}
          <div class="row"><div class="row__text"><span class="row__label">저장한 뉴스</span><span class="row__desc">${store.getSaved().length}건</span></div><a class="section__more" href="#/saved" data-nav="/saved">보기 ›</a></div>
          <button class="row row--btn row--danger" id="reset-btn" type="button">이 휴대폰의 저장 데이터 초기화</button>
        </div>
        <p class="notice">즐겨찾기·관심 키워드·설정은 이 휴대폰 안에만 저장되며 외부 서버나 AI로 전송되지 않습니다.</p>
      </div>

      ${
        store.isAdmin()
          ? `<div class="group">
        <div class="group__title">관리자</div>
        <div class="list">
          <div class="row"><div class="row__text"><span class="row__label">관리자 모드 켜짐</span><span class="row__desc">이 휴대폰에서만 MY NEWS 탭이 보입니다</span></div></div>
          <button class="row row--btn" id="admin-off" type="button">관리자 모드 끄기</button>
        </div>
      </div>`
          : `<form class="group admin-form" id="admin-form" hidden autocomplete="off">
        <div class="group__title">관리자 코드</div>
        <div class="input-row">
          <input class="input" id="admin-code" type="password" inputmode="numeric" placeholder="관리자 코드 입력" aria-label="관리자 코드">
          <button class="btn btn--primary btn--sm" type="submit">확인</button>
        </div>
      </form>`
      }

      <p class="footer-note"><span id="version-tap">MobiBrief AI · v0.6</span><br>공개 뉴스만 다루며, 기사 전문을 저장하지 않고 원문 링크로 연결합니다.</p>
    </div>`,
    mount(root, ctx) {
      root.querySelector('#install-btn')?.addEventListener('click', async () => {
        const ev = window.__mbInstall;
        if (!ev) return;
        ev.prompt();
        const { outcome } = await ev.userChoice.catch(() => ({}));
        window.__mbInstall = null;
        if (outcome === 'accepted') ctx.toast('홈 화면에 설치했어요');
        ctx.rerender();
      });
      root.querySelectorAll('[data-set]').forEach((b) =>
        b.addEventListener('click', async () => {
          const key = b.dataset.set;
          let val = b.dataset.val;
          if (key === 'breakingThreshold') val = Number(val);
          store.setSettings({ [key]: val });
          if (key === 'theme') ctx.applyTheme();
          root.querySelectorAll(`[data-set="${key}"]`).forEach((x) => x.classList.toggle('is-active', x === b));
        }),
      );
      // ───── 알림 켜기/끄기 ─────
      const pushSw = root.querySelector('#sw-push');
      if (pushSw) {
        const note = root.querySelector('#push-note');
        const testBtn = root.querySelector('#push-test');
        const hourSel = root.querySelector('#push-hour');
        const showNote = (html) => {
          note.innerHTML = html;
          note.hidden = !html;
        };
        const connected = push.pushConnected();
        const sync = (on) => {
          pushSw.checked = on;
          testBtn.disabled = !on || !connected;
          store.setSettings({ pushOn: on });
        };
        if (push.isIOS() && !push.isStandalone()) {
          pushSw.disabled = true;
          hourSel.disabled = true;
          showNote('<b>iPhone</b>은 이 앱을 <b>홈 화면에 추가</b>한 뒤, 홈 화면 아이콘으로 열어서 알림을 켜야 받을 수 있습니다 (iOS 16.4 이상).<br>Safari 하단 공유 버튼 → ‘홈 화면에 추가’');
        } else if (!push.browserSupportsPush()) {
          pushSw.disabled = true;
          showNote('이 브라우저에서는 알림을 받을 수 없습니다. 휴대폰의 Chrome 또는 홈 화면 앱에서 열어 주세요.');
        } else if (connected) {
          // 실제 구독 상태와 화면 맞추기 (휴대폰 설정에서 알림을 껐을 수 있음)
          push.currentSubscription().then((sub) => sync(Boolean(sub) && Notification.permission === 'granted')).catch(() => {});
        }
        pushSw.addEventListener('change', async () => {
          pushSw.disabled = true;
          try {
            if (pushSw.checked) {
              if (connected) await push.enablePush(Number(hourSel.value));
              else await push.askPermissionOnly(); // 연결 전: 허용만 받아 두고 연결 시 자동 등록
              sync(true);
              ctx.toast(`매주 월요일 ${hourSel.options[hourSel.selectedIndex].text}에 알려드릴게요`);
            } else {
              if (connected) await push.disablePush();
              sync(false);
              ctx.toast('알림을 껐습니다');
            }
            showNote('');
          } catch (e) {
            sync(false);
            showNote(String(e.message || e));
          } finally {
            pushSw.disabled = false;
          }
        });
        hourSel.addEventListener('change', async () => {
          store.setSettings({ pushHour: Number(hourSel.value) });
          if (!pushSw.checked) return;
          try {
            if (connected) await push.updateHour(Number(hourSel.value));
            ctx.toast(`매주 월요일 ${hourSel.options[hourSel.selectedIndex].text}로 바꿨습니다`);
          } catch (e) {
            showNote(String(e.message || e));
          }
        });
        testBtn.addEventListener('click', async () => {
          testBtn.disabled = true;
          try {
            await push.sendTest();
            ctx.toast('시험 알림을 보냈습니다. 잠시 후 도착해요');
          } catch (e) {
            showNote(String(e.message || e));
          } finally {
            setTimeout(() => (testBtn.disabled = !pushSw.checked), 3000);
          }
        });
      }
      // 관리자 모드: 버전 글자 5번 누르면 코드 입력칸 표시
      let taps = 0;
      let tapTimer;
      root.querySelector('#version-tap')?.addEventListener('click', () => {
        taps++;
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => (taps = 0), 2500);
        const form = root.querySelector('#admin-form');
        if (taps >= 5 && form) {
          form.hidden = false;
          root.querySelector('#admin-code').focus();
          form.scrollIntoView({ block: 'center' });
        }
      });
      root.querySelector('#admin-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = root.querySelector('#admin-code');
        if (await verifyAdminCode(input.value)) {
          store.setAdmin(true);
          ctx.toast('관리자 모드를 켰습니다 · MY NEWS 탭이 보입니다');
          ctx.rerender();
        } else {
          input.value = '';
          ctx.toast('코드가 맞지 않습니다');
        }
      });
      root.querySelector('#admin-off')?.addEventListener('click', () => {
        store.setAdmin(false);
        ctx.toast('관리자 모드를 껐습니다');
        ctx.rerender();
      });
      const reset = root.querySelector('#reset-btn');
      reset.addEventListener('click', () => {
        if (reset.dataset.confirm) {
          store.resetAll();
          ctx.applyTheme();
          ctx.toast('초기화했습니다');
          ctx.rerender();
        } else {
          reset.dataset.confirm = '1';
          reset.textContent = '한 번 더 누르면 초기화됩니다';
          setTimeout(() => {
            delete reset.dataset.confirm;
            reset.textContent = '이 휴대폰의 저장 데이터 초기화';
          }, 3000);
        }
      });
    },
  };
}
