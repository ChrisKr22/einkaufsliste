// Planungsmodus: Suche mit Vorschlägen, Liste nach Kategorien, Menge, Wischen zum Entfernen.

import { esc, icon, stepper, thumb, buzz } from './dom.js';
import { spokenQuantity, unitOf } from '../units.js';

const SWIPE_DELETE_PX = 90;
const RECENT_ORDER_KEY = 'feedyourself.recentOrder';
const check = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function readRecentOrder() {
  try { return localStorage.getItem(RECENT_ORDER_KEY) === 'frequent' ? 'frequent' : 'recent'; } catch { return 'recent'; }
}

export function mountPlanningView(root, model) {
  const input = root.querySelector('#search');
  const clearButton = root.querySelector('#search-clear');
  const suggestionsEl = root.querySelector('#suggestions');
  const listEl = root.querySelector('#list');
  const recentEl = root.querySelector('#recent');
  let lastAddedCount = model.state.addedCount;
  let recentOrder = readRecentOrder();

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
      return `<button type="button" class="suggestion" data-add="${product.id}" aria-label="${esc(product.name)} hinzufügen, ${esc(subtitle)}">`
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
      return `<button type="button" class="recent-tile" data-recent="${product.id}" aria-label="${esc(label)}"${isOnList ? ' disabled' : ''}>
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
      <p class="section-note">Ein Tipp – mit Menge und Anmerkung vom letzten Mal.</p>
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
    listEl.innerHTML = sections.map(({ category, items }) => `
      <section class="section" aria-label="${esc(category.name)}">
        <h2 class="section-title">${esc(category.name)} <span>· ${items.length}</span></h2>
        <div class="card">${items.map((item) => row(item, category.key)).join('')}</div>
      </section>`).join('');
  }

  function row(item, categoryKey) {
    let note;
    if (item.status === 'later') note = `<span class="row-note later">Zurückgestellt${item.note ? ` · ${esc(item.note)}` : ''}</span>`;
    else if (item.note) note = `<span class="row-note">${esc(item.note)}</span>`;
    else note = '<span class="row-note placeholder">Anmerkung hinzufügen</span>';
    const label = [`${item.product.name}, ${spokenQuantity(item.quantity, unitOf(item))}`, item.note].filter(Boolean).join(', ');
    return `<div class="row" data-row="${item.id}">
      <div class="row-delete" aria-hidden="true">Entfernen</div>
      <div class="row-inner">
        <button type="button" class="row-main" data-edit="${item.id}" aria-label="${esc(label)} – bearbeiten">
          ${thumb(item.product, categoryKey)}
          <span class="row-text"><span class="row-name">${esc(item.product.name)}</span>${note}</span>
        </button>
        ${stepper(item)}
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
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }   // scrollt
      if (Math.abs(dx) < 10) return;
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
