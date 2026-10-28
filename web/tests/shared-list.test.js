import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mock, test } from 'node:test';
import { ListModel } from '../js/list-model.js';
import { JOIN_KEY, PUSH_DELAY_MS, sessionKey, SharedList, SYNC_MS } from '../js/sync/shared-list.js';
import { ListsManager } from '../js/lists.js';
import { checkCode, inviteLink, newDeviceKeys, newInviteSecret, openForDevice, parseInvite, sealForDevice } from '../js/sync/join.js';
import { Mailbox } from '../../tools/sync/src/mailbox.js';
import { ListConnection } from '../js/sync/client.js';
import { catalog, makeStore, productNamed } from './helpers.js';
import { importCatalog } from '../js/data/catalog-import.js';

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
  const lists = new ListsManager(model, store, shared);
  await lists.init();
  return { store, repository, model, shared, lists };
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
  assert.ok((await a.store.get('meta', sessionKey(a.shared.session.listId))).value.listKey);
  assert.deepEqual(a.lists.state.lists.map((l) => [l.name, l.kind]), [['Meine Liste', 'private'], ['Zuhause', 'shared']]);
  assert.equal(a.lists.active.name, 'Zuhause');
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

test('Katalog-Update: eigenes Produkt auf der gemeinsamen Liste wird Katalogprodukt und bleibt es', async () => {
  const cloud = fakeCloud();
  const { a } = await pair(cloud);
  // Vor dem Update gab es Aperol nicht im Katalog: als eigenes Produkt (Sonstiges) auf die Liste
  const product = (await a.repository.products()).find((p) => p.catalogId === 'aperol');
  await a.store.delete('products', product.id);
  a.model.setQuery('Aperol');
  await a.model.createProductFromQuery();
  await a.shared.sync();
  // Neuer Katalog bringt Aperol mit; der Import läuft auf dem Gerätespeicher
  await a.store.put('meta', { key: 'catalogVersion', value: catalog.version - 1 });
  await importCatalog(catalog, a.store);
  await a.model.load();
  const item = a.model.state.items.find((i) => i.product.name === 'Aperol');
  assert.equal(item.product.catalogId, 'aperol');
  const all = (await a.store.getAll('products')).filter((p) => p.name === 'Aperol');
  assert.equal(all.length, 1, 'kein Doppel');
  assert.equal(all[0].catalogId, 'aperol');
});

