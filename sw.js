// Offline-Cache. Bei Änderungen an der App VERSION erhöhen.
const VERSION = 'dxfgewicht-v6';
const INBOX = 'share-inbox';
const FILES = ['./', 'index.html', 'app.js', 'dxf.js', 'firma.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'lib/fflate.min.js', 'lib/jspdf.umd.min.js', 'lib/jspdf.plugin.autotable.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== INBOX).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Teilen-Ziel: Dateien aus anderen Apps (z. B. WhatsApp) zwischenspeichern und App öffnen
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const cache = await caches.open(INBOX);
        for (const k of await cache.keys()) await cache.delete(k);
        let i = 0;
        for (const f of fd.getAll('files')) {
          if (!(f instanceof File)) continue;
          await cache.put(new Request('inbox/' + (i++)), new Response(f, {
            headers: { 'x-name': encodeURIComponent(f.name), 'content-type': f.type || 'application/octet-stream' }
          }));
        }
      } catch (err) { /* App öffnet trotzdem */ }
      return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  // Netzwerk zuerst (für Updates), bei Offline aus dem Cache
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
