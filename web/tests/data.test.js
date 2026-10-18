import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importCatalog } from '../js/data/catalog-import.js';
import { ShoppingRepository } from '../js/data/repository.js';
import { MemoryStore } from '../js/storage/memory-store.js';
import { catalog, makeStore, productNamed } from './helpers.js';

describe('Katalog-Import', () => {
  test('erster Start übernimmt alles in Katalog-Reihenfolge', async () => {
    const { repository, store } = await makeStore();
    const categories = await repository.categories();
    assert.equal(categories.length, catalog.categories.length);
    assert.equal((await repository.products()).length, catalog.products.length);
    assert.deepEqual(categories.map((c) => c.key), catalog.categories.map((c) => c.id));
    assert.equal((await store.get('meta', 'catalogVersion')).value, catalog.version);
  });

  test('jedes Produkt hat eine Kategorie', async () => {
    const { repository } = await makeStore();
    assert.ok((await repository.products()).every((p) => p.categoryId));
  });

  test('gleiche Version wird nicht doppelt importiert', async () => {
    const { repository, store } = await makeStore();
    const summary = await importCatalog(catalog, store);
    assert.equal(summary.skipped, true);
    assert.equal((await repository.products()).length, catalog.products.length);
  });

  test('neuere Version ergänzt und behält eigene Änderungen', async () => {
    const store = new MemoryStore();
    const v1 = {
      version: 1,
      categories: [{ id: 'obst', name: 'Obst' }, { id: 'sonst', name: 'Sonstiges' }],
      products: [{ id: 'aepfel', name: 'Äpfel', category: 'obst', synonyms: ['Apfel'] }],
    };
    await importCatalog(v1, store);
    const obst = (await store.getAll('categories')).find((c) => c.key === 'obst');
    await store.put('categories', { ...obst, name: 'Früchte' });   // Nutzer benennt um

    const v2 = {
      version: 2,
      categories: [...v1.categories, { id: 'gemuese', name: 'Gemüse' }],
      products: [
        { id: 'aepfel', name: 'Äpfel', category: 'obst', synonyms: ['Apfel', 'Äppel'] },
        { id: 'tomaten', name: 'Tomaten', category: 'gemuese', synonyms: [] },
      ],
    };
    const summary = await importCatalog(v2, store);
    assert.deepEqual(summary, { categoriesAdded: 1, productsAdded: 1, productsUpdated: 1, skipped: false });

    const repository = new ShoppingRepository(store);
    const categories = await repository.categories();
    assert.equal(categories.find((c) => c.key === 'obst').name, 'Früchte');
    assert.equal(categories.at(-1).key, 'gemuese', 'neue Kategorien kommen ans Ende des Laufwegs');
    assert.deepEqual((await productNamed(repository, 'Äpfel')).synonyms, ['Apfel', 'Äppel']);
  });
});

describe('Katalog-Import: Umbenennen', () => {
  const small = (version, name, synonyms) => ({
    version,
    categories: [{ id: 'obst', name: 'Obst' }, { id: 'sonst', name: 'Sonstiges' }],
    products: [{ id: 'avocados', name, category: 'obst', synonyms }],
  });

  test('im Katalog umbenannt (alter Name jetzt Synonym): Name wird nachgezogen', async () => {
    const store = new MemoryStore();
    await importCatalog(small(1, 'Avocados', ['Avocado']), store);
    const summary = await importCatalog(small(2, 'Avocado', ['Avocados']), store);
    const [product] = await store.getAll('products');
    assert.equal(product.name, 'Avocado');
    assert.deepEqual(product.synonyms, ['Avocados']);
    assert.equal(summary.productsUpdated, 1);
  });

  test('selbst umbenannt: eigener Name bleibt', async () => {
    const store = new MemoryStore();
    await importCatalog(small(1, 'Avocados', ['Avocado']), store);
    const [product] = await store.getAll('products');
    await store.put('products', { ...product, name: 'Hass-Avocado' });
    await importCatalog(small(2, 'Avocado', ['Avocados']), store);
    assert.equal((await store.getAll('products'))[0].name, 'Hass-Avocado');
  });

  test('mitgelieferter Katalog: Avocado heißt jetzt Avocado', async () => {
    const { repository } = await makeStore();
    assert.ok(await productNamed(repository, 'Avocado'));
  });
});

