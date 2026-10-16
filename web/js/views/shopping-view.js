// Einkaufsmodus: Kacheln, Liste oder Fokus. Tippen / → wischen = in den Wagen, ← = zurückstellen,
// Senkrecht wird immer gescrollt. Dazu „Zurückgestellt“, „Im Wagen“ und „Einkauf abschließen“.

import { categoryStyle } from '../category-style.js';
import { formatQuantity, spokenQuantity, unitOf } from '../units.js';
import { buzz, esc, photoClass, photoContent, thumb } from './dom.js';
import { mountViewChoice } from './view-choice.js';

const VIEW_KEY = 'feedyourself.shopView';
const VIEWS = ['list', 'grid', 'focus'];   // Reihenfolge beim Durchschalten
const SWIPE_PX = 80;

// Kurz halten, damit der Hinweis auf dem iPhone in eine Zeile passt (→ / ← = wischen).
const HINTS = {
  grid: 'Tippen oder →: in den Wagen · ←: zurück',
  list: 'Tippen oder →: in den Wagen · ←: zurück',
  focus: 'Tippen: weiter · →: Wagen · ←: zurück',
};

const svg = {
  later: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H6M11.5 6l-6 6 6 6"/></svg>',
  cart: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 4h2.5l2.2 11h10.6L20.5 7H7"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>',
  check: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  chevron: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
};

