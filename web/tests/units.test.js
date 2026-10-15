import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createBackup, parseBackup } from '../js/data/backup.js';
import { decodeShare, encodeShare } from '../js/data/share.js';
import { ListModel } from '../js/list-model.js';
import { formatQuantity, normalizeQuantity, spokenQuantity, stepDown, stepUp } from '../js/units.js';
import { makeStore, productNamed } from './helpers.js';

async function makeModel() {
  const { repository, store } = await makeStore();
  const model = new ListModel(repository, { toastMs: 50 });
  await model.load();
  return { model, repository, store };
}

const item = (model, name) => model.state.items.find((i) => i.product.name === name);
const shown = (model, name) => formatQuantity(item(model, name).quantity, item(model, name).unit);

describe('Maßeinheiten', () => {
  test('Anzeige auf Deutsch', () => {
    assert.equal(formatQuantity(4, 'stk'), '4×');
    assert.equal(formatQuantity(1.5, 'kg'), '1,5 kg');
    assert.equal(formatQuantity(500, 'g'), '500 g');
    assert.equal(formatQuantity(2, 'pck'), '2 Pck.');
    assert.equal(formatQuantity(3, undefined), '3×', 'ohne Einheit = Stück');
    assert.equal(spokenQuantity(0.5, 'l'), '0,5 Liter');
  });

  test('Schritte und Grenzen je Einheit', () => {
    assert.equal(stepUp(1, 'kg'), 1.5);
    assert.equal(stepUp(500, 'g'), 600);
    assert.equal(stepDown(0.5, 'kg'), null, 'kleinste Menge erreicht');
    assert.equal(stepDown(1, 'stk'), null);
    assert.equal(stepDown(1.5, 'l'), 1);
    assert.equal(normalizeQuantity(1.26, 'kg'), 1.5);
    assert.equal(normalizeQuantity(0, 'g'), 100);
    assert.equal(normalizeQuantity(1e9, 'stk'), 99);
    assert.equal(normalizeQuantity('kaputt', 'kg'), 1);
  });

  test('Standard-Einheit eines Produkts gilt beim Hinzufügen', async () => {
    const { model, repository } = await makeModel();
    const apples = await productNamed(repository, 'Äpfel');
    await model.setProductUnit(apples, 'kg');
    assert.match(model.state.toast.text, /Äpfel: Einheit Kilogramm/);
    await model.add(apples.id);
    assert.equal(shown(model, 'Äpfel'), '1 kg');
    await model.add(apples.id);
    assert.equal(shown(model, 'Äpfel'), '1,5 kg', 'nochmal hinzufügen = eine Stufe mehr');
  });

  test('Plus/Minus in Schritten der Einheit, Minus an der Untergrenze entfernt', async () => {
    const { model, repository } = await makeModel();
    const mince = await productNamed(repository, 'Hackfleisch');
    await model.setProductUnit(mince, 'g');
    await model.add(mince.id);
    assert.equal(shown(model, 'Hackfleisch'), '500 g');
    await model.increment(item(model, 'Hackfleisch'));
    assert.equal(shown(model, 'Hackfleisch'), '600 g');
    await model.setQuantity(item(model, 'Hackfleisch'), 100);
    assert.equal(model.canDecrease(item(model, 'Hackfleisch')), false);
    await model.decrement(item(model, 'Hackfleisch'));
    assert.equal(item(model, 'Hackfleisch'), undefined);
  });

  test('Einheit eines Eintrags ändern, mit Rückgängig', async () => {
    const { model, repository } = await makeModel();
    await model.add((await productNamed(repository, 'Kartoffeln')).id);
    await model.setQuantity(item(model, 'Kartoffeln'), 6);
    await model.setEntryUnit(item(model, 'Kartoffeln'), 'kg');
    assert.equal(shown(model, 'Kartoffeln'), '1 kg');
    await model.undo();
    assert.equal(shown(model, 'Kartoffeln'), '6×');
  });

  test('„Zuletzt gekauft“ merkt sich Menge und Einheit', async () => {
    const { model, repository } = await makeModel();
    const apples = await productNamed(repository, 'Äpfel');
    await model.setProductUnit(apples, 'kg');
    await model.add(apples.id);
    await model.increment(item(model, 'Äpfel'));
    await model.toCart(item(model, 'Äpfel'));
    await model.finishShopping();
    assert.equal(model.purchasedProducts()[0].subtitle, '1,5 kg');
    await model.add(apples.id);
    assert.equal(shown(model, 'Äpfel'), '1,5 kg');
  });

  test('wechselt die Standard-Einheit, wird die alte Menge nicht übernommen', async () => {
    const { model, repository } = await makeModel();
    const apples = await productNamed(repository, 'Äpfel');
    await model.add(apples.id);
    await model.setQuantity(item(model, 'Äpfel'), 6);
    await model.toCart(item(model, 'Äpfel'));
    await model.finishShopping();                       // zuletzt: 6 Stück
    await model.setProductUnit(model.state.products.find((p) => p.id === apples.id), 'kg');
    await model.add(apples.id);
    assert.equal(shown(model, 'Äpfel'), '1 kg', 'nicht 6 kg');
  });

  test('Teilen und Sicherung behalten Einheiten', async () => {
    const { model, repository, store } = await makeModel();
    const milk = await productNamed(repository, 'Milch');
    await model.setProductUnit(milk, 'l');
    await model.add(milk.id);
    await model.decrement(item(model, 'Milch'));       // 1 l → 0,5 l
    const { text } = await model.shareList('https://example.test/');
    assert.ok(text.includes('• Milch 0,5 l'));
    const backup = parseBackup(JSON.stringify(await createBackup(store)));
    assert.equal(backup.data.entries[0].quantity, 0.5);
    assert.equal(backup.data.entries[0].unit, 'l');
    const [decoded] = await decodeShare(await encodeShare([{ name: 'Milch', quantity: 0.5, unit: 'l' }]));
    assert.deepEqual([decoded.quantity, decoded.unit], [0.5, 'l']);
  });

  test('geteilte Liste mit anderer Einheit: eigene Menge bleibt', async () => {
    const { model, repository } = await makeModel();
    await model.add((await productNamed(repository, 'Äpfel')).id);   // 1× (Stück)
    await model.receiveShared(`https://x.test/#liste=${await encodeShare([{ catalogId: 'aepfel', name: 'Äpfel', quantity: 2, unit: 'kg', note: '' }])}`);
    await model.acceptShared();
    assert.equal(shown(model, 'Äpfel'), '1×');
  });
});