describe('Repository', () => {
  test('Hinzufügen legt auf die Liste', async () => {
    const { repository } = await makeStore();
    const apples = await productNamed(repository, 'Äpfel');
    const result = await repository.add(apples.id, { quantity: 2, note: 'Elstar' });
    assert.equal(result.type, 'added');
    assert.equal(result.item.quantity, 2);
    assert.equal(result.item.note, 'Elstar');
    assert.equal(result.item.status, 'open');
    assert.equal((await repository.listItems()).length, 1);
  });

  test('zweimal hinzufügen erhöht statt zu verdoppeln', async () => {
    const { repository } = await makeStore();
    const milk = await productNamed(repository, 'Milch');
    await repository.add(milk.id);
    const result = await repository.add(milk.id);
    assert.equal(result.type, 'incremented');
    assert.equal(result.previousQuantity, 1);
    assert.equal(result.item.quantity, 2);
    assert.equal((await repository.listItems()).length, 1);
  });

  test('übernimmt Menge und Anmerkung vom letzten Einkauf', async () => {
    const { repository, store } = await makeStore();
    const eggs = await productNamed(repository, 'Eier');
    await store.put('products', { ...eggs, lastQuantity: 2, lastNote: 'Freiland' });
    const { item } = await repository.add(eggs.id);
    assert.equal(item.quantity, 2);
    assert.equal(item.note, 'Freiland');
  });

  test('Menge fällt nie unter 1', async () => {
    const { repository } = await makeStore();
    const { item } = await repository.add((await productNamed(repository, 'Butter')).id, { quantity: 1 });
    await repository.setQuantity(item.id, 0);
    assert.equal((await repository.listItems())[0].quantity, 1);
  });

  test('Entfernen und Wiederherstellen', async () => {
    const { repository } = await makeStore();
    const { item } = await repository.add((await productNamed(repository, 'Brot')).id, { quantity: 1, note: 'Dinkel' });
    await repository.remove(item.id);
    assert.deepEqual(await repository.listItems(), []);
    await repository.restore(item);
    const [restored] = await repository.listItems();
    assert.equal(restored.id, item.id);
    assert.equal(restored.note, 'Dinkel');
  });

  test('eigene Produkte landen unter Sonstiges', async () => {
    const { repository } = await makeStore();
    const product = await repository.createProduct('  Kokosmilch light ');
    assert.equal(product.name, 'Kokosmilch light');
    assert.equal(product.isCustom, true);
    const misc = (await repository.categories()).find((c) => c.key === 'sonst');
    assert.equal(product.categoryId, misc.id);
  });

  test('Anmerkung und Menge werden gespeichert', async () => {
    const { repository } = await makeStore();
    const { item } = await repository.add((await productNamed(repository, 'Spaghetti')).id, { quantity: 1, note: '' });
    await repository.setNote(item.id, 'Barilla Nr. 5');
    await repository.setQuantity(item.id, 3);
    const [saved] = await repository.listItems();
    assert.equal(saved.note, 'Barilla Nr. 5');
    assert.equal(saved.quantity, 3);
  });
});

describe('Katalog-Import: Kategorie aufteilen', () => {
  const v1 = {
    version: 1,
    categories: [{ id: 'drogerie', name: 'Drogerie & Haushalt' }, { id: 'sonst', name: 'Sonstiges' }],
    products: [
      { id: 'duschgel', name: 'Duschgel', category: 'drogerie', synonyms: [] },
      { id: 'spuelmittel', name: 'Spülmittel', category: 'drogerie', synonyms: [] },
      { id: 'alufolie', name: 'Alufolie', category: 'drogerie', synonyms: [] },
    ],
  };
  const v2 = {
    version: 2,
    categories: [
      { id: 'drogerie', name: 'Drogerie', renamed_from: ['Drogerie & Haushalt'] },
      { id: 'haushalt', name: 'Haushalt' },
      { id: 'sonst', name: 'Sonstiges' },
    ],
    products: [
      { id: 'duschgel', name: 'Duschgel', category: 'drogerie', synonyms: [] },
      { id: 'spuelmittel', name: 'Spülmittel', category: 'haushalt', moved_from: 'drogerie', synonyms: [] },
      { id: 'alufolie', name: 'Alufolie', category: 'haushalt', moved_from: 'drogerie', synonyms: [] },
    ],
  };
  const byKey = async (store, key) => (await store.getAll('categories')).find((c) => c.key === key);
  const productCategory = async (store, catalogId) => (await store.getAll('products')).find((p) => p.catalogId === catalogId).categoryId;

  test('benennt um, legt die neue Kategorie dahinter an und verschiebt die Produkte', async () => {
    const store = new MemoryStore();
    await importCatalog(v1, store);
    const summary = await importCatalog(v2, store);
    const repository = new ShoppingRepository(store);
    assert.deepEqual((await repository.categories()).map((c) => c.name), ['Drogerie', 'Haushalt', 'Sonstiges']);
    assert.equal(await productCategory(store, 'spuelmittel'), (await byKey(store, 'haushalt')).id);
    assert.equal(await productCategory(store, 'duschgel'), (await byKey(store, 'drogerie')).id);
    assert.equal(summary.productsUpdated, 2);
  });

  test('eigene Reihenfolge, eigener Name und selbst einsortierte Produkte bleiben', async () => {
    const store = new MemoryStore();
    await importCatalog(v1, store);
    const drogerie = await byKey(store, 'drogerie');
    const sonst = await byKey(store, 'sonst');
    await store.putMany('categories', [{ ...drogerie, name: 'Bad', sortOrder: 1 }, { ...sonst, sortOrder: 0 }]);
    const alufolie = (await store.getAll('products')).find((p) => p.catalogId === 'alufolie');
    await store.put('products', { ...alufolie, categoryId: sonst.id });   // selbst umsortiert
    await importCatalog(v2, store);
    const repository = new ShoppingRepository(store);
    assert.deepEqual((await repository.categories()).map((c) => c.name), ['Sonstiges', 'Bad', 'Haushalt']);
    assert.equal(await productCategory(store, 'alufolie'), sonst.id);
    assert.equal(await productCategory(store, 'spuelmittel'), (await byKey(store, 'haushalt')).id);
  });
});
