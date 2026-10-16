// Ansichtsknopf oben rechts im Kopf: zeigt die aktuelle Ansicht als Symbol, Tippen schaltet weiter
// (Planen: Liste → Kacheln, Einkaufen: Liste → Kacheln → Fokus). Er gehört immer zum sichtbaren Modus;
// jeder Modus merkt sich seine Ansicht getrennt.

export const MODE_EVENT = 'fy:modechange';

const ICONS = {
  grid: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  list: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="5" width="4" height="4" rx="1"/><rect x="4" y="15" width="4" height="4" rx="1"/><path d="M11 7h9M11 17h9"/></svg>',
  focus: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="6" y="3.5" width="12" height="17" rx="2.5"/><path d="M3 7v10M21 7v10"/></svg>',
};
const LABELS = { grid: 'Kacheln', list: 'Liste', focus: 'Fokus' };

export function mountViewChoice(root, { views, storageKey, fallback, onChange }) {
  const button = document.querySelector('#view-switch');
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
    if (!active() || !button) return;
    const next = views[(views.indexOf(current) + 1) % views.length];
    button.innerHTML = ICONS[current];
    button.dataset.view = current;
    button.setAttribute('aria-label', `Ansicht: ${LABELS[current]} – tippen für ${LABELS[next]}`);
  }

  button?.addEventListener('click', () => {
    if (!active()) return;
    current = views[(views.indexOf(current) + 1) % views.length];
    try { localStorage.setItem(storageKey, current); } catch { /* Ansicht wird dann nicht gemerkt */ }
    sync();
    onChange();
  });
  document.addEventListener(MODE_EVENT, sync);
  sync();

  return { get current() { return current; }, sync };
}
