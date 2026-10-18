import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importCatalog } from '../js/data/catalog-import.js';
import { ListModel } from '../js/list-model.js';
import { catalog, makeStore, productNamed } from './helpers.js';

async function makeModel() {
  const { repository, store } = await makeStore();
  const model = new ListModel(repository, { toastMs: 50 });
  await model.load();
  return { model, repository, store };
}

const keys = (model) => model.state.categories.map((c) => c.key);
const byKey = (model, key) => model.state.categories.find((c) => c.key === key);

describe('Kategorien verwalten', () => {
  test('Übersicht mit Produktanzahl, „Sonstiges“ nicht löschbar', async () => {
    const { model } = await makeModel();
    const rows = model.categoryRows;
    assert.equal(rows.length, catalog.categories.length);
    const obst = rows.find((r) => r.category.key === 'obst');
    assert.equal(obst.productCount, catalog.products.filter((p) => p.category === 'obst').length);
    assert.equal(rows.find((r) => r.category.key === 'sonst').canDelete, false);
    assert.ok(rows.filter((r) => r.category.key !== 'sonst').every((r) => r.canDelete));
  });

  test('umbenennen; leerer Name wird „Neue Kategorie“', async () => {
    const { model } = await makeModel();
    await model.renameCategory(byKey(model, 'obst'), '  Früchte ');
    assert.equal(byKey(model, 'obst').name, 'Früchte');
    await model.renameCategory(byKey(model, 'obst'), '   ');
    assert.equal(byKey(model, 'obst').name, 'Neue Kategorie');
  });

  test('Reihenfolge ändern bestimmt den Laufweg in Planung und Einkauf', async () => {
    const { model, repository } = await makeModel();
    for (const name of ['Äpfel', 'Milch', 'Waschmittel']) await model.add((await productNamed(repository, name)).id);
    const ids = model.state.categories.map((c) => c.id);
    const haushalt = byKey(model, 'haushalt').id;
    await model.reorderCategories([haushalt, ...ids.filter((id) => id !== haushalt)]);
    assert.equal(keys(model)[0], 'haushalt');
    assert.deepEqual(model.sections.map((s) => s.category.key), ['haushalt', 'obst', 'milch']);
    assert.deepEqual(model.focusQueue.map((i) => i.product.name), ['Waschmittel', 'Äpfel', 'Milch']);
    assert.deepEqual(model.state.categories.map((c) => c.sortOrder), model.state.categories.map((_, i) => i));
  });

  test('mit Tastatur eine Position verschieben, an den Rändern nichts', async () => {
    const { model } = await makeModel();
    const [first, second] = keys(model);
    await model.moveCategory(byKey(model, first).id, 1);
    assert.deepEqual(keys(model).slice(0, 2), [second, first]);
    await model.moveCategory(byKey(model, second).id, -1);
    assert.deepEqual(keys(model).slice(0, 2), [second, first]);
  });

  test('neue Kategorie landet vor „Sonstiges“', async () => {
    const { model } = await makeModel();
    const category = await model.addCategory();
    assert.equal(category.name, 'Neue Kategorie');
    assert.deepEqual(keys(model).slice(-2), [category.key, 'sonst']);
  });

  test('löschen: Produkte nach „Sonstiges“, Rückgängig stellt alles wieder her', async () => {
    const { model, repository } = await makeModel();
    const kaese = byKey(model, 'kaese');
    const position = keys(model).indexOf('kaese');
    const gouda = await productNamed(repository, 'Gouda');
    await model.add(gouda.id);

    await model.deleteCategory(kaese);
    assert.equal(byKey(model, 'kaese'), undefined);
    assert.equal((await productNamed(repository, 'Gouda')).categoryId, byKey(model, 'sonst').id);
    assert.equal(model.sections.at(-1).category.key, 'sonst', 'Gouda steht jetzt unter Sonstiges');
    assert.match(model.state.toast.text, /„Käse“ gelöscht – \d+ Produkte unter Sonstiges/);

    await model.undo();
    assert.equal(keys(model).indexOf('kaese'), position);
    assert.equal((await productNamed(repository, 'Gouda')).categoryId, kaese.id);
  });

  test('„Sonstiges“ lässt sich nicht löschen', async () => {
    const { model } = await makeModel();
    await model.deleteCategory(byKey(model, 'sonst'));
    assert.ok(byKey(model, 'sonst'));
    assert.match(model.state.error, /Sonstiges/);
  });

  test('Katalog-Update legt gelöschte Kategorie nicht wieder an', async () => {
    const { model, store } = await makeModel();
    await model.deleteCategory(byKey(model, 'snacks'));
    const newer = {
      ...catalog,
      version: catalog.version + 1,
      products: [...catalog.products, { id: 'brezelsticks', name: 'Brezelsticks', category: 'snacks', synonyms: [] }],
    };
    await importCatalog(newer, store);
    await model.load();
    assert.equal(byKey(model, 'snacks'), undefined);
    const sticks = model.state.products.find((p) => p.name === 'Brezelsticks');
    assert.equal(sticks.categoryId, byKey(model, 'sonst').id);
  });
});
