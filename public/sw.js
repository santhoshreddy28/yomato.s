const CACHE = 'yomato-v5';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
// Network-first for pages/scripts (never serve stale code), cache-first for photos and fonts.
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET' || !r.url.startsWith('http') || /\.apk$/i.test(new URL(r.url).pathname) || r.headers.has('range')) return;   // let the browser download the APK itself
  const staticAsset = /\/images\/|\.(?:woff2?|svg|jpg|png)$/.test(new URL(r.url).pathname);
  e.respondWith(staticAsset
    ? caches.match(r).then(c => c || fetch(r).then(res => { caches.open(CACHE).then(ch => ch.put(r, res.clone())); return res; }))
    : fetch(r).then(res => { caches.open(CACHE).then(ch => ch.put(r, res.clone())); return res; }).catch(() => caches.match(r).then(c => c || caches.match('./index.html'))));
});
