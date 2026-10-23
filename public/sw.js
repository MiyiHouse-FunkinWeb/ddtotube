// Service worker minimal agar bisa di-install sebagai app (PWA/APK)
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname.startsWith('/api')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
