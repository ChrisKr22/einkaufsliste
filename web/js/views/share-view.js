// Liste teilen (Teilen-Menü bzw. Zwischenablage) und geteilte Listen übernehmen
// – per Link (#liste=…) oder durch Einfügen der Nachricht in der installierten App.

import { categoryStyle } from '../category-style.js';
import { formatQuantity, unitOf } from '../units.js';
import { esc } from './dom.js';

/** „Liste teilen“ unter der Planungsliste. */
export function mountShareButton(root, model) {
  const row = root.querySelector('#share-row');
  // Safari öffnet das Teilen-Menü nur direkt nach dem Tippen. Darum wird die Nachricht
  // schon vorbereitet, sobald sich die Liste ändert – beim Tippen ist sie sofort da.
  let prepared = null;
  let preparing = Promise.resolve();
  let lastItems = null;

  function prepare() {
    if (model.state.items === lastItems) return;
    lastItems = model.state.items;
    preparing = model.shareList(appUrl()).then((shared) => { prepared = shared; }).catch(() => { prepared = null; });
  }

  row.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-share]')) return;
    if (!prepared) await preparing;
    const shared = prepared;
    if (!shared) return;
    if (navigator.share) {
      try {
        // Der Link steht im Text – so bleibt die Nachricht lesbar und der Link antippbar.
        await navigator.share({ title: 'Einkaufsliste', text: shared.text });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(shared.text);
      model.notify('Liste kopiert – jetzt in Nachrichten o. Ä. einfügen');
    } catch {
      model.notify('Teilen ist in diesem Browser nicht möglich');
    }
  });

  const render = () => {
    row.hidden = model.plannedItems.length === 0 || model.trimmedQuery.length > 0;
    prepare();
  };
  model.subscribe(render);
  render();
}

/** Dialog „Geteilte Liste übernehmen?“ */
export function mountIncomingDialog(root, model) {
  let shownFor = null;

  root.addEventListener('click', async (event) => {
    if (event.target.closest('[data-incoming-accept]')) await model.acceptShared();
    else if (event.target.closest('[data-incoming-dismiss]')) model.dismissShared();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') model.dismissShared();
  });

  function render() {
    const incoming = model.state.incomingShare;
    if (!incoming) {
      if (shownFor) { root.innerHTML = ''; shownFor = null; }
      return;
    }
    if (shownFor === incoming) return;
    shownFor = incoming;
    const { items } = incoming;
    const onList = new Set(model.plannedItems.map((i) => i.product.name.toLocaleLowerCase('de')));
    const rows = items.map((item) => {
      const style = categoryStyle(item.categoryKey);
      const merged = onList.has(item.name.toLocaleLowerCase('de'));
      return `<li class="incoming-row">
        <span class="thumb tiny" style="--tint:${style.tint};--ink:${style.ink}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${style.path}"/></svg></span>
        <span class="incoming-text"><span class="mini-name">${esc(item.name)} <span>${formatQuantity(item.quantity, unitOf(item))}</span></span>
        ${item.note ? `<span class="item-note">${esc(item.note)}</span>` : ''}</span>
        ${merged ? '<span class="incoming-tag">schon auf der Liste</span>' : ''}
      </li>`;
    }).join('');
    root.innerHTML = `
      <button type="button" class="sheet-backdrop" data-incoming-dismiss aria-label="Schließen"></button>
      <div class="sheet incoming" role="dialog" aria-modal="true" aria-labelledby="incoming-title">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <div>
          <h2 id="incoming-title">Geteilte Liste übernehmen?</h2>
          <p class="section-note">${items.length === 1 ? '1 Produkt' : `${items.length} Produkte`} kommen zu deiner Liste dazu. Was schon draufsteht, wird zusammengeführt.</p>
        </div>
        <ul class="incoming-list card">${rows}</ul>
        <div class="sheet-actions">
          <button type="button" class="button secondary" data-incoming-dismiss>Nicht jetzt</button>
          <button type="button" class="button primary" data-incoming-accept>Zur Liste hinzufügen</button>
        </div>
      </div>`;
    root.querySelector('[data-incoming-accept]').focus({ preventScroll: true });
  }

  model.subscribe(render);
  render();
}

/** Einstellungen › „Geteilte Liste einfügen“ (für die App auf dem Home-Bildschirm). */
export function mountPasteSection(root, model) {
  const input = root.querySelector('#paste-input');
  const error = root.querySelector('#paste-error');
  const showError = (message) => { error.textContent = message; error.hidden = !message; };

  async function apply(text) {
    showError('');
    try {
      await model.receiveShared(text);
      input.value = '';
    } catch (e) {
      showError(e?.message ?? String(e));
    }
  }

  root.addEventListener('click', async (event) => {
    if (event.target.closest('[data-paste-apply]')) await apply(input.value);
    else if (event.target.closest('[data-paste-clipboard]')) {
      try {
        const text = await navigator.clipboard.readText();
        input.value = text;
        await apply(text);
      } catch {
        showError('Kein Zugriff auf die Zwischenablage – bitte lange ins Feld tippen und „Einsetzen“ wählen.');
      }
    }
  });
}

/** Beim Start: Wurde die App über einen geteilten Link geöffnet? */
export async function receiveFromLocation(model) {
  if (!/[#&]liste=/.test(location.hash)) return;
  try {
    await model.receiveShared(location.href);
  } catch (error) {
    model.notify(error?.message ?? String(error));
  } finally {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

export function appUrl() {
  return `${location.origin}${location.pathname}`;
}
