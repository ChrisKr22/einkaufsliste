import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ListModel } from '../js/list-model.js';
import { makeStore, productNamed } from './helpers.js';

/** Legt Kaufhistorie direkt am Produkt an: [Name, Anzahl Käufe, zuletzt gekauft (Zeitstempel), Menge, Anmerkung]. */
async function makeModel(history) {
  const { repository, store } = await makeStore();
  for (const [name, purchaseCount, lastPurchasedAt, lastQuantity = 1, lastNote = ''] of history) {
    const product = await productNamed(repository, name);
    await store.put('products', { ...product, purchaseCount, lastPurchasedAt, lastQuantity, lastNote });
  }
  const model = new ListModel(repository, { toastMs: 50 });
  await model.load();
  return { model, repository };
}

const names = (list) => list.map((r) => r.product.name);

describe('Zuletzt gekauft', () => {
  test('ohne Einkäufe leer', async () => {
    const { model } = await makeModel([]);
    assert.deepEqual(model.purchasedProducts(), []);
  });

  test('zuletzt Gekauftes zuerst', async () => {
    const { model } = await makeModel([['Milch', 5, 100], ['Äpfel', 1, 300], ['Brot', 2, 200]]);
    assert.deepEqual(names(model.purchasedProducts('recent')), ['Äpfel', 'Brot', 'Milch']);
  });

  test('häufig Gekauftes zuerst', async () => {
    const { model } = await makeModel([['Milch', 5, 100], ['Äpfel', 1, 300], ['Brot', 2, 200]]);
    assert.deepEqual(names(model.purchasedProducts('frequent')), ['Milch', 'Brot', 'Äpfel']);
  });

  test('gleicher Einkauf: häufiger Gekauftes vorn, dann alphabetisch', async () => {
    const { model } = await makeModel([['Salz', 1, 500], ['Butter', 3, 500], ['Eier', 1, 500]]);
    assert.deepEqual(names(model.purchasedProducts('recent')), ['Butter', 'Eier', 'Salz']);
  });

  test('zeigt Menge und Anmerkung vom letzten Mal', async () => {
    const { model } = await makeModel([['Äpfel', 1, 300, 2, 'Elstar'], ['Brot', 1, 200]]);
    const [apples, bread] = model.purchasedProducts();
    assert.equal(apples.subtitle, '2× · Elstar');
    assert.equal(bread.subtitle, '1×');
  });

  test('ein Tipp fügt mit Menge und Anmerkung hinzu und markiert „auf der Liste“', async () => {
    const { model } = await makeModel([['Äpfel', 1, 300, 2, 'Elstar']]);
    const [apples] = model.purchasedProducts();
    assert.equal(apples.isOnList, false);
    await model.add(apples.product.id);
    const [item] = model.plannedItems;
    assert.equal(item.quantity, 2);
    assert.equal(item.note, 'Elstar');
    assert.equal(model.purchasedProducts()[0].isOnList, true);
  });

  test('Limit wird eingehalten', async () => {
    const { model } = await makeModel([['Milch', 1, 1], ['Äpfel', 1, 2], ['Brot', 1, 3]]);
    assert.equal(model.purchasedProducts('recent', 2).length, 2);
  });
});
