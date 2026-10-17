// Planungsmodus: Suche mit Vorschlägen, „Zuletzt gekauft“, Liste oder Kacheln nach Kategorien, Menge, Wischen zum Entfernen.

import { categoryStyle } from '../category-style.js';
import { esc, icon, keepHorizontalSwipes, photoClass, photoContent, stepper, thumb, buzz } from './dom.js';
import { mountViewChoice } from './view-choice.js';
import { formatQuantity, spokenQuantity, unitOf } from '../units.js';

const SWIPE_DELETE_PX = 90;
const RECENT_ORDER_KEY = 'feedyourself.recentOrder';
const VIEW_KEY = 'feedyourself.planView';
const check = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
// Kleiner Stift statt „Anmerkung hinzufügen“: dezent, Tippen öffnet das Detailfenster.
const pen = '<svg class="note-pen" aria-hidden="true" viewBox="0 0 24 24"><path d="M14.5 5.5l4 4M5 19l1-4L15.5 5.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L9 18z"/></svg>';

function readRecentOrder() {
  try { return localStorage.getItem(RECENT_ORDER_KEY) === 'frequent' ? 'frequent' : 'recent'; } catch { return 'recent'; }
}

export function mountPlanningView(root, model) {
  // Suche sitzt fest im Kopf (außerhalb der Planungsansicht).
  const input = document.querySelector('#search');
  const clearButton = document.querySelector('#search-clear');
  const suggestionsEl = root.querySelector('#suggestions');
  const listEl = root.querySelector('#list');
  const recentEl = root.querySelector('#recent');
  let lastAddedCount = model.state.addedCount;
  let recentOrder = readRecentOrder();
  const choice = mountViewChoice(root, { views: ['list', 'grid'], storageKey: VIEW_KEY, fallback: 'list', onChange: () => renderList() });

  // --- Zuletzt gekauft
  recentEl.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-recent]');
    const order = event.target.closest('[data-recent-order]');
    if (tile && !tile.disabled) model.add(tile.dataset.recent);
    else if (order) {
      recentOrder = order.dataset.recentOrder;
      try { localStorage.setItem(RECENT_ORDER_KEY, recentOrder); } catch { /* wird dann nicht gemerkt */ }
      renderRecent();
    }
  });

  const keepTyping = () => input.focus({ preventScroll: true });

  // --- Suche
  input.addEventListener('input', () => model.setQuery(input.value));
  input.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    await model.submitSearch();
    keepTyping();
  });
  clearButton.addEventListener('click', () => {
    model.setQuery('');
    keepTyping();
  });

  // --- Vorschläge
  suggestionsEl.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-add]');
    const create = event.target.closest('[data-create]');
    if (add) await model.add(add.dataset.add);
    else if (create) await model.createProductFromQuery();
    else return;
    keepTyping();
  });

  // --- Liste
  listEl.addEventListener('click', (event) => {
    const find = (id) => model.state.items.find((i) => i.id === id);
    const inc = event.target.closest('[data-inc]');
    const dec = event.target.closest('[data-dec]');
    const edit = event.target.closest('[data-edit]');
    if (inc) model.increment(find(inc.dataset.inc));
    else if (dec) model.decrement(find(dec.dataset.dec));
    else if (edit) model.openEditor(edit.dataset.edit);
  });
  keepHorizontalSwipes(listEl, '.row-inner');
  attachSwipeToDelete(listEl, (id) => {
    const item = model.state.items.find((i) => i.id === id);
    if (item) model.remove(item);
  });

  // --- Darstellen
  function render() {
    const { query } = model.state;
    if (input.value !== query) input.value = query;
    clearButton.hidden = query.length === 0;
    renderSuggestions();
    renderList();
    renderRecent();
    if (model.state.addedCount !== lastAddedCount) {
      lastAddedCount = model.state.addedCount;
      buzz();
    }
  }

  function renderSuggestions() {
    const query = model.trimmedQuery;
    if (!query) {
      suggestionsEl.hidden = true;
      suggestionsEl.innerHTML = '';
      return;
    }
    const rows = model.suggestions.map(({ product, subtitle }) => {
      const key = model.categoryFor(product)?.key;
      return `<button type="button" class="suggestion" data-add="${esc(product.id)}" aria-label="${esc(product.name)} hinzufügen, ${esc(subtitle)}">`
        + `${thumb(product, key, 'small')}`
        + `<span class="suggestion-text"><span class="suggestion-name">${esc(product.name)}</span>`
        + `<span class="suggestion-sub">${esc(subtitle)}</span></span>`
        + `<span class="plus">${icon.plus}</span></button>`;
    });
    if (model.canCreateFromQuery) {
      rows.push(`<button type="button" class="suggestion create" data-create>`
        + `<span class="thumb small" aria-hidden="true">${icon.plus}</span>`
        + `<span class="suggestion-text">„${esc(query)}“ als neues Produkt anlegen</span></button>`);
    }
    suggestionsEl.innerHTML = rows.join('');
    suggestionsEl.hidden = rows.length === 0;
  }

  function renderRecent() {
    const recent = model.trimmedQuery ? [] : model.purchasedProducts(recentOrder);
    recentEl.hidden = recent.length === 0;
    if (!recent.length) {
      recentEl.innerHTML = '';
      return;
    }
    const orderButton = (value, label) => `<button type="button" role="radio" data-recent-order="${value}" aria-checked="${recentOrder === value}">${label}</button>`;
    const tiles = recent.map(({ product, isOnList, subtitle }) => {
      const key = model.categoryFor(product)?.key;
      const label = isOnList ? `${product.name} ist schon auf der Liste` : `${product.name} wieder hinzufügen, ${subtitle}`;
      return `<button type="button" class="recent-tile" data-recent="${esc(product.id)}" aria-label="${esc(label)}"${isOnList ? ' disabled' : ''}>
        ${thumb(product, key, 'recent')}
        <span class="recent-name">${esc(product.name)}</span>
        <span class="recent-sub">${esc(subtitle)}</span>
        <span class="recent-badge${isOnList ? ' on-list' : ''}" aria-hidden="true">${isOnList ? check : icon.plus}</span>
      </button>`;
    }).join('');
    recentEl.innerHTML = `
      <div class="recent-head">
        <h2 class="section-title" id="recent-title">Zuletzt gekauft</h2>
        <div class="recent-order" role="radiogroup" aria-label="Sortierung">${orderButton('recent', 'Zuletzt')}${orderButton('frequent', 'Häufig')}</div>
      </div>
      <div class="recent-tiles">${tiles}</div>`;
  }

  function renderList() {
    const sections = model.sections;
    if (sections.length === 0) {
      const hasRecent = model.purchasedProducts().length > 0;
      listEl.innerHTML = model.trimmedQuery ? '' : `<div class="empty">${icon.basket}<h2>Noch nichts geplant</h2>`
        + `<p>Tippe oben ein, was du brauchst – mit Enter landet es auf der Liste.${hasRecent ? ' Oder wähle unten aus „Zuletzt gekauft“.' : ''}</p></div>`;
      return;
    }
    const grid = choice.current === 'grid';
    listEl.innerHTML = sections.map(({ category, items }) => `
      <section class="section" aria-label="${esc(category.name)}">
        <h2 class="section-title">${esc(category.name)} <span>· ${items.length}</span></h2>
        ${grid
          ? `<div class="tiles">${items.map((item) => tile(item, category.key)).join('')}</div>`
          : `<div class="rows">${items.map((item) => row(item, category.key)).join('')}</div>`}
      </section>`).join('');
  }

  function noteFor(item) {
    if (item.status === 'later') return `<span class="list-tile-note later">Zurückgestellt${item.note ? ` · ${esc(item.note)}` : ''}</span>`;
    if (item.note) return `<span class="list-tile-note">${esc(item.note)}</span>`;
    return `<span class="list-tile-note is-placeholder" title="Anmerkung hinzufügen">${pen}</span>`;
  }

  function labelFor(item) {
    return [`${item.product.name}, ${spokenQuantity(item.quantity, unitOf(item))}`, item.note].filter(Boolean).join(', ');
  }

  /** Kachel (zweispaltig): genau wie im Einkauf (Foto, Name + Menge, Anmerkung) – gleiche Höhe.
   *  Plus und Minus sind runde Glasknöpfe oben rechts im Foto. */
  function tile(item, categoryKey) {
    const style = categoryStyle(categoryKey);
    let note;
    if (item.status === 'later') note = `<span class="item-note later">Zurückgestellt${item.note ? ` · ${esc(item.note)}` : ''}</span>`;
    else if (item.note) note = `<span class="item-note">${esc(item.note)}</span>`;
    else note = `<span class="item-note is-placeholder" title="Anmerkung hinzufügen">${pen}</span>`;
    return `<div class="tile plan-tile">
      <button type="button" class="tile-main" data-edit="${esc(item.id)}" aria-label="${esc(labelFor(item))} – bearbeiten">
        <span class="tile-photo${photoClass(item.product)}" style="--tint:${style.tint};--ink:${style.ink}" aria-hidden="true">${photoContent(item.product, categoryKey)}</span>
        <span class="tile-body"><span class="tile-head"><span class="item-name">${esc(item.product.name)}</span>`
          + `<span class="qty-lens" aria-hidden="true">${formatQuantity(item.quantity, unitOf(item))}</span></span>${note}</span>
      </button>
      <div class="tile-ctl">
        <button type="button" class="glass-button" data-inc="${esc(item.id)}" aria-label="${esc(item.product.name)} mehr">${icon.plus}</button>
        <button type="button" class="glass-button" data-dec="${esc(item.id)}" aria-label="${esc(item.product.name)} weniger">${icon.minus}</button>
      </div>
    </div>`;
  }

  function row(item, categoryKey) {
    const note = noteFor(item);
    const label = labelFor(item);
    return `<div class="row" data-row="${esc(item.id)}">
      <div class="row-delete" aria-hidden="true">Entfernen</div>
      <div class="row-inner list-tile">
        <button type="button" class="list-tile-photo" data-edit="${esc(item.id)}" tabindex="-1" aria-hidden="true">${thumb(item.product, categoryKey, 'wide')}</button>
        <div class="list-tile-side">
          <button type="button" class="row-main" data-edit="${esc(item.id)}" aria-label="${esc(label)} – bearbeiten"><span class="list-tile-name">${esc(item.product.name)}</span></button>
          ${stepper(item)}
          <button type="button" class="row-note-button" data-edit="${esc(item.id)}" tabindex="-1" aria-hidden="true">${note}</button>
        </div>
      </div>
    </div>`;
  }

  model.subscribe(render);
  render();
}

