const CACHE = 'inventaire-v5';
const CORE = [
  './',
  'index.html',
  'suggest.js',
  'receipt.js',
  'manifest.webmanifest',
  'icon-192.png',
  'apple-touch-icon.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

// Cache the app shell on install, bypassing the browser's HTTP cache so an
// update never captures a stale copy. Fonts are cached opportunistically below,
// and the page falls back to system faces if they never arrive.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(CORE.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first, so the app opens instantly and works with no signal.
// Network responses refresh the cache in the background.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      const live = fetch(e.request).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || live;
    })
  );
});
