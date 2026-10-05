import { loadData, loadWeeks, weeksCached, loadWeek, weekCached, findArticle } from './data.js';
import * as views from './views.js';
import * as store from './store.js';
import { toast } from './util.js';
import * as push from './push.js';

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
  // 라이트/다크 두 가지 (예전 '시스템' 설정은 라이트로)
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
}

// 지난 브리핑처럼 따로 받아야 하는 데이터: 먼저 '불러오는 중' 화면 → 받은 뒤 다시 그리기
function lazy(tab, title, load) {
  const pathAtStart = currentPath();
  return {
    tab,
    view: {
      ...views.loading(title),
      mount(root) {
        load()
          .then(() => {
            if (currentPath() === pathAtStart) render();
          })
          .catch(() => {
            if (currentPath() === pathAtStart) root.innerHTML = views.loadFailed(title).html;
          });
      },
    },
  };
}

function route(path) {
  const [p, qs = ''] = path.split('?');
  const params = new URLSearchParams(qs);
  const seg = p.split('/').filter(Boolean);
  const [name, arg] = seg;
  // ?w=날짜 : 지난 주 브리핑 안의 기사·이슈
  const w = params.get('w');
  const scoped = w && w !== data.briefing.date ? weekCached(w) : data;
  if (w && w !== data.briefing.date && !scoped) return lazy(name === 'issue' ? 'home' : null, '지난 브리핑', () => loadWeek(data, w));
  switch (name) {
    case 'weeks': {
      const list = weeksCached();
      if (!list) return lazy('home', '지난 브리핑', loadWeeks);
      return { tab: 'home', view: views.weeks(data, list) };
    }
    case 'week': {
      const d = decodeURIComponent(arg || '');
      if (d === data.briefing.date) return { tab: 'home', view: views.home(data) };
      const wd = weekCached(d);
      if (!wd) return lazy('home', '지난 브리핑', () => loadWeek(data, d));
      return { tab: 'home', view: views.week(wd) };
    }
    case 'category':
      return { tab: 'category', view: views.category(data, arg || 'auto') };
    case 'article':
      return { tab: null, view: views.article(scoped, decodeURIComponent(arg || '')) };
    case 'issue':
      return { tab: 'home', view: views.issue(scoped, decodeURIComponent(arg || '')) };
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

// 안드로이드 Chrome: '앱 설치' 버튼용 (브라우저가 설치 가능하다고 알려줄 때만)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__mbInstall = e;
  if (currentPath() === '/settings') render({ keepScroll: true });
});
window.addEventListener('appinstalled', () => {
  window.__mbInstall = null;
  if (currentPath() === '/settings') render({ keepScroll: true });
});

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
    const a = findArticle(data, id) || store.getSaved().find((s) => s.id === id);
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
    const a = findArticle(data, share.dataset.share) || store.getSaved().find((s) => s.id === share.dataset.share);
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
    // 새 버전이 설치되면 한 번 자동 새로고침해서 바로 최신 화면을 보여줌
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) {
        reloaded = true;
        location.reload();
      }
    });
    navigator.serviceWorker
      .register('sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .then(async () => {
        // 미리 알림을 켜 둔 사용자는 알림 서버가 연결되면 자동 등록
        const st = store.getSettings();
        if (st.pushOn) {
          await push.autoConnect(st.pushHour || 8).catch(() => {});
        }
      })
      .catch((e) => console.warn('SW 등록 실패', e));
  }
}

start();
