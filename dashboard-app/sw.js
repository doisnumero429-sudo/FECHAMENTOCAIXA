// Service worker do Painel Araçá Grill.
// Estratégia: network-first para o HTML (dados sempre frescos), cache-first
// para o restante — o painel abre mesmo sem internet, com os últimos dados vistos.
const CACHE = 'painel-araca-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(req, clone));
      return resp;
    }).catch(() => caches.match(req))
  );
});
