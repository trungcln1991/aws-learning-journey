const CACHE_NAME = 'aws-learn-v8';
const STATIC_ASSETS = [
  './',
  './index.html',
  './lesson.html',
  './lessons.html',
  './stats.html',
  './guides.html',
  './quiz.html',
  './css/app.css',
  './js/main.js',
  './js/lesson.js',
  './js/quiz.js',
  './js/auth.js',
  './js/srs.js',
  './news.html',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './lessons/meta.json',
];

// Install: cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for static, network-first for lesson JSON
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // context.json + news.json: network-first so suggestions stay fresh
  if (url.pathname.endsWith('/context.json') || url.pathname.endsWith('/news.json')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Lesson JSON: network-first (data may update), fall back to cache
  if (url.pathname.includes('/lessons/') && url.pathname.endsWith('.json') && !url.pathname.includes('meta')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
