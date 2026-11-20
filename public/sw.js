// Minimal Service Worker to satisfy PWA installability without caching API or auth payloads.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/divide/api')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request));
  }
});
