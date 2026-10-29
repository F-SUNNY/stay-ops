const VERSION = 'v9';
const SHELL = ['./', './index.html', './app.js', './store.js', './calc.js', './firebase-config.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 같은 출처의 GET 만 다룬다. 네트워크 우선, 실패하면 캐시
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    // 브라우저 HTTP 캐시를 건너뛰고 서버에 확인한다(ETag 로 304 면 비용 없음)
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