export function mountShoppingView(root, model, { onGoToPlanning }) {
  // Fortschritt sitzt als Linie unter den Modus-Reitern im Kopf und ist in beiden Modi sichtbar.
  const bar = document.querySelector('#progress-bar');
  const progressEl = bar?.parentElement;
  const hint = root.querySelector('#shop-hint');
  const content = root.querySelector('#shop-content');
  const finishBar = root.querySelector('#finish-bar');
  const finishButton = root.querySelector('#finish');
  const choice = mountViewChoice(root, { views: VIEWS, storageKey: VIEW_KEY, fallback: 'grid', onChange: () => render() });
  let cartOpen = false;
  let lastCarted = model.state.cartedCount;

  const find = (id) => model.state.items.find((i) => i.id === id);

  root.addEventListener('click', (event) => {
    const t = event.target;
    const cart = t.closest('[data-cart]');
    const later = t.closest('[data-later]');
    const reopen = t.closest('[data-reopen]');
    const skip = t.closest('[data-skip]');
    if (skip) skipFocus(skip.dataset.skip);
    else if (later) model.toLater(find(later.dataset.later));
    else if (cart) model.toCart(find(cart.dataset.cart));
    else if (reopen) model.reopen(find(reopen.dataset.reopen));
    else if (t.closest('[data-toggle-cart]')) { cartOpen = !cartOpen; render(); }
    else if (t.closest('[data-finish]')) model.finishShopping();
    else if (t.closest('[data-to-plan]')) { model.dismissSummary(); onGoToPlanning(); }
  });

  // Überspringen: Karte kurz nach oben ausblenden, dann ist das nächste Produkt dran.
  function skipFocus(id) {
    const item = find(id);
    if (!item) return;
    if (model.focusQueue.length < 2) { model.notify(`${item.product.name} ist das letzte offene Produkt`); return; }
    const card = content.querySelector('.focus-card');
    if (!card || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) { model.skip(item); return; }
    card.classList.add('skipping');
    setTimeout(() => model.skip(item), 160);
  }

  attachSwipeGestures(content, {
    onCart: (id) => { const item = find(id); if (item) model.toCart(item); },
    onLater: (id) => { const item = find(id); if (item) model.toLater(item); },
  });

  // ---------------------------------------------------------------- Darstellen

  function render() {
    const progress = model.progress;
    if (bar) {
      bar.style.width = `${Math.round(progress.ratio * 100)}%`;
      progressEl.setAttribute('aria-valuemax', String(progress.total));
      progressEl.setAttribute('aria-valuenow', String(progress.done));
      progressEl.setAttribute('aria-valuetext', `${progress.done} von ${progress.total} im Wagen`);
    }
    if (model.state.cartedCount !== lastCarted) {
      lastCarted = model.state.cartedCount;
      buzz();
    }
    const { summary } = model.state;
    const view = choice.current;
    hint.hidden = Boolean(summary);
    finishBar.hidden = Boolean(summary) || model.state.items.length === 0;
    if (summary) {
      content.innerHTML = summaryView(summary);
      return;
    }

    const { done, total } = model.progress;
    hint.textContent = HINTS[view];
    finishButton.disabled = done === 0;

    if (total === 0) {
      content.innerHTML = `<div class="empty">${svg.cart}<h2>Die Liste ist leer</h2>`
        + '<p>Plane zuerst, was du brauchst.</p><button type="button" class="button secondary inline" data-to-plan>Zur Planung</button></div>';
      return;
    }

    const parts = [];
    if (model.openItems.length === 0) {
      parts.push(`<div class="all-done">${svg.check}<span>Alles erledigt – jetzt den Einkauf abschließen.</span></div>`);
    } else if (view === 'focus') {
      parts.push(focusView());
    } else {
      parts.push(...model.shopSections.map(({ category, items }) => `
        <section class="section" aria-label="${esc(category.name)}">
          <h2 class="section-title">${esc(category.name)}</h2>
          ${view === 'grid'
            ? `<div class="tiles">${items.map((i) => tile(i, category.key)).join('')}</div>`
            : `<div class="srows">${items.map((i) => srow(i, category.key)).join('')}</div>`}
        </section>`));
    }
    parts.push(laterSection(), cartSection());
    content.innerHTML = parts.join('');
  }

  function itemLabel(item) {
    return [`${item.product.name}, ${spokenQuantity(item.quantity, unitOf(item))}`, item.note].filter(Boolean).join(', ');
  }

  function swipeHints() {
    return `<span class="swipe-hint cart" aria-hidden="true">${svg.cart}In den Wagen</span>`
      + `<span class="swipe-hint later" aria-hidden="true">${svg.later}Zurückstellen</span>`;
  }

  function photo(item, key, cls) {
    const style = categoryStyle(key);
    return `<span class="${cls}${photoClass(item.product)}" style="--tint:${style.tint};--ink:${style.ink}" aria-hidden="true">`
      + `${photoContent(item.product, key)}</span>`;
  }

  function tile(item, key) {
    return `<div class="tile" data-swipe="${item.id}">
      <button type="button" class="tile-main" data-cart="${item.id}" aria-label="${esc(itemLabel(item))} – in den Wagen">
        ${photo(item, key, 'tile-photo')}
        <span class="tile-body">
          <span class="tile-head"><span class="item-name">${esc(item.product.name)}</span><span class="item-qty">${formatQuantity(item.quantity, unitOf(item))}</span></span>
          <span class="item-note">${esc(item.note)}</span>
        </span>
      </button>
      <button type="button" class="later-button" data-later="${item.id}" aria-label="${esc(item.product.name)} zurückstellen">${svg.later}</button>
      ${swipeHints()}
    </div>`;
  }

  function srow(item, key) {
    return `<div class="srow" data-swipe="${item.id}">
      <button type="button" class="srow-main list-tile" data-cart="${item.id}" aria-label="${esc(itemLabel(item))} – in den Wagen">
        <span class="list-tile-photo">${thumb(item.product, key, 'wide')}</span>
        <span class="list-tile-side">
          <span class="list-tile-name">${esc(item.product.name)}</span>
          <span class="list-tile-qty">${formatQuantity(item.quantity, unitOf(item))}</span>
          ${item.note ? `<span class="list-tile-note">${esc(item.note)}</span>` : ''}
        </span>
      </button>
      <button type="button" class="later-button" data-later="${item.id}" aria-label="${esc(item.product.name)} zurückstellen">${svg.later}</button>
      ${swipeHints()}
    </div>`;
  }

  function focusView() {
    const queue = model.focusQueue;
    const [item, next] = queue;
    const category = model.categoryFor(item.product);
    const position = `Noch ${queue.length} offen${next ? ` · danach: ${next.product.name}` : ''}`;
    return `<div class="focus">
      <div class="focus-stack">
        ${next ? '<div class="focus-peek" aria-hidden="true"></div>' : ''}
        <div class="focus-card" data-swipe="${item.id}">
          <button type="button" class="focus-main" data-skip="${item.id}" aria-label="${esc(itemLabel(item))} – überspringen">
            <span class="focus-photo-wrap">
              ${photo(item, category?.key, 'focus-photo')}
              <span class="chip">${esc(category?.name ?? 'Sonstiges')}</span>
            </span>
            <span class="focus-body">
              <span class="focus-head"><span class="item-name">${esc(item.product.name)}</span><span class="item-qty">${formatQuantity(item.quantity, unitOf(item))}</span></span>
              <span class="item-note">${esc(item.note)}</span>
              <span class="focus-position">${esc(position)}</span>
            </span>
          </button>
          ${swipeHints()}
        </div>
      </div>
      <div class="focus-actions">
        <button type="button" class="button later-soft" data-later="${item.id}">← Zurückstellen</button>
        <button type="button" class="button accent-soft" data-cart="${item.id}">In den Wagen →</button>
      </div>
    </div>`;
  }

  function miniRow(item, action, label) {
    const key = model.categoryFor(item.product)?.key;
    return `<div class="mini-row">
      ${thumb(item.product, key, 'tiny')}
      <span class="mini-name">${esc(item.product.name)} <span>${formatQuantity(item.quantity, unitOf(item))}</span></span>
      <button type="button" class="text-button" data-reopen="${item.id}" aria-label="${esc(item.product.name)}: ${label}">${label}</button>
    </div>`;
  }

  function laterSection() {
    const items = model.laterItems;
    if (!items.length) return '';
    return `<section class="section later-section" aria-label="Zurückgestellt">
      <h2 class="section-title later">Zurückgestellt · ${items.length}</h2>
      <p class="section-note">Nicht gefunden – bleibt für den nächsten Einkauf auf der Liste.</p>
      <div class="card later-card">${items.map((i) => miniRow(i, 'reopen', 'Doch gefunden')).join('')}</div>
    </section>`;
  }

  function cartSection() {
    const items = model.cartItems;
    if (!items.length) return '';
    return `<section class="section cart-section">
      <button type="button" class="cart-toggle" data-toggle-cart aria-expanded="${cartOpen}">
        ${svg.cart}<span>Im Wagen · ${items.length}</span><span class="chevron${cartOpen ? ' open' : ''}">${svg.chevron}</span>
      </button>
      ${cartOpen ? `<div class="card in-cart">${items.map((i) => miniRow(i, 'reopen', 'Zurück')).join('')}</div>` : ''}
    </section>`;
  }

  function summaryView({ bought, kept }) {
    const boughtText = bought === 1 ? '1 Produkt gekauft' : `${bought} Produkte gekauft`;
    const keptText = kept === 0
      ? 'Die Liste ist leer – Zeit, neu zu planen.'
      : `${kept === 1 ? '1 Produkt bleibt' : `${kept} Produkte bleiben`} für den nächsten Einkauf auf der Liste.`;
    return `<div class="summary" role="status">
      <span class="summary-icon">${svg.check}</span>
      <h2>Einkauf erledigt</h2>
      <p>${boughtText} – beim nächsten Mal mit Menge und Anmerkung vorausgefüllt.</p>
      <p>${keptText}</p>
      <button type="button" class="button primary inline" data-to-plan>Zur Planung</button>
    </div>`;
  }

  model.subscribe(render);
  render();
}

