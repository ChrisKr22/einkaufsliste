// Einstellungen › Für den Katalog vorschlagen: eigene Produkte auswählen und als Nachricht teilen.

import { preselected } from '../data/suggest.js';
import { esc, thumb } from './dom.js';

export function mountSuggestSection(root, model) {
  const list = root.querySelector('#suggest-list');
  const button = root.querySelector('[data-suggest-share]');
  const selected = new Set();
  const known = new Set();     // schon einmal angezeigt – Vorauswahl nur für neue Produkte
  let prepared = null;         // { key, text } – vorab erzeugt, weil iOS das Teilen-Menü nur direkt nach dem Tippen öffnet
  let preparing = null;

  list.addEventListener('change', (event) => {
    const box = event.target.closest('[data-suggest]');
    if (!box) return;
    if (box.checked) selected.add(box.dataset.suggest); else selected.delete(box.dataset.suggest);
    update();
  });

  button.addEventListener('click', async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (prepared?.key !== ids.join()) await preparing;
    const text = prepared?.text;
    if (!text) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Katalog-Vorschlag', text });
        await done(ids);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      await done(ids);
      model.notify('Vorschlag kopiert – jetzt in Nachrichten o. Ä. einfügen');
    } catch {
      model.notify('Teilen ist in diesem Browser nicht möglich');
    }
  });

  async function done(ids) {
    for (const id of ids) selected.delete(id);
    await model.confirmSuggested(ids);
  }

  function prepare() {
    const ids = [...selected];
    const key = ids.join();
    if (prepared?.key === key) return;
    prepared = null;
    preparing = ids.length
      ? model.suggestionText(ids).then((text) => { prepared = { key, text }; }).catch(() => { prepared = null; })
      : null;
  }

  function update() {
    button.disabled = selected.size === 0;
    button.textContent = selected.size > 1 ? `${selected.size} Produkte vorschlagen` : 'Vorschlag teilen';
    prepare();
  }

  function row(product) {
    const category = model.categoryFor(product);
    const id = `suggest-${esc(product.id)}`;
    const bought = product.purchaseCount ? `${product.purchaseCount}× gekauft` : 'noch nicht gekauft';
    const meta = [category?.name ?? 'Sonstiges', bought, product.suggestedAt ? 'schon vorgeschlagen' : null].filter(Boolean).join(' · ');
    return `<label class="suggest-row" role="listitem" for="${esc(id)}">
      <input type="checkbox" id="${esc(id)}" data-suggest="${esc(product.id)}"${selected.has(product.id) ? ' checked' : ''}>
      ${thumb(product, category?.key, 'tiny')}
      <span class="unit-name">${esc(product.name)}<span>${esc(meta)}</span></span>
    </label>`;
  }

  function render() {
    const candidates = model.catalogCandidates;
    const ids = new Set(candidates.map((p) => p.id));
    for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
    for (const p of candidates) {
      if (!known.has(p.id) && preselected(p)) selected.add(p.id);
      known.add(p.id);
    }
    list.innerHTML = candidates.length
      ? candidates.map(row).join('')
      : '<p class="unit-hint">Noch keine eigenen Produkte. Was du über die Suche neu anlegst, erscheint hier.</p>';
    button.hidden = candidates.length === 0;
    update();
  }

  model.subscribe(render);
  render();
}
