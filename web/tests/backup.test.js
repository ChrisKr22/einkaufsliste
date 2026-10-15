import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createBackup, parseBackup, restoreBackup } from '../js/data/backup.js';
import { ListModel } from '../js/list-model.js';
import { MemoryStore } from '../js/storage/memory-store.js';
import { makeStore, productNamed } from './helpers.js';

async function makeModel() {
  const { repository, store } = await makeStore();
  const model = new ListModel(repository, { toastMs: 50 });
  await model.load();
  return { model, repository, store };
}

async function addNamed(model, repository, name) {
  await model.add((await productNamed(repository, name)).id);
}

describe('Sicherung', () => {
  test('Export und Einspielen ergibt denselben Stand', async () => {
    const { model, repository, store } = await makeModel();
    await addNamed(model, repository, 'Äpfel');
    await model.setNote(model.plannedItems[0], 'Elstar');
    await model.renameCategory(model.state.categories[0], 'Früchte');

    const backup = await createBackup(store);
    const other = new MemoryStore();
    await restoreBackup(other, parseBackup(JSON.stringify(backup)));
    for (const name of ['categories', 'products', 'entries']) {
      assert.deepEqual(await other.getAll(name), await store.getAll(name), name);
    }
  });

  test('Exportdatei: Name, Inhalt, Zusammenfassung', async () => {
    const { model, repository } = await makeModel();
    await addNamed(model, repository, 'Milch');
    const { json, fileName, summary } = await model.prepareExport();
    assert.match(fileName, /^feedyourself-sicherung-\d{4}-\d{2}-\d{2}\.json$/);
    const parsed = JSON.parse(json);
    assert.equal(parsed.app, 'FeedYourself');
    assert.equal(parsed.format, 1);
    assert.equal(summary.entries, 1);
    assert.equal(summary.products, parsed.data.products.length);
  });

  test('„Zuletzt gesichert“ erst nach bestätigtem Export', async () => {
    const { model } = await makeModel();
    assert.equal(model.state.lastBackupAt, null);
    await model.prepareExport();
    assert.equal(model.state.lastBackupAt, null);
    await model.confirmExported();
    assert.ok(model.state.lastBackupAt > 0);
    assert.equal(model.state.toast.text, 'Sicherung erstellt');
  });

  test('Einspielen ersetzt alles, Rückgängig holt den alten Stand zurück', async () => {
    const { model, repository } = await makeModel();
    await addNamed(model, repository, 'Brot');
    const { json } = await model.prepareExport();       // Stand A: Brot

    await addNamed(model, repository, 'Butter');           // Stand B: Brot, Butter
    await model.renameCategory(model.state.categories[0], 'Früchte');

    await model.importBackup(json);
    assert.deepEqual(model.plannedItems.map((i) => i.product.name), ['Brot']);
    assert.equal(model.state.categories[0].name, 'Obst');
    assert.match(model.state.toast.text, /Sicherung eingespielt: \d+ Produkte, 1 auf der Liste/);

    await model.undo();
    assert.deepEqual(model.plannedItems.map((i) => i.product.name).sort(), ['Brot', 'Butter']);
    assert.equal(model.state.categories[0].name, 'Früchte');
  });

  test('„Zuletzt gesichert“ bleibt beim Einspielen erhalten', async () => {
    const { model } = await makeModel();
    await model.confirmExported();
    const before = model.state.lastBackupAt;
    const { json } = await model.prepareExport();
    await model.importBackup(json);
    assert.equal(model.state.lastBackupAt, before);
  });

  test('Vorschau beschreibt die Datei', async () => {
    const { model, repository } = await makeModel();
    await addNamed(model, repository, 'Salz');
    const { json } = await model.prepareExport();
    const preview = model.previewImport(json);
    assert.equal(preview.entries, 1);
    assert.equal(preview.categories, model.state.categories.length);
    assert.ok(preview.exportedAt);
  });

  describe('ungültige Dateien', () => {
    const cases = [
      ['kein JSON', 'hallo', /kein JSON/],
      ['fremde Datei', JSON.stringify({ app: 'Andere' }), /keine FeedYourself-Sicherung/],
      ['neueres Format', JSON.stringify({ app: 'FeedYourself', format: 99, data: {} }), /neueren Version/],
      ['unvollständig', JSON.stringify({ app: 'FeedYourself', format: 1, data: { categories: [] } }), /unvollständig/],
      ['Eintrag ohne Produkt', JSON.stringify({
        app: 'FeedYourself', format: 1,
        data: { categories: [{ id: 'c', key: 'k', name: 'K', sortOrder: 0 }], products: [], entries: [{ id: 'e', productId: 'x', quantity: 1, status: 'open' }], meta: [] },
      }), /beschädigt \(Listeneintrag\)/],
    ];
    for (const [label, text, message] of cases) {
      test(label, () => assert.throws(() => parseBackup(text), message));
    }

    test('fehlerhafte Datei ändert nichts', async () => {
      const { model, repository } = await makeModel();
      await addNamed(model, repository, 'Milch');
      await assert.rejects(model.importBackup('{"app":"Andere"}'), /keine FeedYourself-Sicherung/);
      assert.deepEqual(model.plannedItems.map((i) => i.product.name), ['Milch']);
    });
  });
});
