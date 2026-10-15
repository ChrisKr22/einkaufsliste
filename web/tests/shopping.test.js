import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ListModel } from '../js/list-model.js';
import { makeStore, productNamed } from './helpers.js';

async function makeModel(names = []) {
  const { repository } = await makeStore();
  const model = new ListModel(repository, { toastMs: 50 });
  await model.load();
  for (const name of names) await model.add((await productNamed(repository, name)).id);
  return { model, repository };
}

const item = (model, name) => model.state.items.find((i) => i.product.name === name);

describe('Einkaufsmodus', () => {
  test('zeigt nur Offenes, in Laden-Reihenfolge', async () => {
    const { model } = await makeModel(['Waschmittel', 'Milch', 'Äpfel', 'Brot']);
    await model.toCart(item(model, 'Brot'));
    assert.deepEqual(model.shopSections.map((s) => s.category.key), ['obst', 'milch', 'drogerie']);
    assert.deepEqual(model.focusQueue.map((i) => i.product.name), ['Äpfel', 'Milch', 'Waschmittel']);
  });

  test('in den Wagen, zurückstellen, Fortschritt', async () => {
    const { model } = await makeModel(['Äpfel', 'Milch', 'Brot']);
    await model.toCart(item(model, 'Äpfel'));
    await model.toLater(item(model, 'Brot'));
    assert.deepEqual(model.cartItems.map((i) => i.product.name), ['Äpfel']);
    assert.deepEqual(model.laterItems.map((i) => i.product.name), ['Brot']);
    assert.deepEqual(model.openItems.map((i) => i.product.name), ['Milch']);
    assert.deepEqual(model.progress, { done: 1, total: 3, ratio: 1 / 3 });
    assert.equal(model.state.cartedCount, 1);
    assert.match(model.state.toast.text, /Brot zurückgestellt/);
  });

  test('Rückgängig nach „in den Wagen“', async () => {
    const { model } = await makeModel(['Butter']);
    await model.toCart(item(model, 'Butter'));
    await model.undo();
    assert.equal(item(model, 'Butter').status, 'open');
  });

  test('„Doch gefunden“ und „Zurück“ machen wieder offen', async () => {
    const { model } = await makeModel(['Butter', 'Salz']);
    await model.toLater(item(model, 'Butter'));
    await model.toCart(item(model, 'Salz'));
    await model.reopen(item(model, 'Butter'));
    await model.reopen(item(model, 'Salz'));
    assert.equal(model.openItems.length, 2);
  });

  test('zurückgestellte Einträge erscheinen in der Planung als „zurückgestellt“', async () => {
    const { model } = await makeModel(['Butter']);
    await model.toLater(item(model, 'Butter'));
    assert.equal(model.plannedItems[0].status, 'later');
  });

  test('Einkauf abschließen: Gekauftes weg und gemerkt, Rest bleibt offen', async () => {
    const { model, repository } = await makeModel(['Äpfel', 'Milch', 'Brot']);
    const apples = item(model, 'Äpfel');
    await model.setQuantity(apples, 3);
    await model.setNote(item(model, 'Äpfel'), 'Elstar');
    await model.toCart(item(model, 'Äpfel'));
    await model.toLater(item(model, 'Brot'));

    const summary = await model.finishShopping();
    assert.deepEqual(summary, { bought: 1, kept: 2 });
    assert.deepEqual(model.state.summary, { bought: 1, kept: 2 });
    assert.deepEqual(model.state.items.map((i) => [i.product.name, i.status]).sort(), [['Brot', 'open'], ['Milch', 'open']]);
    assert.equal(model.state.toast, null);

    const bought = await productNamed(repository, 'Äpfel');
    assert.equal(bought.purchaseCount, 1);
    assert.equal(bought.lastQuantity, 3);
    assert.equal(bought.lastNote, 'Elstar');
    assert.ok(bought.lastPurchasedAt);
  });

  test('beim nächsten Mal: Menge und Anmerkung vom letzten Einkauf, Hinweis in der Suche', async () => {
    const { model } = await makeModel(['Äpfel']);
    await model.setQuantity(item(model, 'Äpfel'), 2);
    await model.setNote(item(model, 'Äpfel'), 'Elstar');
    await model.toCart(item(model, 'Äpfel'));
    await model.finishShopping();

    model.setQuery('äpfel');
    assert.equal(model.suggestions[0].subtitle, 'Zuletzt: 2× · Elstar');
    await model.submitSearch();
    const again = item(model, 'Äpfel');
    assert.equal(again.quantity, 2);
    assert.equal(again.note, 'Elstar');
  });

  test('Abschlussübersicht schließen', async () => {
    const { model } = await makeModel(['Salz']);
    await model.toCart(item(model, 'Salz'));
    await model.finishShopping();
    model.dismissSummary();
    assert.equal(model.state.summary, null);
  });
});