test('Eigenes Produkt vom anderen Gerät, hier schon im Katalog: wird mit dem Katalogprodukt verknüpft', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  // B kennt Aperol noch nicht aus dem Katalog und legt es selbst an
  const aperolB = (await b.repository.products()).find((p) => p.catalogId === 'aperol');
  await b.store.delete('products', aperolB.id);
  b.model.setQuery('Aperol');
  await b.model.createProductFromQuery();
  await b.shared.sync();
  await a.shared.sync();
  const item = a.model.state.items.find((i) => i.product.name === 'Aperol');
  assert.equal(item.product.catalogId, 'aperol');
  assert.equal((await a.store.getAll('products')).filter((p) => p.name === 'Aperol').length, 1, 'kein Doppel');
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
  await new ListsManager(b.model, b.store, restarted).init();
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

test('Schon in dieser Liste: Einladung wird nicht still übernommen', async () => {
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
  await new ListsManager(b.model, b.store, restarted).init();
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

test('Einladung in Safari geöffnet: erst „in der App beitreten“ anbieten, auf Wunsch hier', async () => {
  const cloud = fakeCloud();
  const a = await device(cloud, { items: ['Milch'] });
  await a.shared.create({ name: 'Zuhause', deviceName: 'A', adopt: true });
  const { link } = await a.shared.invite();
  const b = await device(cloud);
  assert.equal(b.shared.receiveInvite(link, { elsewhere: true }), true);
  assert.equal(b.shared.state.join.phase, 'elsewhere');
  assert.equal(parseInvite(b.shared.state.join.link).listId, a.shared.session.listId, 'kopierbarer Link enthält die Einladung');
  b.shared.joinHere();
  assert.equal(b.shared.state.join.phase, 'form');
  await b.shared.sendJoin('B');
  assert.equal(b.shared.state.join.phase, 'waiting');
});

test('Admin: wer anlegt, ist Admin und kann andere entfernen; andere nicht', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud, { bItems: ['Reis'] });
  await a.shared.sync();
  await b.shared.sync();
  assert.equal(a.shared.state.isAdmin, true);
  assert.equal(b.shared.state.isAdmin, false);
  const adminRow = b.shared.state.members.find((m) => m.admin);
  assert.equal(adminRow.name, 'Alex iPhone', 'B sieht, wer Admin ist');
  // B versucht, A zu entfernen – der Briefkasten lehnt ab
  await assert.rejects(b.shared.removeMember(a.shared.session.memberId), /Listen-Admin/);
  // A entfernt B
  await a.shared.removeMember(b.shared.session.memberId);
  assert.deepEqual(a.shared.state.members.map((m) => m.name), ['Alex iPhone']);
  assert.equal(a.shared.state.memberCount, 1);
  await b.shared.sync();
  assert.equal(b.shared.state.status, 'lost');
  assert.match(b.shared.state.error, /entfernt/);
  await b.shared.leave();
  assert.deepEqual(names(b.model), ['Reis'], 'B hat seine eigene Liste zurück');
});

test('Admin verlässt die Liste: das nächste Gerät wird Admin', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  await a.shared.leave();
  await b.shared.sync();
  await b.shared.sync();
  await b.shared.sync();
  assert.equal(b.shared.state.isAdmin, true);
  assert.equal(b.shared.state.memberCount, 1);
});

// ---------------------------------------------------------------- Mitglieds-Geheimnis

const membersOf = (cloud, listId) => cloud.boxes.get(listId).storage.sql.exec('SELECT mid, secret FROM members').toArray();

test('Geheimnis: jedes Gerät hat ein eigenes, der Briefkasten kennt nur den Prüfwert', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  const sa = a.shared.session.memberSecret;
  const sb = b.shared.session.memberSecret;
  assert.ok(sa && sb && sa !== sb);
  assert.equal((await b.store.get('meta', sessionKey(b.shared.session.listId))).value.memberSecret, sb, 'auf dem Gerät gespeichert');
  const rows = membersOf(cloud, a.shared.session.listId);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.ok(row.secret && row.secret !== sa && row.secret !== sb);
});

test('Geheimnis: entferntes Gerät kommt auch mit der ID des Admins nicht mehr an die Liste', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  const { listId, listKey, memberSecret } = b.shared.session;
  await a.shared.removeMember(b.shared.session.memberId);
  const impostor = new ListConnection({ listId, listKey, memberId: a.shared.session.memberId, memberSecret, fetch: cloud.fetch });
  await assert.rejects(impostor.pull(0), (error) => error.status === 401);
  await assert.rejects(impostor.push([{ s: 'x', k: 'entry', i: 'x', f: {} }]), (error) => error.status === 401);
});

test('Übergang: Liste von vor den Geheimnissen – das Gerät erzeugt eins, speichert es und gleicht weiter ab', async () => {
  const cloud = fakeCloud();
  const { a, b } = await pair(cloud, { aItems: ['Milch'] });
  const { listId } = a.shared.session;
  // Stand wie vor dem Update: kein Geheimnis auf dem Gerät, keins beim Briefkasten
  cloud.boxes.get(listId).storage.sql.exec('UPDATE members SET secret = NULL');
  for (const d of [a, b]) {
    const { memberSecret, ...old } = (await d.store.get('meta', sessionKey(listId))).value;
    await d.store.put('meta', { key: sessionKey(listId), value: old });
  }
  const restarted = new SharedList(b.model, b.store, { fetch: cloud.fetch, timers: false });
  b.model.repository.store = b.store;
  await new ListsManager(b.model, b.store, restarted).init();
  await restarted.sync();
  assert.equal(restarted.state.status, 'active');
  assert.equal(restarted.state.error, null);
  const saved = (await b.store.get('meta', sessionKey(listId))).value.memberSecret;
  assert.ok(saved, 'Geheimnis gespeichert');
  const row = membersOf(cloud, listId).find((r) => r.mid === restarted.session.memberId);
  assert.ok(row.secret, 'Briefkasten hat es übernommen');
  // Ein anderes Geheimnis für denselben Platz gilt danach nicht mehr
  const other = new ListConnection({ ...restarted.session, memberSecret: 'x'.repeat(43), fetch: cloud.fetch });
  await assert.rejects(other.pull(0), (error) => error.status === 401);
  assert.deepEqual(names(b.model), ['Milch']);
});

