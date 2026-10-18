// Einstellungen › Vorschläge prüfen (nur im Pflegemodus): Vorschlags-Nachrichten einfügen, aufnehmen oder ablehnen,
// dann die Freigabe teilen. Pflegemodus an/aus: fünfmal schnell auf die App-Version unten in den Einstellungen tippen.
// Der Pflegemodus blendet nur Werkzeuge ein; ins Repository kommt erst, was am Mac übernommen wird.

import { addSuggestions, clearDecided, emptyReview, normalizeReview, readSuggestions, releaseMessage, reviewHints } from '../data/review.js';
import { UNITS } from '../units.js';
import { esc } from './dom.js';

const ADMIN_KEY = 'feedyourself.admin';
const REVIEW_KEY = 'feedyourself.review';
const TAPS_TO_TOGGLE = 5;
const TAP_WINDOW_MS = 2500;

function readFlag() {
  try { return localStorage.getItem(ADMIN_KEY) === '1'; } catch { return false; }
}
function writeFlag(on) {
  try { if (on) localStorage.setItem(ADMIN_KEY, '1'); else localStorage.removeItem(ADMIN_KEY); } catch { /* gilt dann nur bis zum Schließen */ }
}
function readReview() {
  try { return normalizeReview(JSON.parse(localStorage.getItem(REVIEW_KEY) ?? 'null')); } catch { return emptyReview(); }
}
function writeReview(review) {
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify(review)); } catch { /* bleibt nur bis zum Schließen */ }
}

