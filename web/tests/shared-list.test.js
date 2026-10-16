import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ListModel } from '../js/list-model.js';
import { JOIN_KEY, SESSION_KEY, SharedList } from '../js/sync/shared-list.js';
import { checkCode, inviteLink, newDeviceKeys, newInviteSecret, openForDevice, parseInvite, sealForDevice } from '../js/sync/join.js';
import { Mailbox } from '../../tools/sync/src/mailbox.js';
import { makeStore, productNamed } from './helpers.js';

// ---------------------------------------------------------------- Briefkasten im Speicher (echter Code, SQLite von Node)

function fakeCloud() {
  const boxes = new Map();
  const box = (listId) => {
    if (!boxes.has(listId)) {
      let db = new DatabaseSync(':memory:');
      boxes.set(listId, new Mailbox({
        sql: { exec: (q, ...p) => { const rows = db.prepare(q).all(...p); return { toArray: () => rows.map((r) => ({ ...r })) }; } },
        deleteAll: async () => { db = new DatabaseSync(':memory:'); },
        setAlarm: () => {},
      }));
    }
    return boxes.get(listId);
  };
  const fetch = async (url, init = {}) => {
    const listId = /\/v1\/lists\/([^/?]+)/.exec(url)?.[1];
    return box(listId).fetch(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
  };
  return { fetch, boxes };
}

async function device(cloud, { items = [] } = {}) {
  const { store, repository } = await makeStore();
  const model = new ListModel(repository, { toastMs: 0 });
  for (const name of items) await repository.add((await productNamed(repository, name)).id);
  await model.load();
  const shared = new SharedList(model, store, { fetch: cloud.fetch, timers: false, appUrl: () => 'https://app.example/' });
  await shared.init();
  return { store, repository, model, shared };
}

const names = (model) => model.state.items.map((i) => i.product.name).sort();

/** A legt an und lädt B ein; B tritt bei. */
async function pair(cloud, { aItems = ['Milch', 'Brot'], bItems = [] } = {}) {
  const a = await device(cloud, { items: aItems });
  await a.shared.create({ name: 'Zuhause', deviceName: 'Alex iPhone', adopt: true });
  const b = await device(cloud, { items: bItems });
  const { link } = await a.shared.invite();
  await a.shared.sync();
  assert.equal(b.shared.receiveInvite(link), true);
  await b.shared.sendJoin('Sams iPhone');
  await a.shared.sync();
  const [request] = a.shared.state.requests;
  assert.ok(request, 'A sieht die Anfrage');
  assert.equal(request.code, b.shared.state.join.code, 'beide sehen denselben Prüfcode');
  await a.shared.approve(request.rid);
  assert.equal(await b.shared.checkJoin(), true);
  return { a, b };
}

// ---------------------------------------------------------------- Beitritt: Bausteine

test('Einladung: Link hin und zurück, auch aus einer Nachricht heraus', () => {
  const secret = newInviteSecret();
  const link = inviteLink('https://chriskr22.github.io/einkaufsliste/', { listId: 'A'.repeat(22), secret, name: 'WG – Küche' });
  assert.deepEqual(parseInvite(`Komm rein:\n${link}\n\nGilt 30 Minuten`), { listId: 'A'.repeat(22), secret, name: 'WG – Küche' });
  assert.equal(parseInvite('https://x/#liste=zabc'), null);
  assert.equal(parseInvite(''), null);
});

test('Prüfcode: vierstellig, gleich für dasselbe Gerät, anders für ein fremdes', async () => {
  const secret = newInviteSecret();
  const mine = await newDeviceKeys();
  const other = await newDeviceKeys();
  const code = await checkCode(secret, mine.publicJwk);
  assert.match(code, /^\d{4}$/);
  assert.equal(code, await checkCode(secret, mine.publicJwk));
  // Fremder Schlüssel ergibt (fast immer) einen anderen Code; über 20 Versuche praktisch sicher
  const others = new Set(await Promise.all(Array.from({ length: 20 }, async () => checkCode(secret, (await newDeviceKeys()).publicJwk))));
  assert.ok(others.size > 1);
  assert.notEqual(await checkCode(newInviteSecret(), mine.publicJwk), undefined);
  assert.ok(other.publicJwk.x);
});

test('Listenschlüssel nur für das eine Gerät lesbar', async () => {
  const mine = await newDeviceKeys();
  const other = await newDeviceKeys();
  const sealed = await sealForDevice(mine.publicJwk, { listKey: 'geheim' });
  assert.deepEqual(await openForDevice(mine.privateJwk, sealed), { listKey: 'geheim' });
  await assert.rejects(openForDevice(other.privateJwk, sealed), /nicht lesbar/);
  await assert.rejects(sealForDevice({ kty: 'RSA' }, {}), /Geräteschlüssel/);
});

// ---------------------------------------------------------------- Ablauf mit zwei Geräten

test('Anlegen: die private Liste wandert in die gemeinsame', async () => {
  const cloud = fakeCloud();
  const a = await device(cloud, { items: ['Milch', 'Brot'] });
  await a.shared.create({ name: 'Zuhause', deviceName: 'Alex iPhone', adopt: true });
  assert.equal(a.shared.state.status, 'active');
  assert.equal(a.shared.state.name, 'Zuhause');
  assert.deepEqual(names(a.model), ['Brot', 'Milch']);
  assert.deepEqual(await a.store.getAll('entries'), [], 'privater Speicher ist leer');
  assert.ok((await a.store.get('meta', SESSION_KEY)).value.listKey);
});

test('Beitritt mit Bestätigung: B sieht danach die Liste von A', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  assert.equal(b.shared.state.status, 'active');
  assert.equal(b.shared.state.name, 'Zuhause');
  assert.deepEqual(names(b.model), ['Brot', 'Milch']);
  assert.equal(await b.store.get('meta', JOIN_KEY), undefined);
  await a.shared.sync();
  await a.shared.sync();
  await a.shared.sync();
  assert.equal(a.shared.state.memberCount, 2);
  assert.deepEqual(a.shared.state.members.map((m) => m.name).sort(), ['Alex iPhone', 'Sams iPhone']);
});

