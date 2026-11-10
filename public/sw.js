/* WalMark service worker: network-first for pages, cache-first for static assets.
   API calls are never cached. Bump VERSION to drop old caches. */
const VERSION = 'walmark-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  const isStatic = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/pdfjs/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname);

  event.respondWith(
    isStatic
      ? caches.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
              return res;
            }),
        )
      : fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
            return res;
          })
          .catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
  );
});
