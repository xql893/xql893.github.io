const CACHE = 'radio-pwa-v1';
const ASSETS = [
  './', './index.html', './styles.css', './app.js',
  './hls.min.js', './icon.svg', './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 仅缓存同源静态资源（app shell）；跨域的 API 与音频流直接转发，不拦截
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin === location.origin && e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then(r =>
        r || fetch(e.request).then(resp => {
          const cp = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, cp));
          return resp;
        }).catch(() => caches.match('./index.html'))
      )
    );
  }
});