test('Änderungen kommen beim anderen an – auch eigene Produkte', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  await b.model.add((await productNamed(b.repository, 'Eier')).id);
  b.model.setQuery('Hafermilch Barista');
  await b.model.createProductFromQuery();
  await b.shared.sync();
  await a.shared.sync();
  assert.deepEqual(names(a.model), ['Brot', 'Eier', 'Hafermilch Barista', 'Milch']);
  const custom = a.model.state.items.find((i) => i.product.name === 'Hafermilch Barista');
  assert.equal(custom.product.isCustom, true);
});

test('Gleichzeitig: A ändert die Menge, B die Anmerkung – beides bleibt', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  const milkA = a.model.state.items.find((i) => i.product.name === 'Milch');
  const milkB = b.model.state.items.find((i) => i.product.name === 'Milch');
  await a.model.setQuantity(milkA, 3);
  await b.model.setNote(milkB, 'laktosefrei');
  await a.shared.sync();
  await b.shared.sync();
  await a.shared.sync();
  for (const d of [a, b]) {
    const milk = d.model.state.items.find((i) => i.product.name === 'Milch');
    assert.equal(milk.quantity, 3);
    assert.equal(milk.note, 'laktosefrei');
  }
});

test('Einkauf abschließen gilt für alle; „Zuletzt gekauft“ zählt auch beim anderen', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  const milk = b.model.state.items.find((i) => i.product.name === 'Milch');
  await b.model.toCart(milk);
  await b.shared.sync();
  await a.shared.sync();
  assert.equal(a.model.state.items.find((i) => i.product.name === 'Milch').status, 'inCart');
  await a.model.finishShopping();
  await a.shared.sync();
  await b.shared.sync();
  assert.deepEqual(names(b.model), ['Brot']);
  assert.equal((await productNamed(b.repository, 'Milch')).purchaseCount, 1);
  assert.equal((await productNamed(a.repository, 'Milch')).purchaseCount, 1);
});

test('Verlassen: die private Liste ist wieder da; das letzte Gerät löscht den Briefkasten', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud, { bItems: ['Reis'] });
  assert.deepEqual(names(b.model), ['Brot', 'Milch'], 'private Liste von B ist ausgeblendet');
  await b.shared.leave();
  assert.equal(b.shared.state.status, 'none');
  assert.deepEqual(names(b.model), ['Reis'], 'und nach dem Verlassen wieder da');
  await a.shared.sync();
  await a.shared.sync();
  await a.shared.sync();
  assert.equal(a.shared.state.memberCount, 1);
  const listId = a.shared.session.listId;
  await a.shared.leave();
  assert.equal(a.shared.state.status, 'none');
  const probe = await cloud.fetch(`https://x/v1/lists/${listId}/ops`, { method: 'GET', headers: {} });
  assert.equal(probe.status, 404, 'Briefkasten gelöscht');
});

