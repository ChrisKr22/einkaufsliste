import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClock, formatStamp, parseStamp } from '../js/sync/clock.js';
import { listKeys, newListId, newListKey, proofHash, seal, unseal } from '../js/sync/crypto.js';
import { Replica, TOMBSTONE_TTL_MS } from '../js/sync/replica.js';

/** Steuerbare Uhr je Gerät. */
function wallClock(start = 1_000_000) {
  const clock = { t: start, now: () => clock.t };
  return clock;
}

function device(id, wall = wallClock()) {
  return { wall, replica: new Replica({ deviceId: id, now: wall.now }) };
}

/** Kleiner Pseudo-Zufall mit festem Startwert, damit Fehler reproduzierbar sind. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function shuffle(items, rnd) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const state = (replica) => JSON.stringify(['entry', 'product', 'list'].map((k) =>
  replica.all(k).sort((a, b) => a.id.localeCompare(b.id))));

// ---------------------------------------------------------------- Uhr

test('Uhr: Stempel sind sortierbar und laufen nie rückwärts, auch wenn die Gerätezeit zurückspringt', () => {
  const wall = wallClock(5_000);
  const clock = createClock('a', { now: wall.now });
  const first = clock.tick();
  const second = clock.tick();
  wall.t = 1_000;   // Uhr geht plötzlich nach
  const third = clock.tick();
  assert.ok(first < second && second < third);
  assert.deepEqual(parseStamp(third), { time: 5_000, counter: 2, deviceId: 'a' });
});

test('Uhr: nach einem fremden Stempel aus der Zukunft liegen eigene Stempel danach', () => {
  const clock = createClock('a', { now: () => 1_000 });
  const future = formatStamp(9_000, 3, 'b');
  clock.receive(future);
  assert.ok(clock.tick() > future);
});

test('Uhr: gleicher Zeitpunkt auf zwei Geräten – die Geräte-ID entscheidet, Stempel sind nie gleich', () => {
  const a = createClock('a', { now: () => 7 }).tick();
  const b = createClock('b', { now: () => 7 }).tick();
  assert.notEqual(a, b);
  assert.ok(a < b);
});

test('Uhr: Stand lässt sich speichern und fortsetzen', () => {
  const clock = createClock('a', { now: () => 50 });
  clock.tick();
  const stamp = clock.tick();
  const resumed = createClock('a', { now: () => 10, state: clock.state });
  assert.ok(resumed.tick() > stamp);
});

test('Uhr: kaputte Stempel werden erkannt', () => {
  assert.throws(() => parseStamp('abc'));
  assert.throws(() => parseStamp('0000000000001.0000.'));
});

// ---------------------------------------------------------------- Zusammenführen

test('Replica: eigene Änderungen wirken sofort und warten aufs Verschicken', () => {
  const { replica } = device('a');
  replica.set('entry', 'milch', { quantity: 1, status: 'open' });
  replica.set('entry', 'milch', { quantity: 2 });
  assert.deepEqual(replica.get('entry', 'milch'), { id: 'milch', quantity: 2, status: 'open' });
  assert.equal(replica.pending.length, 2);
  replica.acknowledge(1);
  assert.equal(replica.pending.length, 1);
});

test('Replica: gleichzeitige Änderungen an verschiedenen Feldern bleiben beide erhalten', () => {
  const a = device('a');
  const b = device('b');
  a.replica.set('entry', 'milch', { quantity: 1, note: '' });
  b.replica.receive(a.replica.pending);
  a.replica.set('entry', 'milch', { quantity: 3 });
  b.replica.set('entry', 'milch', { note: 'laktosefrei' });
  a.replica.receive(b.replica.pending);
  b.replica.receive(a.replica.pending);
  const expected = { id: 'milch', quantity: 3, note: 'laktosefrei' };
  assert.deepEqual(a.replica.get('entry', 'milch'), expected);
  assert.deepEqual(b.replica.get('entry', 'milch'), expected);
});

test('Replica: dasselbe Feld – die spätere Änderung gewinnt, egal in welcher Reihenfolge sie ankommt', () => {
  const a = device('a', wallClock(1_000));
  const b = device('b', wallClock(2_000));
  const early = a.replica.set('entry', 'milch', { quantity: 1 });
  const late = b.replica.set('entry', 'milch', { quantity: 5 });
  assert.ok(early && late);
  const c1 = new Replica({ deviceId: 'c1' });
  const c2 = new Replica({ deviceId: 'c2' });
  c1.receive([...a.replica.pending, ...b.replica.pending]);
  c2.receive([...b.replica.pending, ...a.replica.pending]);
  assert.equal(c1.get('entry', 'milch').quantity, 5);
  assert.equal(c2.get('entry', 'milch').quantity, 5);
});

test('Replica: wer eine Änderung gesehen hat, überschreibt sie danach – auch mit nachgehender Uhr', () => {
  const a = device('a', wallClock(9_000));   // Uhr geht vor
  const b = device('b', wallClock(1_000));   // Uhr geht nach
  a.replica.set('entry', 'milch', { quantity: 1 });
  b.replica.receive(a.replica.pending);
  b.replica.set('entry', 'milch', { quantity: 2 });   // B hat A gesehen und ändert danach
  a.replica.receive(b.replica.pending);
  assert.equal(a.replica.get('entry', 'milch').quantity, 2);
});

test('Replica: doppelt ankommende Änderungen schaden nicht', () => {
  const a = device('a');
  const b = device('b');
  a.replica.set('entry', 'milch', { quantity: 1 });
  a.replica.set('entry', 'milch', { quantity: 2 });
  assert.equal(b.replica.receive(a.replica.pending).length, 1);
  assert.equal(b.replica.receive(a.replica.pending).length, 0);
  assert.equal(b.replica.get('entry', 'milch').quantity, 2);
});

test('Replica: meldet, was sich sichtbar geändert hat (vorher/nachher)', () => {
  const a = device('a');
  const b = device('b');
  a.replica.set('entry', 'milch', { quantity: 1, status: 'open' });
  b.replica.receive(a.replica.pending);
  a.replica.acknowledge(1);
  a.replica.set('entry', 'milch', { status: 'inCart' });
  a.replica.set('entry', 'brot', { quantity: 1, status: 'open' });
  const changes = b.replica.receive(a.replica.pending);
  assert.deepEqual(changes.map((c) => [c.id, c.before?.status ?? null, c.after?.status]), [
    ['milch', 'open', 'inCart'],
    ['brot', null, 'open'],
  ]);
});

test('Replica: Entfernen gilt auch für Geräte, die währenddessen offline waren', () => {
  const a = device('a', wallClock(1_000));
  const b = device('b', wallClock(1_000));
  a.replica.set('entry', 'milch', { quantity: 1, status: 'inCart' });
  b.replica.receive(a.replica.pending);
  a.replica.acknowledge(1);
  a.wall.t = 2_000;
  a.replica.remove('entry', 'milch', { bought: true });   // Einkauf abgeschlossen
  // B war offline und hat nur die alte Fassung – liefert sie nochmal ein
  b.replica.receive(a.replica.pending);
  a.replica.receive([{ s: formatStamp(1_000, 0, 'a'), k: 'entry', i: 'milch', f: { quantity: 1, status: 'inCart' } }]);
  assert.equal(a.replica.get('entry', 'milch'), null);
  assert.equal(b.replica.get('entry', 'milch'), null);
  assert.deepEqual(b.replica.all('entry'), []);
});

test('Replica: ein entfernter Eintrag lebt durch erneutes Hinzufügen wieder auf', () => {
  const a = device('a');
  a.replica.set('entry', 'milch', { quantity: 2, note: 'alt', status: 'inCart' });
  a.replica.remove('entry', 'milch');
  a.wall.t += 10;
  a.replica.set('entry', 'milch', { _del: false, quantity: 1, note: '', status: 'open' });
  assert.deepEqual(a.replica.get('entry', 'milch'), { id: 'milch', quantity: 1, note: '', status: 'open' });
});

test('Replica: gleichzeitig entfernt und geändert – was später kam, gewinnt', () => {
  const a = device('a', wallClock(1_000));
  const b = device('b', wallClock(2_000));
  a.replica.set('entry', 'milch', { quantity: 1, status: 'open' });
  b.replica.receive(a.replica.pending);
  a.replica.remove('entry', 'milch');                       // früher
  b.replica.set('entry', 'milch', { _del: false, quantity: 4 });   // später wieder hinzugefügt
  a.replica.receive(b.replica.pending);
  b.replica.receive(a.replica.pending);
  assert.deepEqual(a.replica.get('entry', 'milch'), b.replica.get('entry', 'milch'));
  assert.equal(a.replica.get('entry', 'milch').quantity, 4);
});

test('Replica: unlesbare Änderungen werden übersprungen, der Rest kommt an', () => {
  const { replica } = device('b');
  const ok = { s: formatStamp(5, 0, 'a'), k: 'entry', i: 'milch', f: { quantity: 1 } };
  const changes = replica.receive([null, 'x', { s: 'kaputt', k: 'entry', i: 'x', f: {} }, { ...ok, f: [] }, ok]);
  assert.equal(changes.length, 1);
  assert.equal(replica.get('entry', 'milch').quantity, 1);
});

test('Replica: ungültige eigene Änderungen werden abgelehnt', () => {
  const { replica } = device('a');
  assert.throws(() => replica.set('entry', '', { quantity: 1 }));
  assert.throws(() => replica.set('entry', 'milch', {}));
  assert.throws(() => new Replica({}));
});

test('Replica: Speichern und Laden – samt Uhr und noch nicht verschickten Änderungen', () => {
  const a = device('a');
  a.replica.set('entry', 'milch', { quantity: 1 });
  a.replica.set('product', 'p1', { name: 'Hafermilch' });
  const saved = JSON.parse(JSON.stringify(a.replica.toJSON()));
  const restored = new Replica({ deviceId: 'a', now: () => 0, saved });
  assert.equal(state(restored), state(a.replica));
  assert.equal(restored.pending.length, 2);
  const next = restored.set('entry', 'milch', { quantity: 9 });
  assert.equal(next.after.quantity, 9, 'neuer Stempel liegt trotz Uhr 0 nach den gespeicherten');
});

// ---------------------------------------------------------------- Gesamtstand

test('Gesamtstand: neues Gerät lädt ihn und danach die Änderungen seitdem', () => {
  const a = device('a');
  a.replica.set('entry', 'milch', { quantity: 1 });
  a.replica.set('entry', 'brot', { quantity: 2 });
  a.replica.remove('entry', 'brot');
  const snapshot = JSON.parse(JSON.stringify(a.replica.snapshot()));
  a.replica.acknowledge(a.replica.pending.length);
  a.replica.set('entry', 'milch', { note: 'bio' });

  const c = device('c');
  c.replica.receiveSnapshot(snapshot);
  c.replica.receive(a.replica.pending);
  assert.equal(state(c.replica), state(a.replica));
  // Der Grabstein reist mit: eine alte Fassung von „brot“ bringt es nicht zurück
  c.replica.receive([{ s: formatStamp(1, 0, 'x'), k: 'entry', i: 'brot', f: { quantity: 2 } }]);
  assert.equal(c.replica.get('entry', 'brot'), null);
});

test('Gesamtstand: alte Grabsteine fallen weg, junge bleiben', () => {
  const wall = wallClock(1_000);
  const a = device('a', wall);
  a.replica.set('entry', 'alt', { quantity: 1 });
  a.replica.remove('entry', 'alt');
  wall.t += TOMBSTONE_TTL_MS + 1;
  a.replica.set('entry', 'jung', { quantity: 1 });
  a.replica.remove('entry', 'jung');
  const ids = a.replica.snapshot().records.map(([, id]) => id);
  assert.deepEqual(ids, ['jung']);
});

test('Gesamtstand: fremdes Format wird abgelehnt', () => {
  assert.throws(() => device('a').replica.receiveSnapshot({ v: 99, records: [] }));
});

// ---------------------------------------------------------------- Alle landen beim selben Stand

test('Drei Geräte, zufällige Änderungen, zufällige Zustellung: alle landen beim selben Stand', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rnd = random(seed);
    const devices = ['a', 'b', 'c'].map((id) => device(id, wallClock(1_000 + Math.floor(rnd() * 5_000))));
    const ids = ['milch', 'brot', 'eier', 'reis'];
    const sent = [];
    for (let step = 0; step < 60; step++) {
      const d = devices[Math.floor(rnd() * devices.length)];
      d.wall.t += Math.floor(rnd() * 50);
      const id = ids[Math.floor(rnd() * ids.length)];
      const roll = rnd();
      if (roll < 0.15) d.replica.remove('entry', id);
      else if (roll < 0.3) d.replica.set('entry', id, { _del: false, quantity: 1, status: 'open' });
      else if (roll < 0.6) d.replica.set('entry', id, { quantity: Math.ceil(rnd() * 5) });
      else if (roll < 0.8) d.replica.set('entry', id, { status: rnd() < 0.5 ? 'inCart' : 'later' });
      else d.replica.set('entry', id, { note: `n${step}` });
      // Ab und zu kommt ein Teil der Änderungen anderer bei einem Gerät an
      if (rnd() < 0.3) {
        sent.push(...d.replica.pending);
        d.replica.acknowledge(d.replica.pending.length);
        const other = devices[Math.floor(rnd() * devices.length)];
        other.replica.receive(shuffle(sent, rnd).slice(0, Math.floor(rnd() * sent.length)));
      }
    }
    for (const d of devices) {
      sent.push(...d.replica.pending);
      d.replica.acknowledge(d.replica.pending.length);
    }
    for (const d of devices) d.replica.receive(shuffle(sent, rnd));
    const [first, ...rest] = devices.map((d) => state(d.replica));
    for (const other of rest) assert.equal(other, first, `Startwert ${seed}`);
  }
});

// ---------------------------------------------------------------- Verschlüsselung

test('Verschlüsselung: hin und zurück; Listen-ID und Schlüssel sind zufällig', async () => {
  const key = newListKey();
  const id = newListId();
  assert.equal(key.length, 43);
  assert.equal(id.length, 22);
  assert.notEqual(newListKey(), key);
  const keys = await listKeys(key, id);
  const payload = { ops: [{ s: formatStamp(1, 0, 'a'), k: 'entry', i: 'milch', f: { quantity: 1.5, note: 'Bio – 3,5 %' } }] };
  const sealed = await seal(keys, payload);
  assert.ok(!sealed.includes('milch') && !sealed.includes('Bio'));
  assert.deepEqual(await unseal(keys, sealed), payload);
  assert.notEqual(await seal(keys, payload), sealed, 'jedes Mal anders verschlüsselt');
});

test('Verschlüsselung: falscher Schlüssel, andere Liste oder veränderter Text sind nicht lesbar', async () => {
  const key = newListKey();
  const id = newListId();
  const sealed = await seal(await listKeys(key, id), { a: 1 });
  await assert.rejects(unseal(await listKeys(newListKey(), id), sealed), /nicht lesbar/);
  await assert.rejects(unseal(await listKeys(key, newListId()), sealed), /nicht lesbar/);
  const tampered = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.at(-1);
  await assert.rejects(unseal(await listKeys(key, id), tampered), /nicht lesbar/);
  await assert.rejects(unseal(await listKeys(key, id), 'xyz'), /Format/);
  await assert.rejects(listKeys('zu-kurz', id), /Listenschlüssel/);
});

test('Schreib-Nachweis: fest je Liste, verschieden zwischen Listen, nur als Prüfwert beim Briefkasten', async () => {
  const key = newListKey();
  const id = newListId();
  const first = await listKeys(key, id);
  const again = await listKeys(key, id);
  const other = await listKeys(key, newListId());
  assert.equal(first.writeProof, again.writeProof);
  assert.notEqual(first.writeProof, other.writeProof);
  assert.notEqual(first.writeProof, key);
  const hash = await proofHash(first.writeProof);
  assert.equal(hash, await proofHash(again.writeProof));
  assert.notEqual(hash, first.writeProof);
});

// ---------------------------------------------------------------- Ablauf mit Briefkasten (simuliert)

test('Ablauf: zwei Geräte über einen simulierten Briefkasten – verschlüsselt, nummeriert, Einkauf für alle abgeschlossen', async () => {
  const listKey = newListKey();
  const listId = newListId();
  const keys = await listKeys(listKey, listId);
  const mailbox = [];   // so sieht ihn der Dienst: nur verschlüsselte Texte mit laufender Nummer

  async function send(d) {
    if (!d.replica.pending.length) return;
    const count = d.replica.pending.length;
    mailbox.push({ nr: mailbox.length + 1, data: await seal(keys, { ops: d.replica.pending }) });
    d.replica.acknowledge(count);
  }
  async function fetchNew(d) {
    const fresh = mailbox.filter((m) => m.nr > d.seen);
    d.seen = mailbox.length;
    const changes = [];
    for (const m of fresh) changes.push(...d.replica.receive((await unseal(keys, m.data)).ops));
    return changes;
  }

  const a = { ...device('a', wallClock(1_000)), seen: 0 };
  const b = { ...device('b', wallClock(1_500)), seen: 0 };
  a.replica.set('entry', 'milch', { quantity: 1, status: 'open' });
  a.replica.set('entry', 'brot', { quantity: 1, status: 'open' });
  await send(a);
  await fetchNew(b);
  assert.equal(b.replica.all('entry').length, 2);

  // Im Laden: B legt Milch in den Wagen, A gleichzeitig Brot
  b.wall.t += 100;
  a.wall.t += 100;
  b.replica.set('entry', 'milch', { status: 'inCart' });
  a.replica.set('entry', 'brot', { status: 'inCart' });
  await send(b);
  await send(a);
  await fetchNew(a);
  await fetchNew(b);
  assert.deepEqual(a.replica.all('entry').map((e) => e.status), ['inCart', 'inCart']);

  // A schließt ab – gilt für alle; B erfährt, was gekauft wurde (für „Zuletzt gekauft“ auf dem eigenen Gerät)
  a.wall.t += 100;
  for (const entry of a.replica.all('entry')) {
    if (entry.status === 'inCart') a.replica.remove('entry', entry.id, { bought: true });
  }
  await send(a);
  const changes = await fetchNew(b);
  assert.deepEqual(b.replica.all('entry'), []);
  assert.deepEqual(changes.map((c) => [c.id, c.after, c.fields.bought]).sort(), [['brot', null, true], ['milch', null, true]]);
  assert.ok(mailbox.every((m) => !m.data.includes('milch')));
});
