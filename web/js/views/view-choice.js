// Ansichtsumschalter oben rechts im Kopf (Kacheln · Liste · Fokus).
// Er gehört immer zum gerade sichtbaren Modus: Planen kennt Kacheln und Liste, Einkaufen zusätzlich Fokus.
// Jeder Modus merkt sich seine Ansicht getrennt.

export const MODE_EVENT = 'fy:modechange';

export function mountViewChoice(root, { views, storageKey, fallback, onChange }) {
  const switchEl = document.querySelector('#view-switch');
  const buttons = switchEl ? [...switchEl.querySelectorAll('[data-view]')] : [];
  let current = read();

  function read() {
    try {
      const value = localStorage.getItem(storageKey);
      return views.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  const active = () => !root.hidden;

  function sync() {
    if (!active()) return;
    for (const b of buttons) {
      b.hidden = !views.includes(b.dataset.view);
      b.setAttribute('aria-checked', String(b.dataset.view === current));
    }
  }

  switchEl?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button || !active() || !views.includes(button.dataset.view)) return;
    current = button.dataset.view;
    try { localStorage.setItem(storageKey, current); } catch { /* Ansicht wird dann nicht gemerkt */ }
    sync();
    onChange();
  });
  document.addEventListener(MODE_EVENT, sync);
  sync();

  return { get current() { return current; }, sync };
}
