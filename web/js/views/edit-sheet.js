// Bearbeiten-Sheet: Menge, Anmerkung (Sorte, Marke …), eigenes Foto, Entfernen.

import { processPhoto as defaultProcessPhoto } from '../photo.js';
import { esc, stepper, thumb } from './dom.js';

export function mountEditSheet(root, model, { processPhoto = defaultProcessPhoto } = {}) {
  let openId = null;
  let busy = false;

  function close({ save = true } = {}) {
    const item = model.editingItem;
    const textarea = root.querySelector('#note');
    if (save && item && textarea) {
      const note = textarea.value.trim();
      if (note !== item.note) model.setNote(item, note);
    }
    model.closeEditor();
  }

  function setStatus(text, isError = false) {
    const status = root.querySelector('.photo-status');
    if (!status) return;
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle('error', isError);
  }

  async function usePhoto(file) {
    const item = model.editingItem;
    if (!file || !item || busy) return;
    busy = true;
    setStatus('Foto wird vorbereitet …');
    try {
      const { dataUrl, cutOut } = await processPhoto(file);
      await model.setPhoto(item.product, dataUrl);
      setStatus(cutOut ? '' : 'Hintergrund nicht entfernt – am besten vor hellem, ruhigem Hintergrund fotografieren.');
    } catch (error) {
      setStatus(`Das Foto konnte nicht übernommen werden: ${error?.message ?? error}`, true);
    } finally {
      busy = false;
      const input = root.querySelector('[data-photo-input]');
      if (input) input.value = '';
    }
  }

  root.addEventListener('click', (event) => {
    const item = model.editingItem;
    if (!item) return;
    const t = event.target;
    if (t.closest('[data-close]')) close();
    else if (t.closest('[data-remove]')) model.remove(item);
    else if (t.closest('[data-inc]')) model.increment(item);
    else if (t.closest('[data-dec]') && item.quantity > 1) model.decrement(item);
    else if (t.closest('[data-photo-pick]')) root.querySelector('[data-photo-input]')?.click();
    else if (t.closest('[data-photo-reset]')) { setStatus(''); model.removePhoto(item.product); }
  });

  root.addEventListener('change', (event) => {
    const input = event.target.closest('[data-photo-input]');
    if (input) usePhoto(input.files?.[0]);
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  function updatePhoto(item, category) {
    const head = root.querySelector('.sheet-head .thumb');
    if (head) head.outerHTML = thumb(item.product, category?.key, 'large');
    const reset = root.querySelector('[data-photo-reset]');
    if (reset) reset.hidden = !model.hasOwnPhoto(item.product);
  }

  function render() {
    const item = model.editingItem;
    if (!item) {
      if (openId) {
        root.innerHTML = '';
        openId = null;
      }
      return;
    }
    const category = model.categoryFor(item.product);
    if (openId === item.id) {
      // Nur Menge und Foto aktualisieren, damit Eingabe und Fokus im Textfeld erhalten bleiben.
      const qty = root.querySelector('.stepper .qty');
      if (qty) {
        qty.textContent = `${item.quantity}×`;
        qty.setAttribute('aria-label', `${item.quantity} Stück`);
      }
      updatePhoto(item, category);
      return;
    }
    openId = item.id;
    const name = esc(item.product.name);
    root.innerHTML = `
      <button type="button" class="sheet-backdrop" data-close aria-label="Schließen"></button>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <div class="sheet-head">
          ${thumb(item.product, category?.key, 'large')}
          <div class="sheet-title"><h2 id="sheet-title">${name}</h2><p>${esc(category?.name ?? 'Sonstiges')}</p></div>
        </div>
        <div class="sheet-row">
          <span>Foto</span>
          <div class="photo-actions">
            <button type="button" class="text-button" data-photo-reset aria-label="Eigenes Foto von ${name} entfernen"${model.hasOwnPhoto(item.product) ? '' : ' hidden'}>Standardbild</button>
            <button type="button" class="button secondary small" data-photo-pick>Foto ändern</button>
            <input type="file" accept="image/*" data-photo-input hidden>
          </div>
        </div>
        <p class="photo-status" role="status" hidden></p>
        <div class="sheet-row"><span>Menge</span>${stepper(item, { large: true })}</div>
        <div>
          <label for="note">Anmerkung</label>
          <textarea id="note" rows="2" placeholder="z. B. Sorte, Marke, Größe">${esc(item.note)}</textarea>
        </div>
        <div class="sheet-actions">
          <button type="button" class="button secondary" data-remove>Entfernen</button>
          <button type="button" class="button primary" data-close>Fertig</button>
        </div>
      </div>`;
    root.querySelector('.sheet .button.primary').focus({ preventScroll: true });
  }

  model.subscribe(render);
  render();
}
