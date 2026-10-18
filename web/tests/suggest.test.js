import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { preselected, readSuggestion, suggestionCandidates, SUGGEST_MARKER } from '../js/data/suggest.js';
import { ListModel } from '../js/list-model.js';
import { makeStore } from './helpers.js';

async function makeModel() {
  const { repository } = await makeStore();
  const model = new ListModel(repository, { toastMs: 50 });
  await model.load();
  return { model, repository };
}

async function createOwn(model, name) {
  model.setQuery(name);
  await model.createProductFromQuery();
  model.setQuery('');
  return model.state.products.find((p) => p.name === name);
}

describe('Katalog-Vorschläge', () => {
  test('nur eigene Produkte, meistgekaufte zuerst', () => {
    const own = (name, purchaseCount) => ({ id: name, name, isCustom: true, catalogId: null, purchaseCount });
    const list = suggestionCandidates([own('Zwieback', 1), { id: 'k', name: 'Milch', isCustom: false, catalogId: 'milch' }, own('Ajvar', 3), own('Bulgur', 1)]);
    assert.deepEqual(list.map((p) => p.name), ['Ajvar', 'Bulgur', 'Zwieback']);
  });

  test('aus der Vorschlagsliste entfernen: Produkt bleibt, Rückgängig und „wieder anzeigen“ holen es zurück', async () => {
    const { model } = await makeModel();
    const ajvar = await createOwn(model, 'Ajvar');
    await createOwn(model, 'Zwieback');
    await model.hideSuggestion(ajvar);
    assert.deepEqual(model.catalogCandidates.map((p) => p.name), ['Zwieback']);
    assert.deepEqual(model.hiddenCatalogCandidates.map((p) => p.name), ['Ajvar']);
    assert.ok(model.state.products.some((p) => p.name === 'Ajvar'), 'Produkt bleibt erhalten');
    await model.undo();
    assert.deepEqual(model.catalogCandidates.map((p) => p.name).sort(), ['Ajvar', 'Zwieback']);
    await model.hideSuggestion(model.state.products.find((p) => p.name === 'Ajvar'));
    await model.showHiddenSuggestions();
    assert.equal(model.hiddenCatalogCandidates.length, 0);
    assert.equal(model.catalogCandidates.length, 2);
  });

  test('Vorauswahl: mindestens zweimal gekauft, noch nicht vorgeschlagen', () => {
    assert.equal(preselected({ purchaseCount: 2 }), true);
    assert.equal(preselected({ purchaseCount: 1 }), false);
    assert.equal(preselected({ purchaseCount: 5, suggestedAt: '2026-10-16' }), false);
  });

  test('Nachricht ist lesbar und enthält einen Code, der sich zurücklesen lässt', async () => {
    const { model } = await makeModel();
    const ajvar = await createOwn(model, 'Ajvar');
    await model.setProductUnit(ajvar, 'g');
    const text = await model.suggestionText([ajvar.id]);
    assert.match(text, /Vorschlag für den FeedYourself-Katalog \(1 Produkt\)/);
    assert.match(text, /• Ajvar – Sonstiges, in Gramm/);
    assert.ok(text.includes(SUGGEST_MARKER));
    const rows = await readSuggestion(text);
    assert.deepEqual(rows, [{ n: 'Ajvar', k: 'sonst', kn: 'Sonstiges', u: 'g' }]);
  });

  test('Katalogprodukte lassen sich nicht vorschlagen; leere Auswahl ergibt nichts', async () => {
    const { model } = await makeModel();
    const milch = model.state.products.find((p) => p.name === 'Milch');
    assert.equal(await model.suggestionText([milch.id]), null);
    assert.equal(await model.suggestionText([]), null);
  });

  test('nach dem Teilen als vorgeschlagen markiert', async () => {
    const { model } = await makeModel();
    const ajvar = await createOwn(model, 'Ajvar');
    await model.confirmSuggested([ajvar.id]);
    assert.ok(model.state.products.find((p) => p.id === ajvar.id).suggestedAt);
    assert.match(model.state.toast.text, /Vorschlag geteilt/);
  });

  test('kaputter Code wird abgelehnt', async () => {
    await assert.rejects(readSuggestion('Hallo'), /Kein Katalog-Vorschlag/);
    await assert.rejects(readSuggestion(`${SUGGEST_MARKER}zAAAA`));
  });
});