// ---------------------------------------------------------------- Takt des Abgleichs

test('Abruf: immer dieselbe Adresse, Startnummer in der Kopfzeile – so fragt der Browser nicht jedes Mal vorab', async () => {
  const cloud = fakeCloud();
  const { a } = await pair(cloud);
  const seen = [];
  a.shared.connection.fetchFn = (url, init) => { seen.push([init.method, url, init.headers['X-After']]); return cloud.fetch(url, init); };
  await a.model.add((await productNamed(a.repository, 'Reis')).id);
  await a.shared.sync();
  const reads = seen.filter(([method, url]) => method === 'GET' && url.includes('/ops'));
  assert.ok(reads.length > 0);
  for (const [, url, after] of reads) {
    assert.ok(url.endsWith(`/v1/lists/${a.shared.session.listId}/ops`), url);
    assert.match(after, /^\d+$/);
  }
});

test('Zeitgeber: eigene Änderung nach 0,4 s eingeworfen, Abgleich alle 2 s – beim anderen Gerät in gut 2 s sichtbar', async (t) => {
  globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };
  globalThis.window = { addEventListener: () => {} };
  t.after(() => { delete globalThis.document; delete globalThis.window; });
  assert.equal(PUSH_DELAY_MS, 400);
  assert.equal(SYNC_MS, 2_000);

  const cloud = fakeCloud();
  const { a, b } = await pair(cloud);
  const posts = [];
  const watch = (shared, name) => {
    const inner = shared.connection.fetchFn;
    shared.connection.fetchFn = (url, init) => { if (init.method === 'POST' && url.endsWith('/ops')) posts.push(name); return inner(url, init); };
  };
  // Beide mit echten Zeitgebern neu starten (wie beim Öffnen der App)
  const restart = async (d) => {
    const shared = new SharedList(d.model, d.store, { fetch: cloud.fetch, appUrl: () => 'https://app.example/' });
    d.model.repository.store = d.store;
    await new ListsManager(d.model, d.store, shared).init();
    return shared;
  };
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.after(() => mock.timers.reset());
  const sa = await restart(a);
  const sb = await restart(b);
  await settle(sa, sb);
  watch(sa, 'A');

  await a.model.add((await productNamed(a.repository, 'Reis')).id);
  mock.timers.tick(PUSH_DELAY_MS - 1);
  await settle(sa, sb);
  assert.deepEqual(posts, [], 'noch nicht eingeworfen');
  mock.timers.tick(1);
  await settle(sa, sb);
  assert.deepEqual(posts, ['A'], 'nach 0,4 s eingeworfen');

  assert.ok(!names(b.model).includes('Reis'));
  mock.timers.tick(SYNC_MS);
  await settle(sa, sb);
  assert.ok(names(b.model).includes('Reis'), 'B hat es nach dem nächsten Takt');
});

/** Laufende Abgleiche (auch angestoßene) zu Ende kommen lassen. */
async function settle(...lists) {
  for (let round = 0; round < 20; round++) {
    await new Promise((resolve) => setImmediate(resolve));
    for (const s of lists) if (s.syncing) await s.syncing;
  }
}
