import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decodeShare, encodeShare, extractShareCode, shareUrl } from '../js/data/share.js';
import { ListModel } from '../js/list-model.js';
import { makeStore, productNamed } from './helpers.js';

const BASE = 'https://beispiel.github.io/feedyourself/';

async function makeModel() {
  const { repository } = await makeStore();
  const model = new ListModel(repository, { toastMs: 50 });
  await model.load();
  return { model, repository };
}

async function plan(model, repository, entries) {
  for (const [name, quantity = 1, note = ''] of entries) {
    await model.add((await productNamed(repository, name)).id);
    const item = model.state.items.find((i) => i.product.name === name);
    if (quantity !== item.quantity) await model.setQuantity(item, quantity);
    if (note) await model.setNote(model.state.items.find((i) => i.product.name === name), note);
  }
}

const listed = (model) => model.plannedItems.map((i) => `${i.product.name} ${i.quantity}× ${i.note}`.trim()).sort();

describe('Liste teilen', () => {
  test('Kodieren und Dekodieren, auch mit Umlauten und Sonderzeichen', async () => {
    const items = [
      { catalogId: 'aepfel', name: 'Äpfel', categoryKey: 'obst', quantity: 1.5, unit: 'kg', note: 'Elstar – „bio“ & süß' },
      { catalogId: null, name: 'Kokosmilch light', categoryKey: 'sonst', quantity: 1, unit: 'stk', note: '' },
    ];
    const code = await encodeShare(items);
    assert.match(code, /^[zj][A-Za-z0-9_-]+$/, 'nur URL-sichere Zeichen');
    assert.deepEqual(await decodeShare(code), items);
  });

  test('Link für eine typische Liste bleibt kurz', async () => {
    const { model, repository } = await makeModel();
    const names = ['Äpfel', 'Bananen', 'Tomaten', 'Gurke', 'Brot', 'Milch', 'Butter', 'Eier', 'Gouda', 'Spaghetti',
      'Reis', 'Olivenöl', 'Salz', 'Wasser', 'Kaffee', 'Toilettenpapier', 'Spülmittel', 'Joghurt', 'Hackfleisch', 'Zwiebeln'];
    await plan(model, repository, names.map((n) => [n]));
    const { url, count } = await model.shareList(BASE);
    assert.equal(count, 20);
    assert.ok(url.length < 1200, `Link ist ${url.length} Zeichen lang`);
  });

  test('Nachricht: lesbar nach Kategorien, mit Link', async () => {
    const { model, repository } = await makeModel();
    await plan(model, repository, [['Äpfel', 2, 'Elstar'], ['Milch']]);
    const { text, url } = await model.shareList(BASE);
    assert.ok(url.startsWith(`${BASE}#liste=`));
    assert.equal(text.split('\n')[0], 'Einkaufsliste (2 Produkte)');
    assert.ok(text.includes('Obst\n• Äpfel 2× – Elstar'));
    assert.ok(text.includes('Milchprodukte & Eier\n• Milch 1×'));
    assert.ok(text.endsWith(url));
  });

  test('ohne Einträge gibt es nichts zu teilen', async () => {
    const { model } = await makeModel();
    assert.equal(await model.shareList(BASE), null);
  });

  test('Code wird in Link oder ganzer Nachricht gefunden', () => {
    assert.equal(extractShareCode(shareUrl(BASE, 'zAbC-_1')), 'zAbC-_1');
    assert.equal(extractShareCode(`Einkaufsliste\n• Milch\n\nIn FeedYourself übernehmen:\n${BASE}#liste=jXyZ`), 'jXyZ');
    assert.equal(extractShareCode('nur Text ohne Link'), null);
  });

  test('kaputter Link: verständlicher Fehler', async () => {
    await assert.rejects(decodeShare('zkaputt'), /keine gültige Einkaufsliste/);
    await assert.rejects(decodeShare('x123'), /keine gültige Einkaufsliste/);
    const { model } = await makeModel();
    await assert.rejects(model.receiveShared('Hallo'), /kein FeedYourself-Link/);
  });
});

describe('Geteilte Liste übernehmen', () => {
  async function sharedFrom(entries) {
    const sender = await makeModel();
    await plan(sender.model, sender.repository, entries);
    return (await sender.model.shareList(BASE)).text;
  }

  test('Empfänger sieht die Liste und übernimmt sie mit einem Tipp', async () => {
    const message = await sharedFrom([['Äpfel', 2, 'Elstar'], ['Milch']]);
    const { model } = await makeModel();
    const items = await model.receiveShared(message);
    assert.equal(items.length, 2);
    assert.equal(model.state.incomingShare.items.length, 2);
    await model.acceptShared();
    assert.equal(model.state.incomingShare, null);
    assert.deepEqual(listed(model), ['Milch 1×', 'Äpfel 2× Elstar']);
    assert.match(model.state.toast.text, /2 Produkte aus der geteilten Liste übernommen/);
  });

  test('Zusammenführen: größere Menge gewinnt, Anmerkungen werden ergänzt, nichts verdoppelt', async () => {
    const message = await sharedFrom([['Äpfel', 3, 'Elstar'], ['Brot', 1, 'Dinkel']]);
    const { model, repository } = await makeModel();
    await plan(model, repository, [['Äpfel', 1, 'Boskop'], ['Brot', 2, 'Dinkel'], ['Salz']]);
    await model.receiveShared(message);
    await model.acceptShared();
    assert.deepEqual(listed(model), ['Brot 2× Dinkel', 'Salz 1×', 'Äpfel 3× Boskop / Elstar']);
  });

  test('eigene Produkte des Absenders werden beim Empfänger angelegt', async () => {
    const sender = await makeModel();
    await sender.model.receiveShared(shareUrl(BASE, await encodeShare([
      { catalogId: null, name: 'Drachenfrucht', categoryKey: 'obst', quantity: 2, note: '' },
      { catalogId: null, name: 'Grillanzünder', categoryKey: 'eigene-abc', quantity: 1, note: '' },
    ])));
    await sender.model.acceptShared();
    const fruit = sender.model.plannedItems.find((i) => i.product.name === 'Drachenfrucht');
    const lighter = sender.model.plannedItems.find((i) => i.product.name === 'Grillanzünder');
    assert.equal(sender.model.categoryFor(fruit.product).key, 'obst');
    assert.equal(sender.model.categoryFor(lighter.product).key, 'sonst', 'unbekannte Kategorie → Sonstiges');
    assert.equal(fruit.product.isCustom, true);
  });

  test('Rückgängig stellt den vorherigen Stand wieder her', async () => {
    const message = await sharedFrom([['Äpfel', 3], ['Brot']]);
    const { model, repository } = await makeModel();
    await plan(model, repository, [['Äpfel', 1]]);
    await model.receiveShared(message);
    await model.acceptShared();
    await model.undo();
    assert.deepEqual(listed(model), ['Äpfel 1×']);
  });

  test('„Nicht jetzt“ übernimmt nichts', async () => {
    const message = await sharedFrom([['Milch']]);
    const { model } = await makeModel();
    await model.receiveShared(message);
    model.dismissShared();
    await model.acceptShared();
    assert.deepEqual(model.plannedItems, []);
  });
});
