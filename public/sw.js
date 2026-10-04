// MobiBrief AI 서비스 워커
// - 화면 파일·뉴스 데이터 모두: 인터넷이 되면 항상 최신 파일(네트워크 우선), 안 되면 마지막으로 받은 파일
//   (예전 화면이 계속 보이는 문제를 막기 위해 브라우저 캐시도 매번 서버에 확인)
// - Phase 5 에서 푸시 알림(push / notificationclick) 처리를 이 파일에 추가합니다.

const VERSION = 'mobibrief-v0.4.1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/views.js',
  './js/data.js',
  './js/store.js',
  './js/util.js',
  './js/admin.js',
  './js/core/trend.js',
  './js/core/select.js',
  './js/core/scoring.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // 페이지 이동 요청은 옵션을 붙여 다시 만들 수 없어서 주소로 새 요청을 만듦
  const fresh = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(e.request, { ignoreSearch: true })
          .then((r) => r || (url.pathname.includes('/data/') ? new Response('{}', { status: 504 }) : caches.match('./index.html'))),
      ),
  );
});