/**
 * Wischgesten auf allen Elementen mit [data-swipe]: nur waagerecht (→ Wagen, ← zurückstellen).
 * Senkrechte Bewegungen gehören immer dem Scrollen.
 */
function attachSwipeGestures(container, { onCart, onLater }) {
  let g = null;

  const reset = (el) => {
    el.classList.remove('dragging');
    el.style.transform = '';
    el.style.removeProperty('--p');
    delete el.dataset.dir;
  };

  container.addEventListener('pointerdown', (event) => {
    const el = event.target.closest('[data-swipe]');
    if (!el || event.target.closest('[data-later]') || event.button > 0) return;
    g = { el, id: el.dataset.swipe, x: event.clientX, y: event.clientY, dx: 0, active: false };
  });

  container.addEventListener('pointermove', (event) => {
    if (!g) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.active) {
      if (Math.hypot(dx, dy) < 10) return;
      if (Math.abs(dx) < Math.abs(dy)) { g = null; return; }   // senkrecht: Seite scrollt
      g.active = true;
      g.el.classList.add('dragging');
      g.el.setPointerCapture?.(event.pointerId);
    }
    g.dx = dx;
    g.el.style.transform = `translateX(${dx}px) rotate(${(dx / 30).toFixed(2)}deg)`;
    g.el.style.setProperty('--p', Math.min(1, Math.abs(dx) / SWIPE_PX).toFixed(2));
    g.el.dataset.dir = dx > 0 ? 'cart' : dx < 0 ? 'later' : '';
  });

  container.addEventListener('pointerup', () => {
    if (!g) return;
    const { el, id, dx, active } = g;
    g = null;
    if (!active) return;
    // Ein Klick direkt nach dem Wischen soll nicht zusätzlich „in den Wagen“ auslösen.
    const block = (e) => { e.stopPropagation(); e.preventDefault(); };
    container.addEventListener('click', block, { capture: true });
    setTimeout(() => container.removeEventListener('click', block, { capture: true }), 350);

    const action = dx > SWIPE_PX ? 'cart' : dx < -SWIPE_PX ? 'later' : null;
    if (!action) { reset(el); return; }
    el.classList.remove('dragging');
    el.classList.add('flying');
    el.style.transform = `translateX(${action === 'cart' ? 120 : -120}%)`;
    setTimeout(() => (action === 'cart' ? onCart(id) : onLater(id)), 160);
  });

  container.addEventListener('pointercancel', () => {
    if (g) reset(g.el);
    g = null;
  });
}
