/* Service Worker du formulaire KYC/LCB-FT (kyc.thebureau.paris).
   Network-first pour le HTML -> le dernier formulaire publié est TOUJOURS servi (fini le cache figé ~10 min de GitHub Pages).
   N'intercepte QUE le même domaine + les GET : les appels externes (Apps Script, Base Adresse Nationale, INPI…) passent normalement. */
const CACHE = "kyc-v1";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;                 // POST (soumissions) -> jamais touché
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;          // cross-origin (script.google.com, data.gouv…) -> géré par le navigateur
  const p = u.pathname;
  const networkFirst = p === "/" || p === "" || p === "/maj" || p.endsWith(".html") || p.endsWith("manifest.json");
  if (networkFirst) {
    e.respondWith(
      fetch(e.request, { cache: "no-cache" }).then(r => {
        const k = new Request(u.origin + u.pathname);
        caches.open(CACHE).then(c => c.put(k, r.clone()));
        return r;
      }).catch(() => caches.match(new Request(u.origin + u.pathname)).then(r => r || caches.match(e.request)))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
  }
});
