const CACHE = 'piano-v9';
// Le modèle de transcription (60 Mo) vit dans un cache SÉPARÉ et durable :
// il survit aux mises à jour de l'app (sinon 60 Mo retéléchargés à chaque bump).
const MODEL_CACHE = 'piano-model-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './modules/transcription.js',
  './modules/notation.js',
  './modules/icons.js',
  './manifest.json',
  './vendor/magentamusic.min.js',
  './fonts/fraunces.woff2',
  './fonts/inter.woff2',
  './icons/icon-v4.svg',
  './icons/icon-180-v4.png',
  './icons/icon-192-v4.png',
  './icons/icon-512-v4.png',
];

self.addEventListener('install', (e) => {
  // cache:'reload' bypasses the HTTP cache (GitHub Pages max-age=600) so a
  // version bump never precaches stale copies.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== MODEL_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isModel = url.pathname.includes('/model/');
  const cacheName = isModel ? MODEL_CACHE : CACHE;
  const matchOpts = req.mode === 'navigate' ? { ignoreSearch: true } : undefined;
  e.respondWith(
    caches.match(req, matchOpts).then(cached => {
      const fetchPromise = fetch(req).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(cacheName).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
