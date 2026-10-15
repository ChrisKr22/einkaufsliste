// Start der App: Speicher öffnen, Katalog übernehmen, Ansichten verbinden, Offline-Modus aktivieren.

import { importCatalog } from './data/catalog-import.js';
import { ShoppingRepository } from './data/repository.js';
import { ListModel } from './list-model.js';
import { openIdbStore } from './storage/idb-store.js';
import { MemoryStore } from './storage/memory-store.js';
import { mountBackupSection } from './views/backup-view.js';
import { mountEditSheet } from './views/edit-sheet.js';
import { esc, setPhotoSources } from './views/dom.js';
import { mountPlanningView } from './views/planning-view.js';
import { mountSettingsView } from './views/settings-view.js';
import { mountIncomingDialog, mountPasteSection, mountShareButton, receiveFromLocation } from './views/share-view.js';
import { mountShoppingView } from './views/shopping-view.js';
import { mountProductUnits } from './views/units-view.js';

async function openStore() {
  try {
    return await openIdbStore();
  } catch (error) {
    console.warn('IndexedDB nicht verfügbar, Daten nur bis zum Schließen:', error);
    return new MemoryStore();
  }
}

/** Katalogfotos, die das Build-Skript nach images/ kopiert hat; „full“ = Fotos mit Hintergrund. */
async function loadBundledImages() {
  try {
    const response = await fetch('data/images.json');
    if (!response.ok) return { bundled: new Set(), full: new Set() };
    const data = await response.json();
    if (Array.isArray(data)) return { bundled: new Set(data), full: new Set() };
    return { bundled: new Set(data.ids ?? []), full: new Set(data.full ?? []) };
  } catch {
    return { bundled: new Set(), full: new Set() };
  }
}

async function loadCatalog(store) {
  const response = await fetch('data/catalog.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Katalog konnte nicht geladen werden (${response.status})`);
  return importCatalog(await response.json(), store);
}

function mountChrome(model) {
  const count = document.querySelector('#count');
  const tabs = [...document.querySelectorAll('.mode [role="tab"]')];
  const views = { plan: document.querySelector('#plan-view'), shop: document.querySelector('#shop-view') };
  const toast = document.querySelector('#toast');

  function setMode(mode) {
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    for (const [key, view] of Object.entries(views)) view.hidden = key !== mode;
    document.body.classList.toggle('shopping', mode === 'shop');
    window.scrollTo({ top: 0 });
  }

  for (const tab of tabs) tab.addEventListener('click', () => setMode(tab.dataset.mode));

  toast.addEventListener('click', (event) => {
    if (event.target.closest('[data-undo]')) model.undo();
    else if (event.target.closest('[data-dismiss-error]')) model.clearError();
  });

  model.subscribe(render);
  render();
  return { setMode };

  function render() {
    const n = model.plannedItems.length;
    const k = model.sections.length;
    count.textContent = n === 0 ? 'Noch leer'
      : `${n === 1 ? '1 Produkt' : `${n} Produkte`} · ${k === 1 ? '1 Kategorie' : `${k} Kategorien`}`;
    const open = model.openCount;
    tabs.find((t) => t.dataset.mode === 'shop').textContent = open ? `Einkaufen · ${open}` : 'Einkaufen';

    // Fehler haben Vorrang vor dem normalen Hinweis und bleiben stehen, bis man sie schließt.
    const { error } = model.state;
    const t = model.state.toast;
    const key = error ? `error:${error}` : t?.id;
    toast.hidden = !key;
    toast.classList.toggle('error', Boolean(error));
    if (key && toast.dataset.key !== key) {
      toast.dataset.key = key;
      toast.innerHTML = error
        ? `<span>Das hat nicht geklappt: ${esc(error)}</span><button type="button" data-dismiss-error>OK</button>`
        : `<span>${esc(t.text)}</span>${t.canUndo ? '<button type="button" data-undo>Rückgängig</button>' : ''}`;
    }
    if (!key) delete toast.dataset.key;
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  // Übernimmt eine neue Fassung die Kontrolle, gleich neu laden – sonst zeigt die
  // Home-Bildschirm-App die alte Fassung, bis man sie ganz beendet. Die Liste liegt in IndexedDB.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    // iOS holt die App aus dem Hintergrund, ohne sie neu zu starten – dann nach Updates sehen.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  } catch (error) {
    console.warn('Offline-Modus nicht verfügbar:', error);
  }
}

async function start() {
  const store = await openStore();
  try {
    await loadCatalog(store);
  } catch (error) {
    // Offline ohne Cache beim allerersten Start – mit vorhandenen Daten weitermachen.
    console.warn(error);
  }
  // Daten möglichst vor automatischem Löschen durch den Browser schützen.
  navigator.storage?.persist?.().catch(() => {});

  const model = new ListModel(new ShoppingRepository(store));
  // Bildquellen vor allen Ansichten aktualisieren, damit jede Ansicht schon die neuen Fotos sieht.
  setPhotoSources(await loadBundledImages());
  model.subscribe((state) => setPhotoSources({ own: state.photos }));
  await model.load();
  const chrome = mountChrome(model);
  mountPlanningView(document.querySelector('#plan-view'), model);
  mountShoppingView(document.querySelector('#shop-view'), model, { onGoToPlanning: () => chrome.setMode('plan') });
  mountEditSheet(document.querySelector('#sheet-root'), model);
  mountSettingsView(document.querySelector('#settings'), model, { opener: document.querySelector('#open-settings') });
  mountBackupSection(document.querySelector('#backup'), model);
  mountProductUnits(document.querySelector('#product-units'), model);
  mountShareButton(document.querySelector('#plan-view'), model);
  mountPasteSection(document.querySelector('#paste-share'), model);
  mountIncomingDialog(document.querySelector('#incoming-root'), model);
  await receiveFromLocation(model);
  registerServiceWorker();
}

start().catch((error) => {
  console.error(error);
  document.querySelector('#list').innerHTML = `<div class="empty"><h2>FeedYourself konnte nicht starten</h2><p>${esc(error.message)}</p></div>`;
});
