import { loadData } from './data.js';
import * as views from './views.js';
import * as store from './store.js';
import { toast } from './util.js';

const viewEl = document.getElementById('view');
const banner = document.getElementById('demo-banner');
const inline = !!window.__MOBIBRIEF_INLINE__;

// 미리보기(단일 HTML) 환경에서는 주소창 해시를 쓰지 않고 내부 스택으로 이동합니다.
const stack = [];
let current = '/home';
let data = null;
const scrollMemo = new Map();
let renderedPath = null;
let depth = 0; // 앱 안에서 이동한 횟수 (뒤로 버튼이 앱 밖으로 나가지 않도록)

function currentPath() {
  if (inline) return current;
  const h = location.hash.replace(/^#/, '');
  return h && h.startsWith('/') ? h : '/home';
}

export function navigate(path, { replace = false } = {}) {
  if (inline) {
    scrollMemo.set(current, window.scrollY);
    if (!replace) stack.push(current);
    current = path;
    render();
  } else if (replace) {
    location.replace(`#${path}`);
  } else {
    depth++;
    location.hash = path;
  }
}

function back() {
  if (inline) {
    if (stack.length) {
      scrollMemo.set(current, 0);
      current = stack.pop();
      render({ restore: true });
    } else navigate('/home', { replace: true });
    return;
  }
  if (depth > 0) {
    depth--;
    history.back();
  } else navigate('/home', { replace: true });
}

function applyTheme() {
  const t = store.getSettings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
}

function route(path) {
  const [p, qs = ''] = path.split('?');
  const params = new URLSearchParams(qs);
  const seg = p.split('/').filter(Boolean);
  const [name, arg] = seg;
  switch (name) {
    case 'category':
      return { tab: 'category', view: views.category(data, arg || 'auto') };
    case 'article':
      return { tab: null, view: views.article(data, decodeURIComponent(arg || '')) };
    case 'issue':
      return { tab: 'home', view: views.issue(data, decodeURIComponent(arg || '')) };
    case 'my':
      // MY NEWS 는 관리자 모드에서만
      if (!store.isAdmin()) return { tab: 'home', view: views.home(data) };
      return { tab: 'my', view: views.my(data) };
    case 'saved':
      return { tab: 'saved', view: views.saved(data) };
    case 'settings':
      return { tab: 'settings', view: views.settings(data) };
    case 'search':
      return { tab: null, view: views.search(data, params) };
    default:
      return { tab: 'home', view: views.home(data) };
  }
}

const ctx = {
  navigate,
  toast,
  applyTheme,
  rerender: () => render({ restore: true, keepScroll: true }),
  reload: async () => {
    data = await loadData({ force: true });
    render({ keepScroll: true });
  },
};

function render({ restore = false, keepScroll = false } = {}) {
  if (!data) return;
  const path = currentPath();
  const y = window.scrollY;
  const { tab, view } = route(path);
  renderedPath = path;
  banner.hidden = data.mode !== 'demo';
  document.querySelectorAll('[data-admin-only]').forEach((el) => (el.hidden = !store.isAdmin()));
  document.body.classList.toggle('has-demo', data.mode === 'demo');
  viewEl.innerHTML = view.html;
  viewEl.classList.remove('fade-in');
  void viewEl.offsetWidth;
  viewEl.classList.add('fade-in');
  view.mount?.(viewEl, ctx);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
  document.title = view.title ? `${view.title} · MobiBrief AI` : 'MobiBrief AI';
  if (keepScroll) window.scrollTo(0, y);
  else window.scrollTo(0, restore || !inline ? scrollMemo.get(path) || 0 : 0);
}

// ───────── 공통 클릭 처리 (이동 · 즐겨찾기 · 공유 · 뒤로) ─────────
document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-nav]');
  const star = e.target.closest('[data-star]');
  const share = e.target.closest('[data-share]');
  const backBtn = e.target.closest('[data-back]');

  if (star) {
    e.preventDefault();
    const id = star.dataset.star;
    const a = data.byId.get(id) || store.getSaved().find((s) => s.id === id);
    if (!a) return;
    const on = store.toggleSaved(a);
    document.querySelectorAll(`[data-star="${CSS.escape(id)}"]`).forEach((el) => {
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-pressed', String(on));
      if (el.hasAttribute('data-star-label')) el.textContent = on ? '★ 저장됨' : '☆ 저장하기';
      else el.setAttribute('aria-label', on ? '저장 취소' : '저장하기');
    });
    toast(on ? 'Saved 에 저장했습니다' : '저장을 취소했습니다');
    if (currentPath() === '/saved') ctx.rerender();
    return;
  }
  if (share) {
    e.preventDefault();
    const a = data.byId.get(share.dataset.share) || store.getSaved().find((s) => s.id === share.dataset.share);
    if (a) shareArticle(a);
    return;
  }
  if (backBtn) {
    e.preventDefault();
    back();
    return;
  }
  if (nav && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const path = nav.dataset.nav;
    if (path === currentPath()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate(path, { replace: nav.hasAttribute('data-replace') });
  }
});

async function shareArticle(a) {
  const prefix = a.isSample ? '[샘플·가상 기사] ' : '';
  const summary = a.oneLiner ? `\n\n${a.analysis === 'rules' ? '요약' : 'AI 한 줄 요약'}: ${a.oneLiner}` : '';
  const text = `${prefix}${a.title}${summary}`;
  const payload = { title: `${prefix}${a.title}`, text, url: a.url };
  try {
    if (navigator.share) {
      await navigator.share(payload);
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n원문: ${a.url}`);
    toast('공유 내용을 복사했습니다');
  } catch {
    toast('이 환경에서는 공유를 지원하지 않습니다');
  }
}

if (!inline) {
  window.addEventListener('hashchange', () => render({ restore: true }));
  window.addEventListener('scroll', () => renderedPath === currentPath() && scrollMemo.set(renderedPath, window.scrollY), { passive: true });
}

// 다른 탭/앱에서 돌아왔을 때 날짜가 바뀌었으면 새 데이터 확인
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !data) return;
  const gen = new Date(data.briefing.generatedAt);
  if (Date.now() - gen.getTime() > 3 * 3600000) {
    data = await loadData({ force: true });
    render({ keepScroll: true });
  }
});

async function start() {
  applyTheme();
  viewEl.innerHTML = '<div class="skeleton"><div></div><div></div><div></div></div>';
  try {
    data = await loadData();
    render();
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="empty"><div class="empty__icon">⚠️</div><b>뉴스 데이터를 불러오지 못했습니다</b><p>인터넷 연결을 확인한 뒤 새로고침해 주세요.<br><small>${String(err.message || err).replace(/[<>&]/g, '')}</small></p></div>`;
  }
  if (!inline && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 등록 실패', e));
  }
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
start();
