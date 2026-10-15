// Service Worker: speichert die App beim ersten Aufruf, danach läuft sie komplett offline.
// VERSION und PRECACHE werden von tools/web/build.py gesetzt – nicht von Hand ändern.

const VERSION = '29415c880459';
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/category-style.js',
  'js/data/backup.js',
  'js/data/catalog-import.js',
  'js/data/repository.js',
  'js/data/share.js',
  'js/list-model.js',
  'js/photo.js',
  'js/search.js',
  'js/storage/idb-store.js',
  'js/storage/memory-store.js',
  'js/units.js',
  'js/views/backup-view.js',
  'js/views/dom.js',
  'js/views/edit-sheet.js',
  'js/views/planning-view.js',
  'js/views/settings-view.js',
  'js/views/share-view.js',
  'js/views/shopping-view.js',
  'js/views/units-view.js',
  'data/catalog.json',
  'data/images.json',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'images/aepfel.jpg',
  'images/aufschnitt.jpg',
  'images/avocados.jpg',
  'images/bacon.jpg',
  'images/bananen.jpg',
  'images/bier.jpg',
  'images/birnen.jpg',
  'images/brezeln.jpg',
  'images/broetchen.jpg',
  'images/brokkoli.jpg',
  'images/brot.jpg',
  'images/butter.jpg',
  'images/champignons.jpg',
  'images/eier.jpg',
  'images/erdbeeren.jpg',
  'images/feta.jpg',
  'images/gehackte-tomaten.jpg',
  'images/geriebener-kaese.jpg',
  'images/gurke.jpg',
  'images/hackfleisch.jpg',
  'images/ingwer.jpg',
  'images/joghurt.jpg',
  'images/karotten.jpg',
  'images/kartoffeln.jpg',
  'images/kuerbis.jpg',
  'images/lachs.jpg',
  'images/lasagneplatten.jpg',
  'images/mais.jpg',
  'images/mango.jpg',
  'images/milch.jpg',
  'images/olivenoel.jpg',
  'images/orangen.jpg',
  'images/parmesan.jpg',
  'images/pfirsiche.jpg',
  'images/pommes.jpg',
  'images/putenbrust.jpg',
  'images/quinoa.jpg',
  'images/reis.jpg',
  'images/rindersteak.jpg',
  'images/salami.jpg',
  'images/salat.jpg',
  'images/salz.jpg',
  'images/schalotten.jpg',
  'images/schnitzel.jpg',
  'images/spaghetti.jpg',
  'images/spinat.jpg',
  'images/tomaten.jpg',
  'images/wasser.jpg',
  'images/wraps.jpg',
];

const CACHE = `feedyourself-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('feedyourself-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Erst aus dem Speicher, sonst aus dem Netz (und dann merken). Seitenaufrufe fallen offline auf index.html zurück.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      if (request.mode === 'navigate') return (await cache.match('index.html')) ?? Response.error();
      throw error;
    }
  })());
});
