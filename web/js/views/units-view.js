// Einstellungen › Einheiten je Produkt: Standard-Einheit festlegen (z. B. Äpfel in Kilogramm).

import { searchProducts } from '../search.js';
import { DEFAULT_UNIT, UNIT_KEYS, UNITS, unitOf } from '../units.js';
import { esc, thumb } from './dom.js';

export function mountProductUnits(root, model) {
  const search = root.querySelector('#unit-search');
  const list = root.querySelector('#unit-list');

  search.addEventListener('input', render);

  list.addEventListener('change', (event) => {
    const select = event.target.closest('[data-unit-for]');
    const product = select && model.state.products.find((p) => p.id === select.dataset.unitFor);
    if (product && select.value !== unitOf(product)) model.setProductUnit(product, select.value);
  });

  function row(product) {
    const category = model.categoryFor(product);
    const id = `unit-${product.id}`;
    return `<div class="unit-row" role="listitem">
      ${thumb(product, category?.key, 'tiny')}
      <label class="unit-name" for="${id}">${esc(product.name)}<span>${esc(category?.name ?? 'Sonstiges')}</span></label>
      <select id="${id}" class="unit-select" data-unit-for="${product.id}">
        ${UNIT_KEYS.map((key) => `<option value="${key}"${key === unitOf(product) ? ' selected' : ''}>${UNITS[key].label}</option>`).join('')}
      </select>
    </div>`;
  }

  function render() {
    // Nicht neu zeichnen, während eine Auswahl offen ist.
    if (list.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    const query = search.value.trim();
    if (query) {
      const found = searchProducts(query, model.state.products, 12);
      list.innerHTML = found.length
        ? found.map(row).join('')
        : `<p class="unit-hint">Kein Produkt gefunden für „${esc(query)}“.</p>`;
      return;
    }
    const custom = model.state.products.filter((p) => unitOf(p) !== DEFAULT_UNIT);
    list.innerHTML = custom.length
      ? `<p class="unit-hint">Angepasst:</p>${custom.map(row).join('')}`
      : '<p class="unit-hint">Alle Produkte in Stück. Suche oben ein Produkt, um seine Einheit zu ändern.</p>';
  }

  model.subscribe(render);
  render();
}
