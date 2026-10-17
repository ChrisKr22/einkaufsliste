// Einstellungen: Kategorien umbenennen, per Ziehen (oder Pfeiltasten) sortieren, hinzufügen, löschen.

import { esc, thumb } from './dom.js';

const icons = {
  handle: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 8h14M5 12h14M5 16h14"/></svg>',
  trash: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
};

export function mountSettingsView(root, model, { openers }) {
  let opener = openers[0];   // zum Zurückspringen nach dem Schließen
  const list = root.querySelector('#category-list');
  const closeButton = root.querySelector('[data-close-settings]');
  let dragging = false;
  let pending = false;
  let focusAfterRender = null;   // z. B. { selector, select: true }

  const categoryById = (id) => model.state.categories.find((c) => c.id === id);

  function open() {
    root.hidden = false;
    document.body.classList.add('settings-open');
    render();
    closeButton.focus({ preventScroll: true });
  }

  function close() {
    document.activeElement?.blur?.();   // offene Umbenennung übernehmen
    root.hidden = true;
    document.body.classList.remove('settings-open');
    opener.focus({ preventScroll: true });
  }

  for (const button of openers) {
    button.addEventListener('click', () => { opener = button; open(); });
  }
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  root.addEventListener('click', async (event) => {
    const t = event.target;
    if (t.closest('[data-close-settings]')) close();
    else if (t.closest('[data-add-category]')) {
      const category = await model.addCategory();
      if (category) {
        focusAfterRender = { selector: `[data-name="${category.id}"]`, select: true };
        render();
      }
    } else if (t.closest('[data-delete]')) {
      const category = categoryById(t.closest('[data-delete]').dataset.delete);
      if (category) model.deleteCategory(category);
    }
  });

  // --- Umbenennen: übernehmen beim Verlassen des Feldes oder mit Enter
  list.addEventListener('change', (event) => {
    const input = event.target.closest('[data-name]');
    const category = input && categoryById(input.dataset.name);
    if (category) model.renameCategory(category, input.value);
  });
  list.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-name]');
    if (input && event.key === 'Enter') { event.preventDefault(); input.blur(); return; }
    const handle = event.target.closest('[data-handle]');
    if (handle && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      focusAfterRender = { selector: `[data-handle="${handle.dataset.handle}"]` };
      model.moveCategory(handle.dataset.handle, event.key === 'ArrowUp' ? -1 : 1);
    }
  });
  list.addEventListener('focusout', () => {
    setTimeout(() => { if (pending && !isEditing()) render(); }, 0);
  });

  attachDragToReorder();

  function isEditing() {
    return document.activeElement?.matches?.('#category-list [data-name]');
  }

  function render() {
    if (root.hidden) return;
    // Nicht mitten im Tippen oder Ziehen neu zeichnen.
    if (dragging || isEditing()) { pending = true; return; }
    pending = false;
    const rows = model.categoryRows;
    list.innerHTML = rows.map(({ category, productCount, canDelete }, index) => {
      const name = esc(category.name);
      return `<div class="cat-row" role="listitem" data-id="${esc(category.id)}">
        <button type="button" class="drag-handle" data-handle="${esc(category.id)}" aria-label="${name} verschieben, Position ${index + 1} von ${rows.length}. Mit Pfeiltasten verschieben.">${icons.handle}</button>
        ${thumb({}, category.key, 'tiny')}
        <span class="cat-text">
          <label class="sr-only" for="cat-${esc(category.id)}">Name der Kategorie ${index + 1}</label>
          <input id="cat-${esc(category.id)}" data-name="${esc(category.id)}" type="text" value="${name}" enterkeyhint="done" autocomplete="off" autocapitalize="sentences" spellcheck="false">
          <span class="cat-count">${productCount === 1 ? '1 Produkt' : `${productCount} Produkte`}</span>
        </span>
        ${canDelete
          ? `<button type="button" class="icon-button cat-delete" data-delete="${esc(category.id)}" aria-label="${name} löschen">${icons.trash}</button>`
          : '<span class="cat-delete-spacer" aria-hidden="true"></span>'}
      </div>`;
    }).join('');
    if (focusAfterRender) {
      const el = list.querySelector(focusAfterRender.selector);
      el?.focus({ preventScroll: false });
      if (focusAfterRender.select) el?.select?.();
      focusAfterRender = null;
    }
  }

  /** Ziehen am Griff: Zeile folgt dem Finger, Nachbarn rücken nach; beim Loslassen wird gespeichert. */
  function attachDragToReorder() {
    let drag = null;

    list.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('[data-handle]');
      if (!handle || event.button > 0) return;
      event.preventDefault();
      const row = handle.closest('.cat-row');
      drag = { row, pointerId: event.pointerId, startY: event.clientY, before: [...list.children].map((r) => r.dataset.id) };
      dragging = true;
      row.classList.add('lifted');
      handle.setPointerCapture?.(event.pointerId);
    });

    list.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const { row } = drag;
      let dy = event.clientY - drag.startY;
      const next = row.nextElementSibling;
      const prev = row.previousElementSibling;
      if (next && dy > next.offsetHeight / 2) {
        list.insertBefore(next, row);
        drag.startY += next.offsetHeight;
        dy -= next.offsetHeight;
      } else if (prev && dy < -prev.offsetHeight / 2) {
        list.insertBefore(row, prev);
        drag.startY -= prev.offsetHeight;
        dy += prev.offsetHeight;
      }
      row.style.transform = `translateY(${dy}px)`;
    });

    const drop = () => {
      if (!drag) return;
      const { row, before } = drag;
      drag = null;
      dragging = false;
      row.classList.remove('lifted');
      row.style.transform = '';
      const after = [...list.children].map((r) => r.dataset.id);
      if (after.join() !== before.join()) model.reorderCategories(after);
      else if (pending) render();
    };
    list.addEventListener('pointerup', drop);
    list.addEventListener('pointercancel', drop);
  }

  model.subscribe(render);
}
