import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ListModel } from '../js/list-model.js';
import { makeStore } from './helpers.js';

async function makeModel() {
  const { repository } = await makeStore();
  const model = new ListModel(repository, { toastMs: 50 });
  await model.load();
  return model;
}

async function addByQuery(model, query) {
  model.setQuery(query);
  await model.submitSearch();
}

describe('Planungsmodus', () => {
  test('Enter fügt den besten Treffer hinzu und leert die Suche', async () => {
    const model = await makeModel();
    await addByQuery(model, 'oliven');
    assert.equal(model.state.query, '');
    assert.deepEqual(model.plannedItems.map((i) => i.product.name), ['Olivenöl']);
    assert.equal(model.state.toast.canUndo, true);
    assert.equal(model.state.addedCount, 1);
  });

  test('Enter legt unbekanntes Produkt an', async () => {
    const model = await makeModel();
    model.setQuery('zzz drachenfrucht');
    assert.deepEqual(model.suggestions, []);
    assert.equal(model.canCreateFromQuery, true);
    await model.submitSearch();
    assert.equal(model.plannedItems[0].product.name, 'Zzz drachenfrucht');
    assert.equal(model.plannedItems[0].product.isCustom, true);
  });

  test('kein „neu anlegen“ bei exaktem Namen', async () => {
    const model = await makeModel();
    model.setQuery('milch');
    assert.equal(model.canCreateFromQuery, false);
  });

  test('Vorschlag zeigt „schon auf der Liste“', async () => {
    const model = await makeModel();
    await addByQuery(model, 'Milch');
    model.setQuery('Milch');
    assert.equal(model.suggestions[0].isOnList, true);
    assert.match(model.suggestions[0].subtitle, /Schon auf der Liste/);
  });

  test('zweimal hinzufügen ergibt 2×', async () => {
    const model = await makeModel();
    await addByQuery(model, 'Milch');
    await addByQuery(model, 'Milch');
    assert.equal(model.plannedItems[0].quantity, 2);
  });

  test('Minus bei 1 entfernt, Rückgängig stellt wieder her', async () => {
    const model = await makeModel();
    await addByQuery(model, 'Butter');
    const [item] = model.plannedItems;
    await model.decrement(item);
    assert.deepEqual(model.plannedItems, []);
    await model.undo();
    assert.deepEqual(model.plannedItems.map((i) => i.id), [item.id]);
  });

  test('Rückgängig nach dem Hinzufügen entfernt wieder', async () => {
    const model = await makeModel();
    await addByQuery(model, 'Brot');
    await model.undo();
    assert.deepEqual(model.plannedItems, []);
  });

  test('Abschnitte folgen der Laden-Reihenfolge', async () => {
    const model = await makeModel();
    for (const q of ['Waschmittel', 'Milch', 'Äpfel']) await addByQuery(model, q);
    assert.deepEqual(model.sections.map((s) => s.category.key), ['obst', 'milch', 'haushalt']);
  });

  test('Anmerkung bearbeiten', async () => {
    const model = await makeModel();
    await addByQuery(model, 'Äpfel');
    model.openEditor(model.plannedItems[0].id);
    await model.setNote(model.editingItem, 'Elstar');
    assert.equal(model.editingItem.note, 'Elstar');
  });

  test('Hinweis verschwindet von selbst und Rückgängig verfällt', async () => {
    const model = await makeModel();
    await addByQuery(model, 'Salz');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(model.state.toast, null);
    await model.undo();
    assert.equal(model.plannedItems.length, 1);
  });

  test('Beobachter werden benachrichtigt', async () => {
    const model = await makeModel();
    let calls = 0;
    model.subscribe(() => calls++);
    model.setQuery('a');
    assert.ok(calls >= 1);
  });
});
