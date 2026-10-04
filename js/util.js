export const CATEGORIES = {
  auto: { key: 'auto', name: '자동차보험', emoji: '🚗', en: 'AUTO INSURANCE' },
  mobility: { key: 'mobility', name: '모빌리티', emoji: '🚘', en: 'MOBILITY' },
  insurance: { key: 'insurance', name: '보험', emoji: '🏦', en: 'INSURANCE' },
  ai: { key: 'ai', name: 'AI 기술', emoji: '🤖', en: 'AI TECH' },
};
export const CATEGORY_ORDER = ['auto', 'mobility', 'insurance', 'ai'];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// 외부 링크는 http(s)만 허용
export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '#';
  } catch {
    return '#';
  }
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function formatFullDate(d = new Date()) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`;
}
export function formatTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function formatShortDate(d) {
  return `${d.getMonth() + 1}.${d.getDate()} (${WD[d.getDay()]})`;
}
export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function timeAgo(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const m = Math.round((now - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return formatShortDate(new Date(t));
}

export function articleMatches(article, keyword) {
  const k = String(keyword).trim().toLowerCase();
  if (!k) return false;
  const hay = [
    article.title,
    article.originalTitle,
    article.oneLiner,
    article.source,
    ...(article.keywords || []),
    ...(article.summary3 || []),
  ]
    .join(' ')
    .toLowerCase();
  if (hay.includes(k)) return true;
  // '자동차보험 제도' 처럼 여러 단어인 키워드는 모든 단어가 있으면 일치
  const parts = k.split(/\s+/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => hay.includes(p));
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

export const ICON = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12v7.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V12"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};
