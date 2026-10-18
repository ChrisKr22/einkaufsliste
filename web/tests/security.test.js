// Fremde IDs (gemeinsame Liste, Sicherungsdatei) dürfen kein HTML einschleusen; die CSP bleibt streng.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createBackup, parseBackup } from '../js/data/backup.js';
import { isSafeId } from '../js/data/ids.js';
import { MAX_UNPACKED_BYTES, packJson, unpackJson } from '../js/data/share.js';
import { SYNC_URL } from '../js/sync/client.js';
import { formatStamp } from '../js/sync/clock.js';
import { Replica } from '../js/sync/replica.js';
import { SharedStore } from '../js/sync/shared-store.js';
import { stepper } from '../js/views/dom.js';
import { makeStore, productNamed } from './helpers.js';

const EVIL = 'x" autofocus onfocus="alert(1)';
const stamp = (n) => formatStamp(2_000_000 + n, 0, 'fremd');

test('IDs: alle Formate der App gelten als sicher, Anführungszeichen und Spitzklammern nicht', () => {
  for (const id of [crypto.randomUUID(), 'gehackte-tomaten', 'AbC_12-x', 'default', 'info']) assert.ok(isSafeId(id), id);
  for (const id of [EVIL, '<img>', 'a b', '', 'x'.repeat(65), 42, null]) assert.ok(!isSafeId(id), String(id));
});

test('Replica: Änderungen anderer Geräte mit unsicherer Art oder ID werden verworfen', () => {
  const replica = new Replica({ deviceId: 'hier', now: () => 1_000_000 });
  const changes = replica.receive([
    { s: stamp(1), k: 'entry', i: EVIL, f: { ref: 'c:milch', quantity: 1 } },
    { s: stamp(2), k: '<b>', i: 'ok', f: { name: 'x' } },
    { s: stamp(3), k: 'entry', i: 'gut', f: { ref: 'c:milch', quantity: 2 } },
  ]);
  assert.deepEqual(changes.map((c) => c.id), ['gut']);
  assert.equal(replica.get('entry', EVIL), null);
});

test('Replica: Gesamtstand mit unsicheren IDs bringt diese Datensätze nicht mit', () => {
  const replica = new Replica({ deviceId: 'hier', now: () => 1_000_000 });
  replica.receiveSnapshot({ v: 1, records: [['entry', EVIL, { ref: ['c:milch', stamp(1)] }], ['entry', 'gut', { ref: ['c:milch', stamp(2)] }]] });
  assert.deepEqual(replica.all('entry').map((e) => e.id), ['gut']);
});

test('Replica: eigene Änderung mit unsicherer ID wird abgewiesen', () => {
  const replica = new Replica({ deviceId: 'hier' });
  assert.throws(() => replica.set('entry', EVIL, { quantity: 1 }), /ungültige Änderung/);
});

test('Gemeinsame Liste: Eintrag mit präpariertem Produktverweis wird nicht angezeigt und legt kein Produkt an', async () => {
  const { store, repository } = await makeStore();
  const replica = new Replica({ deviceId: 'hier', now: () => 1_000_000 });
  replica.receive([
    { s: stamp(1), k: 'entry', i: 'boese', f: { ref: `s:${EVIL}`, name: 'Falle', quantity: 1 } },
    { s: stamp(2), k: 'entry', i: 'gut', f: { ref: 'c:milch', name: 'Milch', quantity: 1 } },
  ]);
  const before = (await store.getAll('products')).length;
  const shared = new SharedStore(store, replica);
  const entries = await shared.getAll('entries');
  assert.deepEqual(entries.map((e) => e.id), ['gut']);
  assert.equal(entries[0].productId, (await productNamed(repository, 'Milch')).id);
  assert.equal((await store.getAll('products')).length, before);
});

test('Sicherung: unsichere IDs machen die Datei ungültig', async () => {
  const { store, repository } = await makeStore();
  await repository.add((await productNamed(repository, 'Milch')).id);
  const backup = await createBackup(store);
  assert.doesNotThrow(() => parseBackup(structuredClone(backup)));

  const badEntry = structuredClone(backup);
  badEntry.data.entries[0].id = EVIL;
  assert.throws(() => parseBackup(badEntry), /Listeneintrag/);

  const badProduct = structuredClone(backup);
  const product = badProduct.data.products.find((p) => p.id === badProduct.data.entries[0].productId);
  product.id = EVIL;
  badProduct.data.entries[0].productId = EVIL;
  assert.throws(() => parseBackup(badProduct), /Produkt/);

  const badCategory = structuredClone(backup);
  badCategory.data.categories[0].id = EVIL;
  assert.throws(() => parseBackup(badCategory), /Kategorie/);
});

test('Ansichten: IDs werden maskiert', () => {
  const html = stepper({ id: EVIL, quantity: 1, unit: 'stk', product: { name: 'Milch' } });
  assert.ok(!html.includes(EVIL));
  assert.ok(html.includes('data-dec="x&quot; autofocus onfocus=&quot;alert(1)"'));
});

test('Ansichten: keine ID ohne esc() in einer HTML-Vorlage', () => {
  const dir = new URL('../js/views/', import.meta.url);
  const offenders = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    readFileSync(new URL(file, dir), 'utf8').split('\n').forEach((line, n) => {
      if (/selector:/.test(line)) return;   // CSS-Selektor zum Wiederfinden, kein HTML
      // Wert in einem HTML-Attribut (name="…${…id}…") ohne esc()
      if (/="[^"]*\$\{(?:[\w?.]*\.id|id)\}/.test(line)) offenders.push(`${file}:${n + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('CSP: streng, ohne Inline-Skripte, mit dem Briefkasten als einzigem fremden Ziel', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
  assert.ok(csp, 'CSP fehlt');
  const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives['script-src'], ["'self'"]);
  assert.deepEqual(directives['default-src'], ["'self'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['connect-src'], ["'self'", SYNC_URL]);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP muss vor dem ersten Skript stehen');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'Inline-Skript in index.html');
  assert.ok(!/\son[a-z]+="/.test(html), 'Inline-Event-Handler in index.html');
});

test('Entpacken: geteilte Links mit riesigem Inhalt werden abgewiesen, normale nicht', async () => {
  const small = await packJson({ v: 1, i: [{ n: 'Milch', q: 1 }] });
  assert.deepEqual(await unpackJson(small), { v: 1, i: [{ n: 'Milch', q: 1 }] });
  const bomb = await packJson({ x: 'a'.repeat(MAX_UNPACKED_BYTES + 10) });
  assert.ok(bomb.length < 20_000, 'stark komprimiert');
  await assert.rejects(unpackJson(bomb), /zu groß/);
});
