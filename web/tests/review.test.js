// Pflegemodus: Vorschläge prüfen und als Freigabe weitergeben.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addSuggestions, clearDecided, emptyReview, normalizeReview, readRelease, readSuggestions, releaseMessage, reviewHints, RELEASE_MARKER } from '../js/data/review.js';
import { suggestionMessage } from '../js/data/suggest.js';

const keys = new Set(['konserven', 'snacks', 'sonst']);
const own = (name, extra = {}) => ({ id: name, name, isCustom: true, catalogId: null, synonyms: [], ...extra });

async function message(products, categoryKey = 'konserven') {
  return suggestionMessage(products, () => ({ key: categoryKey, name: 'Konserven' }));
}

describe('Vorschläge prüfen', () => {
  test('mehrere Nachrichten einlesen, gleiche Namen zusammenführen', async () => {
    const text = `${await message([own('Ajvar', { purchaseCount: 2 })])}\n\n${await message([own('ajvar', { purchaseCount: 1 }), own('Zwieback')])}`;
    const rows = await readSuggestions(text);
    const { review, added, merged } = addSuggestions(emptyReview(), rows, keys);
    assert.equal(added, 2);
    assert.equal(merged, 1);
    assert.deepEqual(review.items.map((i) => [i.name, i.count]), [['Ajvar', 3], ['Zwieback', 0]]);
  });

  test('unbekannte Kategorie wird Sonstiges, Steuerzeichen fallen weg', () => {
    const { review } = addSuggestions(emptyReview(), [{ n: 'Aj\u0007var', k: 'eigene-123', y: ['Paprikamus', 'ajvar'] }], keys);
    assert.equal(review.items[0].name, 'Ajvar');
    assert.equal(review.items[0].category, 'sonst');
    assert.deepEqual(review.items[0].synonyms, ['Paprikamus']);
  });

  test('Text ohne Code meldet einen Fehler', async () => {
    await assert.rejects(() => readSuggestions('Hallo'), /Kein Katalog-Vorschlag/);
  });

  test('Hinweise: schon im Katalog (auch als Suchwort) und früher abgelehnt', () => {
    const review = { items: [{ key: 'olivenol', name: 'Olivenöl' }, { key: 'kaugummi', name: 'Kaugummi' }], rejected: ['kaugummi'] };
    const hints = reviewHints(review, [{ name: 'Öl', synonyms: ['Olivenöl'], catalogId: 'oel' }, own('Kaugummi')]);
    assert.equal(hints.get('olivenol').inCatalog, 'Öl');
    assert.equal(hints.get('kaugummi').inCatalog, null, 'eigene Produkte zählen nicht');
    assert.equal(hints.get('kaugummi').rejectedBefore, true);
  });

  test('Freigabe enthält Aufgenommene mit Angaben und Abgelehnte mit Namen', async () => {
    const { review } = addSuggestions(emptyReview(), [{ n: 'Ajvar', k: 'konserven', u: 'g', y: ['Paprikamus'] }, { n: 'Kaugummi', k: 'snacks' }, { n: 'Offen' }], keys);
    review.items[0].decision = 'accept';
    review.items[1].decision = 'reject';
    const text = await releaseMessage(review);
    assert.match(text, /Aufnehmen \(1\): Ajvar/);
    assert.match(text, /Ablehnen \(1\): Kaugummi/);
    assert.ok(text.includes(RELEASE_MARKER));
    const release = await readRelease(text);
    assert.deepEqual(release, { v: 1, a: [{ n: 'Ajvar', k: 'konserven', u: 'g', y: ['Paprikamus'] }], r: ['Kaugummi'] });

    const after = clearDecided(review);
    assert.deepEqual(after.items.map((i) => i.name), ['Offen']);
    assert.deepEqual(after.rejected, ['kaugummi']);
  });

  test('ohne Entscheidung keine Freigabe', async () => {
    const { review } = addSuggestions(emptyReview(), [{ n: 'Ajvar' }], keys);
    assert.equal(await releaseMessage(review), null);
  });

  test('gespeicherter Stand wird geprüft', () => {
    const review = normalizeReview({ items: [{ name: '' }, { name: 'Ajvar', unit: 'fass', decision: 'vielleicht', count: -3 }, 'Müll'], rejected: ['x', 5] });
    assert.deepEqual(review.items, [{ key: 'ajvar', name: 'Ajvar', category: 'sonst', unit: 'stk', synonyms: [], count: 0, decision: null }]);
    assert.deepEqual(review.rejected, ['x']);
  });
});
