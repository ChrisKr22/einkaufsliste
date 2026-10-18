// Sicherung: Zugänge zu gemeinsamen Listen nur mit Passwort (Tresor), sonst nicht in der Datei.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAccessKey, parseBackup } from '../js/data/backup.js';
import { LISTS_KEY } from '../js/lists.js';
import { ListModel } from '../js/list-model.js';
import { JOIN_KEY, LEGACY_SESSION_KEY, sessionKey } from '../js/sync/shared-list.js';
import { makeStore, productNamed } from './helpers.js';

const ITERATIONS = 100_000;   // kleinste erlaubte Zahl – hält die Tests schnell
const LIST_ID = 'L'.repeat(22);
const SESSION = { listId: LIST_ID, listKey: 'K'.repeat(43), memberId: 'mitglied-1', memberSecret: 'S'.repeat(43), name: 'Zuhause' };

async function device({ shared = true } = {}) {
  const { store, repository } = await makeStore();
  const model = new ListModel(repository, { toastMs: 0 });
  await repository.add((await productNamed(repository, 'Milch')).id);
  if (shared) {
    await store.put('meta', { key: sessionKey(LIST_ID), value: SESSION });
    await store.put('meta', { key: LISTS_KEY, value: [{ id: 'default', name: 'Meine Liste', kind: 'private' }, { id: LIST_ID, name: 'Zuhause', kind: 'shared' }] });
  }
  await model.load();
  return { store, repository, model };
}

const metaKeys = async (store) => (await store.getAll('meta')).map((m) => m.key);

test('Zugangs-Schlüssel passen zu denen der Listen und des Beitritts', () => {
  assert.ok(isAccessKey(sessionKey(LIST_ID)));
  assert.ok(isAccessKey(JOIN_KEY));
  assert.ok(isAccessKey(LEGACY_SESSION_KEY));
  assert.ok(!isAccessKey(LISTS_KEY));
  assert.ok(!isAccessKey('lastBackupAt'));
});

test('Ohne gemeinsame Listen: kein Tresor, keine Frage nach dem Passwort', async () => {
  const { model } = await device({ shared: false });
  assert.equal(await model.backupAccessCount(), 0);
  const { json, sealed, dropped } = await model.prepareExport();
  assert.equal(JSON.parse(json).vault, undefined);
  assert.deepEqual([sealed, dropped], [0, 0]);
});

test('Ohne Passwort: Zugänge fehlen in der Datei – kein Schlüssel, kein Geheimnis', async () => {
  const { model } = await device();
  assert.equal(await model.backupAccessCount(), 1);
  const { json, sealed, dropped } = await model.prepareExport();
  assert.deepEqual([sealed, dropped], [0, 1]);
  assert.ok(!json.includes(SESSION.listKey) && !json.includes(SESSION.memberSecret));
  assert.equal(JSON.parse(json).vault, undefined);
});

test('Mit Passwort: Zugänge nur verschlüsselt in der Datei; zu kurzes Passwort abgewiesen', async () => {
  const { model } = await device();
  await assert.rejects(model.prepareExport({ password: 'kurz', iterations: ITERATIONS }), /mindestens 8 Zeichen/);
  const { json, sealed, summary } = await model.prepareExport({ password: 'richtig-gut', iterations: ITERATIONS });
  assert.equal(sealed, 1);
  assert.ok(!json.includes(SESSION.listKey) && !json.includes(SESSION.memberSecret) && !json.includes('richtig-gut'));
  const { vault } = JSON.parse(json);
  assert.equal(vault.kdf, 'PBKDF2-SHA256');
  assert.equal(vault.count, 1);
  assert.equal(summary.vault, true);
  assert.equal(model.previewImport(json).vaultCount, 1);
});

test('Einspielen mit richtigem Passwort: Zugang ist wieder da', async () => {
  const a = await device();
  const { json } = await a.model.prepareExport({ password: 'richtig-gut', iterations: ITERATIONS });
  const b = await device({ shared: false });
  await b.model.importBackup(json, { password: 'richtig-gut' });
  assert.deepEqual((await b.store.get('meta', sessionKey(LIST_ID))).value, SESSION);
  assert.ok((await b.store.get('meta', LISTS_KEY)).value.some((l) => l.id === LIST_ID));
});

test('Falsches Passwort: verständlicher Fehler, nichts wird geändert', async () => {
  const a = await device();
  const { json } = await a.model.prepareExport({ password: 'richtig-gut', iterations: ITERATIONS });
  const b = await device({ shared: false });
  await b.repository.add((await productNamed(b.repository, 'Brot')).id);
  await b.model.load();
  const before = await b.store.getAll('entries');
  await assert.rejects(b.model.importBackup(json, { password: 'falsch-falsch' }), /Passwort stimmt nicht/);
  assert.deepEqual(await b.store.getAll('entries'), before);
  assert.ok(!(await metaKeys(b.store)).includes(sessionKey(LIST_ID)));
});

test('Einspielen ohne Passwort: Daten kommen, Zugänge nicht; vorhandene Zugänge des Geräts bleiben', async () => {
  const a = await device();
  const { json } = await a.model.prepareExport({ password: 'richtig-gut', iterations: ITERATIONS });
  // Gerät B ist schon in einer anderen gemeinsamen Liste
  const { store, repository } = await makeStore();
  const otherId = 'O'.repeat(22);
  await store.put('meta', { key: sessionKey(otherId), value: { ...SESSION, listId: otherId, name: 'Arbeit' } });
  await store.put('meta', { key: LISTS_KEY, value: [{ id: 'default', name: 'Meine Liste', kind: 'private' }, { id: otherId, name: 'Arbeit', kind: 'shared' }] });
  const model = new ListModel(repository, { toastMs: 0 });
  await model.load();
  await model.importBackup(json);
  const keys = await metaKeys(store);
  assert.ok(!keys.includes(sessionKey(LIST_ID)), 'Zugang aus der Datei fehlt ohne Passwort');
  assert.ok(keys.includes(sessionKey(otherId)), 'eigener Zugang bleibt');
  assert.ok((await store.get('meta', LISTS_KEY)).value.some((l) => l.id === otherId), 'und bleibt in der Listenauswahl');
  assert.match(model.state.toast.text, /gemeinsame Listen ohne Passwort nicht übernommen/);
});

test('Ältere Sicherung mit Zugängen im Klartext lässt sich weiter einspielen', async () => {
  const a = await device();
  const old = await a.repository.exportBackup();   // Stand wie früher: Zugänge stehen in meta
  const b = await device({ shared: false });
  await b.model.importBackup(JSON.stringify(old));
  assert.deepEqual((await b.store.get('meta', sessionKey(LIST_ID))).value, SESSION);
});

test('Präparierter Tresor (Rechenaufwand, Format) wird abgewiesen', async () => {
  const a = await device();
  const { json } = await a.model.prepareExport({ password: 'richtig-gut', iterations: ITERATIONS });
  for (const change of [{ iterations: 1e9 }, { iterations: 10 }, { kdf: 'MD5' }, { salt: '<script>' }, { v: 2 }]) {
    const bad = JSON.parse(json);
    Object.assign(bad.vault, change);
    assert.throws(() => parseBackup(bad), /Zugänge/, JSON.stringify(change));
  }
});
