// Service Worker: speichert die App beim ersten Aufruf, danach läuft sie komplett offline.
// VERSION und PRECACHE werden von tools/web/build.py gesetzt – nicht von Hand ändern.

const VERSION = '6a2783fecf12';
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
  'js/data/suggest.js',
  'js/list-model.js',
  'js/photo.js',
  'js/search.js',
  'js/storage/idb-store.js',
  'js/storage/memory-store.js',
  'js/sync/client.js',
  'js/sync/clock.js',
  'js/sync/crypto.js',
  'js/sync/join.js',
  'js/sync/replica.js',
  'js/sync/shared-list.js',
  'js/sync/shared-store.js',
  'js/theme.js',
  'js/units.js',
  'js/views/backup-view.js',
  'js/views/dom.js',
  'js/views/edit-sheet.js',
  'js/views/planning-view.js',
  'js/views/settings-view.js',
  'js/views/share-view.js',
  'js/views/shared-view.js',
  'js/views/shopping-view.js',
  'js/views/suggest-view.js',
  'js/views/units-view.js',
  'js/views/view-choice.js',
  'data/catalog.json',
  'data/images.json',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'images/aepfel.jpg',
  'images/alufolie.jpg',
  'images/ananas.jpg',
  'images/apfelsaft.jpg',
  'images/aufschnitt.jpg',
  'images/avocados.jpg',
  'images/backpapier.jpg',
  'images/backpulver.jpg',
  'images/bacon.jpg',
  'images/baguette.jpg',
  'images/bananen.jpg',
  'images/basilikum.jpg',
  'images/bier.jpg',
  'images/birnen.jpg',
  'images/blumenkohl.jpg',
  'images/bratwurst.jpg',
  'images/brezeln.jpg',
  'images/broetchen.jpg',
  'images/brokkoli.jpg',
  'images/brot.jpg',
  'images/butter.jpg',
  'images/butterschmalz.jpg',
  'images/cashews.jpg',
  'images/champignons.jpg',
  'images/deo.jpg',
  'images/duschgel.jpg',
  'images/edamame.jpg',
  'images/eier.jpg',
  'images/erdbeeren.jpg',
  'images/feta.jpg',
  'images/fluessigseife.jpg',
  'images/frischhaltefolie.jpg',
  'images/frischkaese.jpg',
  'images/fusilli.jpg',
  'images/gehackte-tomaten.jpg',
  'images/gemuesebruehe.jpg',
  'images/geriebener-kaese.jpg',
  'images/getrocknete-tomaten.jpg',
  'images/grillkohle.jpg',
  'images/gurke.jpg',
  'images/hackfleisch.jpg',
  'images/haferflocken.jpg',
  'images/hefe.jpg',
  'images/heidelbeeren.jpg',
  'images/himbeeren.jpg',
  'images/honig.jpg',
  'images/ingwer.jpg',
  'images/italienische-kraeuter.jpg',
  'images/joghurt-laktosefrei.jpg',
  'images/joghurt.jpg',
  'images/kaffee.jpg',
  'images/karotten.jpg',
  'images/kartoffeln.jpg',
  'images/ketchup.jpg',
  'images/kichererbsen.jpg',
  'images/kidneybohnen.jpg',
  'images/kiwis.jpg',
  'images/kochschinken.jpg',
  'images/kokosmilch.jpg',
  'images/kuerbis.jpg',
  'images/lachs.jpg',
  'images/lasagneplatten.jpg',
  'images/limetten.jpg',
  'images/linsen.jpg',
  'images/mais.jpg',
  'images/mango.jpg',
  'images/marmelade.jpg',
  'images/mayonnaise.jpg',
  'images/mehl.jpg',
  'images/milch.jpg',
  'images/mozzarella.jpg',
  'images/muellbeutel.jpg',
  'images/muesliriegel.jpg',
  'images/nuesse.jpg',
  'images/olivenoel.jpg',
  'images/orangen.jpg',
  'images/orangensaft.jpg',
  'images/paprika.jpg',
  'images/parmesan.jpg',
  'images/penne.jpg',
  'images/petersilie.jpg',
  'images/pfeffer.jpg',
  'images/pfirsiche.jpg',
  'images/pommes.jpg',
  'images/proteinriegel.jpg',
  'images/putenbrust.jpg',
  'images/quark.jpg',
  'images/quinoa.jpg',
  'images/rapsoel.jpg',
  'images/rasierklingen.jpg',
  'images/reis.jpg',
  'images/rindersteak.jpg',
  'images/sahne.jpg',
  'images/salami.jpg',
  'images/salat.jpg',
  'images/salz.jpg',
  'images/schalotten.jpg',
  'images/schnitzel.jpg',
  'images/schokolade.jpg',
  'images/schokostreusel.jpg',
  'images/sekt.jpg',
  'images/senf.jpg',
  'images/sojasosse.jpg',
  'images/spaghetti.jpg',
  'images/speckwuerfel.jpg',
  'images/spinat.jpg',
  'images/spuelmaschinentabs.jpg',
  'images/spuelmittel.jpg',
  'images/tee.jpg',
  'images/thunfisch.jpg',
  'images/toast.jpg',
  'images/toilettenpapier.jpg',
  'images/tomaten.jpg',
  'images/tomatenmark.jpg',
  'images/tomatensosse.jpg',
  'images/trauben.jpg',
  'images/wasser.jpg',
  'images/wein.jpg',
  'images/whisky.jpg',
  'images/wischlappen.jpg',
  'images/wraps.jpg',
  'images/zahnpasta.jpg',
  'images/zucchini.jpg',
  'images/zucker.jpg',
];

const CACHE = `feedyourself-${VERSION}`;

self.addEventListener('install', (event) => {
  // cache: 'reload' umgeht den HTTP-Cache des Browsers – sonst landen nach einem Update evtl. noch alte Dateien im neuen Speicher.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
