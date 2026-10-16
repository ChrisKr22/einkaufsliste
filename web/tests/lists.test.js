import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ListModel } from '../js/list-model.js';
import { ACTIVE_KEY, LISTS_KEY, ListsManager } from '../js/lists.js';
import { LEGACY_SESSION_KEY, SharedList, sessionKey } from '../js/sync/shared-list.js';
import { Mailbox } from '../../tools/sync/src/mailbox.js';
import { makeStore, productNamed } from './helpers.js';

function fakeCloud() {
  const boxes = new Map();
  const box = (listId) => {
    if (!boxes.has(listId)) {
      let db = new DatabaseSync(':memory:');
      boxes.set(listId, new Mailbox({
        sql: { exec: (q, ...p) => { const rows = db.prepare(q).all(...p); return { toArray: () => rows.map((r) => ({ ...r })) }; } },
        deleteAll: async () => { db = new DatabaseSync(':memory:'); }, setAlarm: () => {},
      }));
    }
    return boxes.get(listId);
  };
  return async (url, init = {}) => box(/\/v1\/lists\/([^/?]+)/.exec(url)[1]).fetch(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
}
const offline = async () => { throw new TypeError('offline'); };

async function device({ fetch = offline, items = [], before } = {}) {
  const { store, repository } = await makeStore();
  for (const name of items) await repository.add((await productNamed(repository, name)).id);
  await before?.(store);
  const model = new ListModel(repository, { toastMs: 0 });
  const shared = new SharedList(model, store, { fetch, timers: false, appUrl: () => 'https://app.example/' });
  const lists = new ListsManager(model, store, shared);
  await lists.init();
  return { store, repository, model, shared, lists };
}
const names = (d) => d.model.state.items.map((i) => i.product.name).sort();
const add = async (d, name) => d.model.add((await productNamed(d.repository, name)).id);

test('Erster Start: bisherige Einträge gehören zu „Meine Liste“', async () => {
  const d = await device({ items: ['Milch', 'Brot'] });
  assert.deepEqual(d.lists.state.lists, [{ id: 'default', name: 'Meine Liste', kind: 'private' }]);
  assert.equal(d.lists.active.name, 'Meine Liste');
  assert.deepEqual(names(d), ['Brot', 'Milch']);
  assert.deepEqual((await d.store.get('meta', LISTS_KEY)).value.map((l) => l.name), ['Meine Liste']);
});

test('Private Listen: getrennte Einträge, Wechsel hin und zurück', async () => {
  const d = await device({ items: ['Milch'] });
  await d.lists.createPrivate('Baumarkt');
  assert.equal(d.lists.active.name, 'Baumarkt');
  assert.deepEqual(names(d), [], 'neue Liste ist leer');
  await add(d, 'Alufolie');
  await d.lists.switchTo('default');
  assert.deepEqual(names(d), ['Milch']);
  await d.lists.switchTo(d.lists.state.lists[1].id);
  assert.deepEqual(names(d), ['Alufolie']);
  const tagged = (await d.store.getAll('entries')).map((e) => e.listId ?? 'default').sort();
  assert.equal(new Set(tagged).size, 2, 'Einträge tragen ihre Liste');
  assert.equal((await d.store.get('meta', ACTIVE_KEY)).value, d.lists.active.id, 'geöffnete Liste wird gemerkt');
});

test('Private Listen: umbenennen, löschen samt Einträgen, die letzte bleibt', async () => {
  const d = await device({ items: ['Milch'] });
  const baumarkt = await d.lists.createPrivate('  Baumarkt   Samstag ');
  assert.equal(baumarkt.name, 'Baumarkt Samstag');
  await add(d, 'Alufolie');
  await d.lists.rename(baumarkt.id, 'Baumarkt');
  assert.equal(d.lists.active.name, 'Baumarkt');
  await d.lists.deletePrivate(baumarkt.id);
  assert.deepEqual(d.lists.state.lists.map((l) => l.name), ['Meine Liste']);
  assert.deepEqual(names(d), ['Milch'], 'zurück in „Meine Liste“');
  assert.equal((await d.store.getAll('entries')).length, 1, 'Einträge der gelöschten Liste sind weg');
  await d.lists.deletePrivate('default');
  assert.equal(d.lists.state.lists.length, 1, 'die letzte Liste lässt sich nicht löschen');
});

test('Erledigen in einer Liste lässt die andere unberührt (Einkauf abschließen)', async () => {
  const d = await device({ items: ['Milch'] });
  await d.lists.createPrivate('Drogerie');
  await add(d, 'Zahnpasta');
  await d.model.toCart(d.model.state.items[0]);
  await d.model.finishShopping();
  assert.deepEqual(names(d), []);
  await d.lists.switchTo('default');
  assert.deepEqual(names(d), ['Milch']);
});

test('Sicherung: enthält alle Listen; Einspielen stellt sie wieder her', async () => {
  const d = await device({ items: ['Milch'] });
  await d.lists.createPrivate('Drogerie');
  await add(d, 'Zahnpasta');
  const backup = await d.repository.exportBackup();
  assert.equal(backup.data.entries.length, 2, 'beide Listen in der Sicherung');
  const e = await device();
  await e.model.importBackup(JSON.stringify(backup));
  assert.deepEqual(e.lists.state.lists.map((l) => l.name), ['Meine Liste', 'Drogerie']);
  assert.equal(e.lists.active.name, 'Drogerie');
  assert.deepEqual(names(e), ['Zahnpasta']);
  await e.lists.switchTo('default');
  assert.deepEqual(names(e), ['Milch']);
});

test('Ältere Version mit einer gemeinsamen Liste: wird übernommen und geöffnet', async () => {
  const d = await device({
    before: (store) => store.put('meta', { key: LEGACY_SESSION_KEY, value: {
      listId: 'L'.repeat(22), listKey: 'K'.repeat(43), memberId: 'm', deviceId: 'dev1', name: 'Zuhause', seen: 0, replica: null,
    } }),
  });
  assert.deepEqual(d.lists.state.lists.map((l) => [l.name, l.kind]), [['Meine Liste', 'private'], ['Zuhause', 'shared']]);
  assert.equal(d.lists.active.name, 'Zuhause');
  assert.equal(d.shared.state.status, 'active');
  assert.equal(await d.store.get('meta', LEGACY_SESSION_KEY), undefined);
  assert.ok(await d.store.get('meta', sessionKey('L'.repeat(22))));
});

test('Ein Gerät in zwei gemeinsamen Listen und einer privaten – Wechsel zeigt jeweils die richtige', async () => {
  const fetch = fakeCloud();
  const a1 = await device({ fetch, items: ['Milch'] });
  await a1.lists.createShared({ name: 'Zuhause', deviceName: 'A1', adopt: true });
  const a2 = await device({ fetch, items: ['Bier'] });
  await a2.lists.createShared({ name: 'WG', deviceName: 'A2', adopt: true });
  const b = await device({ fetch, items: ['Reis'] });

  for (const a of [a1, a2]) {
    const { link } = await a.shared.invite();
    await a.shared.sync();
    b.shared.receiveInvite(link);
    await b.shared.sendJoin('B');
    await a.shared.sync();
    await a.shared.approve(a.shared.state.requests[0].rid);
    assert.equal(await b.shared.checkJoin(), true);
  }
  assert.deepEqual(b.lists.state.lists.map((l) => l.name), ['Meine Liste', 'Zuhause', 'WG']);
  assert.equal(b.lists.active.name, 'WG');
  assert.deepEqual(names(b), ['Bier']);
  const zuhause = b.lists.state.lists.find((l) => l.name === 'Zuhause');
  await b.lists.switchTo(zuhause.id);
  assert.deepEqual(names(b), ['Milch']);
  await add(b, 'Eier');
  await b.lists.switchTo('default');   // Wechsel wirft Eigenes vorher noch ein
  assert.deepEqual(names(b), ['Reis']);
  await a1.shared.sync();
  assert.deepEqual(names(a1), ['Eier', 'Milch']);
  // Verlassen einer der beiden: die andere bleibt
  await b.lists.switchTo(zuhause.id);
  await b.shared.leave();
  assert.deepEqual(b.lists.state.lists.map((l) => l.name), ['Meine Liste', 'WG']);
  assert.equal(b.lists.active.name, 'Meine Liste');
});
