/* Invoice Studio service worker — makes the installed app fast and offline-capable.
   App shell is cache-first; /api/* is always network (licensing + smart features must be live). */
const CACHE = 'invoice-studio-v1';
const SHELL = [
  '/', '/index.html', '/styles.css',
  '/core.js', '/views.js', '/views2.js', '/auth.js', '/actions.js',
  '/manifest.webmanifest', '/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                 // let cross-origin (fonts) pass through
  if (url.pathname.startsWith('/api/')) return;               // never cache licensing / AI calls

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('/index.html'));            // offline SPA fallback
    })
  );
});
