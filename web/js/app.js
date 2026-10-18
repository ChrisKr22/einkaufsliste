// Start der App: Speicher öffnen, Katalog übernehmen, Ansichten verbinden, Offline-Modus aktivieren.

import { importCatalog } from './data/catalog-import.js';
import { ShoppingRepository } from './data/repository.js';
import { ListModel } from './list-model.js';
import { openIdbStore } from './storage/idb-store.js';
import { MemoryStore } from './storage/memory-store.js';
import { mountThemeSection } from './theme.js';
import { mountBackupSection } from './views/backup-view.js';
import { mountEditSheet } from './views/edit-sheet.js';
import { esc, setPhotoSources } from './views/dom.js';
import { mountPlanningView } from './views/planning-view.js';
import { mountSettingsView } from './views/settings-view.js';
import { appUrl, mountIncomingDialog, mountPasteSection, mountShareButton, receiveFromLocation } from './views/share-view.js';
import { mountShoppingView } from './views/shopping-view.js';
import { SharedList } from './sync/shared-list.js';
import { mountListsSection, mountListSwitch, mountSharedDialogs } from './views/shared-view.js';
import { ListsManager } from './lists.js';
import { mountSuggestSection } from './views/suggest-view.js';
import { mountReviewSection } from './views/review-view.js';
import { MODE_EVENT } from './views/view-choice.js';
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

  const modeBar = document.querySelector('.mode');

  function setMode(mode) {
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    if (modeBar) modeBar.dataset.mode = mode;
    for (const [key, view] of Object.entries(views)) view.hidden = key !== mode;
    document.body.classList.toggle('shopping', mode === 'shop');
    const win = document.defaultView ?? globalThis;   // auch in Testumgebungen das passende Event
    document.dispatchEvent(new win.CustomEvent(MODE_EVENT, { detail: mode }));
    window.scrollTo({ top: 0 });
  }

  for (const tab of tabs) tab.addEventListener('click', () => setMode(tab.dataset.mode));

  // Waagerecht über die Leiste wischen schiebt die Linse mit dem Finger; beim Loslassen rastet sie
  // auf der näheren Seite ein. Kurzes Tippen wählt wie gewohnt den Reiter.
  const dock = document.querySelector('.dock-pill');
  const lens = modeBar?.querySelector('.mode-lens');
  let swipe = null;
  dock?.addEventListener('pointerdown', (event) => {
    if (!modeBar || !lens || event.button > 0) return;
    const span = modeBar.clientWidth - lens.offsetWidth;   // Weg der Linse von links nach rechts
    swipe = { x: event.clientX, y: event.clientY, span, start: modeBar.dataset.mode === 'shop' ? span : 0, active: false };
  });
  dock?.addEventListener('pointermove', (event) => {
    if (!swipe) return;
    const dx = event.clientX - swipe.x;
    if (!swipe.active) {
      // Großzügig: Schon schräges Wischen (bis gut 60° gegen die Waagerechte) zählt.
      if (Math.abs(dx) < 6 || Math.abs(dx) * 2 < Math.abs(event.clientY - swipe.y)) return;
      swipe.active = true;
      modeBar.classList.add('dragging');
      dock.setPointerCapture?.(event.pointerId);
    }
    swipe.pos = Math.max(0, Math.min(swipe.span, swipe.start + dx));
    modeBar.style.setProperty('--drag-x', `${swipe.pos}px`);
    const toShop = swipe.pos > swipe.span / 2;
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === (toShop ? 'shop' : 'plan')));
  });
  const endSwipe = () => {
    if (!swipe) return;
    const { active, pos, span } = swipe;
    swipe = null;
    if (!active) return;
    // Der Klick, den das Loslassen auf einem Reiter auslöst, soll die Wahl nicht wieder umkehren.
    const block = (e) => { e.stopPropagation(); e.preventDefault(); };
    dock.addEventListener('click', block, { capture: true });
    setTimeout(() => dock.removeEventListener('click', block, { capture: true }), 350);
    const next = pos > span / 2 ? 'shop' : 'plan';
    // Linse von der Fingerposition aus weich einrasten lassen.
    modeBar.classList.remove('dragging');
    const current = document.body.classList.contains('shopping') ? 'shop' : 'plan';
    if (next !== current) setMode(next);
    else for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === current));
  };
  dock?.addEventListener('pointerup', endSwipe);
  dock?.addEventListener('pointercancel', endSwipe);

  toast.addEventListener('click', (event) => {
    if (event.target.closest('[data-undo]')) model.undo();
    else if (event.target.closest('[data-dismiss-error]')) model.clearError();
  });

  model.subscribe(render);
  render();
  return { setMode };

  function render() {
    const n = model.plannedItems.length;
    count.textContent = String(n);
    count.setAttribute('aria-label', n === 1 ? '1 Artikel auf der Liste' : `${n} Artikel auf der Liste`);
    const open = model.openCount;
    tabs.find((t) => t.dataset.mode === 'shop').textContent = open ? `Einkaufen · ${open}` : 'Einkaufen';

    // Fehler haben Vorrang vor dem normalen Hinweis und bleiben stehen, bis man sie schließt.
    const { error } = model.state;
    const t = model.state.toast;
    const key = error ? `error:${error}` : t?.id;
    toast.hidden = !key;
    toast.classList.toggle('error', Boolean(error));
    toast.classList.toggle('compact', Boolean(!error && t?.compact));
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

// Kein Zoomen per Pinch (iOS ignoriert user-scalable=no in Safari teilweise).
for (const type of ['gesturestart', 'gesturechange']) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
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
  // Listen (private und gemeinsame): öffnet die zuletzt benutzte und lädt deren Einträge.
  const shared = new SharedList(model, store, { appUrl });
  const lists = new ListsManager(model, store, shared);
  try {
    await lists.init();
  } catch (error) {
    console.warn('Listen konnten nicht geöffnet werden:', error);
    await model.load();
  }
  const chrome = mountChrome(model);
  mountPlanningView(document.querySelector('#plan-view'), model);
  mountShoppingView(document.querySelector('#shop-view'), model, { onGoToPlanning: () => chrome.setMode('plan') });
  mountEditSheet(document.querySelector('#sheet-root'), model);
  mountSettingsView(document.querySelector('#settings'), model, { openers: [...document.querySelectorAll('[data-open-settings]')] });
  mountThemeSection(document.querySelector('#theme-section'));
  mountBackupSection(document.querySelector('#backup'), model);
  mountProductUnits(document.querySelector('#product-units'), model);
  mountSuggestSection(document.querySelector('#suggest'), model);
  mountReviewSection(document.querySelector('#review'), model, { versionEl: document.querySelector('.app-version') });
  mountShareButton(document.querySelector('#plan-view'), model);
  mountListsSection(document.querySelector('#lists-section'), lists, shared, model);
  mountListSwitch(document.querySelector('#list-switch'), document.querySelector('#list-menu'), lists, shared, {
    openSettings: (focus) => {
      document.querySelector('#open-settings').click();
      document.querySelector(focus)?.scrollIntoView?.({ block: 'start' });
    },
  });
  mountSharedDialogs(document.querySelector('#shared-root'), shared, model);
  mountPasteSection(document.querySelector('#paste-share'), model, shared);
  mountIncomingDialog(document.querySelector('#incoming-root'), model);
  await receiveFromLocation(model, shared);
  registerServiceWorker();
}

start().catch((error) => {
  console.error(error);
  document.querySelector('#list').innerHTML = `<div class="empty"><h2>FeedYourself konnte nicht starten</h2><p>${esc(error.message)}</p></div>`;
});