test('Abgelehnt: das neue Gerät erfährt es und kann es neu versuchen', async () => {
  const cloud = fakeCloud();
  const a = await device(cloud, { items: ['Milch'] });
  await a.shared.create({ name: 'Zuhause', deviceName: 'A', adopt: true });
  const { link } = await a.shared.invite();
  await a.shared.sync();
  const b = await device(cloud);
  b.shared.receiveInvite(link);
  await b.shared.sendJoin('B');
  await a.shared.sync();
  await a.shared.reject(a.shared.state.requests[0].rid);
  assert.equal(await b.shared.checkJoin(), false);
  assert.equal(b.shared.state.join.phase, 'failed');
  assert.match(b.shared.state.join.message, /abgelehnt oder ist abgelaufen/);
  assert.equal(b.shared.state.status, 'none');
});

test('Noch nicht bestätigt: Warten übersteht einen Neustart der App', async () => {
  const cloud = fakeCloud();
  const a = await device(cloud, { items: ['Milch'] });
  await a.shared.create({ name: 'Zuhause', deviceName: 'A', adopt: true });
  const { link } = await a.shared.invite();
  await a.shared.sync();
  const b = await device(cloud);
  b.shared.receiveInvite(link);
  await b.shared.sendJoin('B');
  assert.equal(await b.shared.checkJoin(), false);
  // Neustart: neue Steuerung auf demselben Speicher
  const restarted = new SharedList(b.model, b.store, { fetch: cloud.fetch, timers: false });
  await restarted.init();
  assert.equal(restarted.state.join.phase, 'waiting');
  await a.shared.sync();
  await a.shared.approve(a.shared.state.requests[0].rid);
  assert.equal(await restarted.checkJoin(), true);
  assert.deepEqual(names(b.model), ['Milch']);
});

test('Volle Liste: das sechste Gerät bekommt eine verständliche Meldung', async () => {
  const cloud = fakeCloud();
  const a = await device(cloud, { items: ['Milch'] });
  await a.shared.create({ name: 'WG', deviceName: 'A', adopt: true });
  for (let i = 0; i < 5; i++) {
    const { link } = await a.shared.invite();
    await a.shared.sync();
    const d = await device(cloud);
    d.shared.receiveInvite(link);
    await d.shared.sendJoin(`Gerät ${i}`);
    if (i === 4) {
      assert.equal(d.shared.state.join.phase, 'failed');
      assert.match(d.shared.state.join.message, /voll/);
      break;
    }
    await a.shared.sync();
    const request = a.shared.state.requests.find((r) => r.device === `Gerät ${i}`);
    await a.shared.approve(request.rid);
  }
});

test('Schon in einer Liste: Einladung wird nicht still übernommen', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  const { link } = await a.shared.invite();
  assert.equal(b.shared.receiveInvite(link), true);
  assert.equal(b.shared.state.join.phase, 'failed');
  assert.equal(b.shared.receiveInvite('kein Link'), false);
});

test('Neustart mit aktiver Liste: Stand und Abgleich gehen weiter', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  const restarted = new SharedList(b.model, b.store, { fetch: cloud.fetch, timers: false });
  b.model.repository.store = b.store;   // wie beim Start der App
  await restarted.init();
  assert.equal(restarted.state.status, 'active');
  assert.deepEqual(names(b.model), ['Brot', 'Milch']);
  await a.model.add((await productNamed(a.repository, 'Reis')).id);
  await a.shared.sync();
  await restarted.sync();
  assert.deepEqual(names(b.model), ['Brot', 'Milch', 'Reis']);
});

test('Kein Zugang mehr (entfernt): Zustand „lost“, Verlassen räumt trotzdem auf', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud, { bItems: ['Reis'] });
  await a.shared.connection.leave(b.shared.session.memberId);   // B von A aus entfernen
  await b.shared.sync();
  assert.equal(b.shared.state.status, 'lost');
  await b.shared.leave();
  assert.equal(b.shared.state.status, 'none');
  assert.deepEqual(names(b.model), ['Reis']);
});