export function mountReviewSection(root, model, { versionEl }) {
  const input = root.querySelector('#review-input');
  const list = root.querySelector('#review-list');
  const error = root.querySelector('#review-error');
  const shareButton = root.querySelector('[data-review-share]');
  let admin = readFlag();
  let review = readReview();
  let prepared = null;   // { text } – vorab erzeugt, weil iOS das Teilen-Menü nur direkt nach dem Tippen öffnet

  // --- Pflegemodus umschalten: fünf schnelle Tipps auf die Versionsnummer
  let taps = [];
  versionEl?.addEventListener('click', () => {
    const now = Date.now();
    taps = [...taps.filter((t) => now - t < TAP_WINDOW_MS), now];
    if (taps.length < TAPS_TO_TOGGLE) return;
    taps = [];
    setAdmin(!admin);
  });

  function setAdmin(on) {
    admin = on;
    writeFlag(on);
    model.notify(on ? 'Pflegemodus an – „Vorschläge prüfen“ steht unten in den Einstellungen' : 'Pflegemodus aus');
    render();
  }

  function save(next) {
    review = next;
    writeReview(review);
    prepare();
  }

  const catalogCategories = () => model.state.categories.filter((c) => c.key && !c.key.startsWith('eigene-'));

  function showError(text) {
    error.textContent = text ?? '';
    error.hidden = !text;
  }

  async function readInput(text) {
    showError(null);
    try {
      const rows = await readSuggestions(text);
      const { review: next, added, merged } = addSuggestions(review, rows, new Set(catalogCategories().map((c) => c.key)));
      save(next);
      input.value = '';
      render();
      model.notify(added ? `${added} Vorschläge eingelesen${merged ? `, ${merged} zusammengeführt` : ''}` : 'Alle Vorschläge waren schon in der Liste');
    } catch (err) {
      showError(err?.message ?? 'Nachricht konnte nicht gelesen werden');
    }
  }

  root.addEventListener('click', async (event) => {
    const t = event.target;
    if (t.closest('[data-review-read]')) await readInput(input.value);
    else if (t.closest('[data-review-clipboard]')) {
      try { await readInput(await navigator.clipboard.readText()); } catch { showError('Zwischenablage nicht lesbar – bitte ins Feld einfügen'); }
    } else if (t.closest('[data-decide]')) {
      const button = t.closest('[data-decide]');
      const key = button.closest('[data-key]').dataset.key;
      const decision = button.dataset.decide;
      save({ ...review, items: review.items.map((i) => (i.key === key ? { ...i, decision: i.decision === decision ? null : decision } : i)) });
      render();
    } else if (t.closest('[data-review-off]')) setAdmin(false);
  });

  // Felder ändern ohne neu zu zeichnen (sonst springt der Fokus weg).
  list.addEventListener('change', (event) => {
    const field = event.target.closest('[data-field]');
    const key = field?.closest('[data-key]')?.dataset.key;
    if (!key) return;
    const value = field.value;
    const patch = field.dataset.field === 'synonyms'
      ? { synonyms: value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10) }
      : field.dataset.field === 'name' ? (value.trim() ? { name: value.trim().slice(0, 80) } : {})
        : { [field.dataset.field]: value };
    save({ ...review, items: review.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  });

  shareButton.addEventListener('click', async () => {
    const text = prepared?.text;
    if (!text) return;
    const done = () => { save(clearDecided(review)); render(); };
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Katalog-Freigabe', text });
        done();
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      done();
      model.notify('Freigabe kopiert – am Mac mit vorschlaege.py --freigabe übernehmen');
    } catch {
      model.notify('Teilen ist in diesem Browser nicht möglich');
    }
  });

  function prepare() {
    prepared = null;
    const snapshot = review;
    releaseMessage(snapshot).then((text) => { if (review === snapshot) prepared = text ? { text } : null; }).catch(() => { prepared = null; });
  }

  function options(entries, selected) {
    return entries.map(([value, label]) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  function row(item, index, hint, categories) {
    const notes = [item.count ? `${item.count}× gekauft` : null,
      hint?.inCatalog ? `schon im Katalog als „${hint.inCatalog}“` : null,
      hint?.rejectedBefore ? 'früher abgelehnt' : null].filter(Boolean).join(' · ');
    const pressed = (d) => (item.decision === d ? 'true' : 'false');
    const field = `review-${index}`;   // Feld-IDs nach Position, Namen können Leerzeichen enthalten
    return `<div class="card review-item${item.decision ? ` is-${item.decision}` : ''}" role="listitem" data-key="${esc(item.key)}">
      <label class="sr-only" for="${esc(field)}-name">Name</label>
      <input id="${esc(field)}-name" class="review-name" data-field="name" type="text" value="${esc(item.name)}" autocomplete="off" spellcheck="false">
      ${notes ? `<p class="review-note${hint?.inCatalog || hint?.rejectedBefore ? ' warn' : ''}">${esc(notes)}</p>` : ''}
      <div class="review-fields">
        <label class="sr-only" for="${esc(field)}-cat">Kategorie</label>
        <select id="${esc(field)}-cat" class="unit-select" data-field="category">${options(categories.map((c) => [c.key, c.name]), item.category)}</select>
        <label class="sr-only" for="${esc(field)}-unit">Einheit</label>
        <select id="${esc(field)}-unit" class="unit-select" data-field="unit">${options(Object.entries(UNITS).map(([k, u]) => [k, u.label]), item.unit)}</select>
      </div>
      <label class="sr-only" for="${esc(field)}-syn">Suchwörter</label>
      <input id="${esc(field)}-syn" class="review-synonyms" data-field="synonyms" type="text" value="${esc(item.synonyms.join(', '))}" placeholder="Suchwörter, mit Komma getrennt" autocomplete="off" spellcheck="false">
      <div class="review-decide">
        <button type="button" class="button secondary" data-decide="accept" aria-pressed="${pressed('accept')}">Aufnehmen</button>
        <button type="button" class="button secondary" data-decide="reject" aria-pressed="${pressed('reject')}">Ablehnen</button>
      </div>
    </div>`;
  }

  function render() {
    root.hidden = !admin;
    if (!admin) return;
    const categories = catalogCategories();
    const hints = reviewHints(review, model.state.products);
    list.innerHTML = review.items.length
      ? review.items.map((item, index) => row(item, index, hints.get(item.key), categories)).join('')
      : '<p class="unit-hint">Keine offenen Vorschläge.</p>';
    const decided = review.items.filter((i) => i.decision).length;
    shareButton.disabled = decided === 0;
    shareButton.textContent = decided ? `Freigabe teilen (${decided})` : 'Freigabe teilen';
  }

  prepare();
  render();
}