/** Nach links wischen entfernt einen Eintrag (wie in iOS-Listen). Senkrechtes Scrollen bleibt frei. */
function attachSwipeToDelete(listEl, onDelete) {
  let drag = null;

  listEl.addEventListener('pointerdown', (event) => {
    const inner = event.target.closest('.row-inner');
    if (!inner || event.target.closest('.stepper') || event.button > 0) return;
    drag = { inner, id: inner.parentElement.dataset.row, x: event.clientX, y: event.clientY, dx: 0, active: false };
  });

  listEl.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      // Gleiche Regel wie keepHorizontalSwipes: ab 6 px entscheidet die überwiegende Richtung.
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 6) return;
      if (Math.abs(dy) >= Math.abs(dx)) { drag = null; return; }   // scrollt
      drag.active = true;
      drag.inner.classList.add('dragging');
      drag.inner.setPointerCapture?.(event.pointerId);
    }
    drag.dx = Math.min(0, dx);
    drag.inner.style.transform = `translateX(${drag.dx}px)`;
  });

  const end = () => {
    if (!drag) return;
    const { inner, id, dx, active } = drag;
    drag = null;
    if (!active) return;
    inner.classList.remove('dragging');
    // Ein Klick direkt nach dem Wischen soll nicht „Bearbeiten“ öffnen.
    const block = (e) => { e.stopPropagation(); e.preventDefault(); };
    listEl.addEventListener('click', block, { capture: true });
    setTimeout(() => listEl.removeEventListener('click', block, { capture: true }), 350);
    if (dx < -SWIPE_DELETE_PX) {
      inner.style.transform = 'translateX(-100%)';
      setTimeout(() => onDelete(id), 150);
    } else {
      inner.style.transform = '';
    }
  };
  listEl.addEventListener('pointerup', end);
  listEl.addEventListener('pointercancel', () => {
    if (drag?.inner) { drag.inner.classList.remove('dragging'); drag.inner.style.transform = ''; }
    drag = null;
  });
}
