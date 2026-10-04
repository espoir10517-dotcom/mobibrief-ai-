// MobiBrief AI 서비스 워커
// - 앱 화면 파일: 캐시 우선 (오프라인에서도 앱이 열림)
// - 뉴스 데이터(JSON): 네트워크 우선, 실패 시 마지막으로 받은 데이터
// - Phase 5 에서 푸시 알림(push / notificationclick) 처리를 이 파일에 추가합니다.

const VERSION = 'mobibrief-v0.3.0';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/views.js',
  './js/data.js',
  './js/store.js',
  './js/util.js',
  './js/core/trend.js',
  './js/core/select.js',
  './js/core/scoring.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || new Response('{}', { status: 504 }))),
    );
    return;
  }

  // 캐시된 화면을 바로 보여주고, 뒤에서 최신 파일로 갱신 (다음 실행 때 반영)
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
