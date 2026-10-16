import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { LIMITS, Mailbox, sha256 } from '../src/mailbox.js';
import worker from '../src/worker.js';
import { listKeys, newListId, newListKey, proofHash, seal, unseal } from '../../../web/js/sync/crypto.js';
import { Replica } from '../../../web/js/sync/replica.js';

const BASE = 'https://sync.example';

/** Nachbau des Durable-Object-Speichers mit Nodes eingebautem SQLite. */
function fakeStorage() {
  let db = new DatabaseSync(':memory:');
  const storage = {
    alarm: null,
    sql: {
      exec(query, ...params) {
        const rows = db.prepare(query).all(...params);
        return { toArray: () => rows.map((r) => ({ ...r })) };
      },
    },
    async deleteAll() {
      db = new DatabaseSync(':memory:');
      storage.alarm = null;
    },
    setAlarm(at) {
      storage.alarm = at;
    },
  };
  return storage;
}

function setup() {
  const clock = { t: 1_000_000 };
  const storage = fakeStorage();
  const mailbox = new Mailbox(storage, { now: () => clock.t });
  const listId = newListId();
  const ctx = { clock, storage, mailbox, listId, member: null };
  ctx.call = (method, path, { body, proof, invite, member = ctx.member } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (proof) headers.Authorization = `Bearer ${proof}`;
    if (member) headers['X-Member'] = member;
    if (invite) headers['X-Invite'] = invite;
    return mailbox.fetch(new Request(`${BASE}/v1/lists/${listId}${path}`, {
      method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }));
  };
  return ctx;
}

async function created() {
  const ctx = setup();
  ctx.listKey = newListKey();
  ctx.keys = await listKeys(ctx.listKey, ctx.listId);
  const memberId = crypto.randomUUID();
  const res = await ctx.call('PUT', '', { body: { proofHash: await proofHash(ctx.keys.writeProof), memberId } });
  assert.equal(res.status, 201);
  ctx.member = memberId;
  ctx.proof = ctx.keys.writeProof;
  return ctx;
}

const body = (res) => res.json();

// ---------------------------------------------------------------- Anlegen und Zugang

test('Anlegen: einmal möglich, danach 409; unbekannte Listen gibt es nicht', async () => {
  const ctx = setup();
  assert.equal((await ctx.call('GET', '/ops', { proof: 'x'.repeat(43) })).status, 404);
  const hash = await sha256('geheim-geheim-geheim-geheim');
  const memberId = crypto.randomUUID();
  assert.equal((await ctx.call('PUT', '', { body: { proofHash: hash } })).status, 400, 'ohne Mitglieds-ID');
  assert.equal((await ctx.call('PUT', '', { body: { proofHash: hash, memberId } })).status, 201);
  assert.equal((await ctx.call('PUT', '', { body: { proofHash: hash, memberId } })).status, 409);
  assert.equal((await ctx.call('PUT', '', { body: { proofHash: 'kurz' } })).status, 409);
});

test('Anlegen: ohne gültigen Prüfwert abgelehnt', async () => {
  const ctx = setup();
  assert.equal((await ctx.call('PUT', '', { body: {} })).status, 400);
  assert.equal((await ctx.call('PUT', '', { body: 'kein json' })).status, 400);
});

test('Zugang: ohne oder mit falschem Schreib-Nachweis weder lesen noch schreiben', async () => {
  const ctx = await created();
  const wrong = (await listKeys(newListKey(), ctx.listId)).writeProof;
  for (const proof of [undefined, wrong, 'kurz']) {
    assert.equal((await ctx.call('GET', '/ops', { proof })).status, 401);
    assert.equal((await ctx.call('POST', '/ops', { proof, body: { data: 'x' } })).status, 401);
    assert.equal((await ctx.call('DELETE', '', { proof })).status, 401);
  }
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof })).status, 200);
});

test('Unbekannte Pfade und kaputte Listen-IDs: 404', async () => {
  const ctx = await created();
  assert.equal((await ctx.call('GET', '/irgendwas', { proof: ctx.proof })).status, 404);
  const res = await ctx.mailbox.fetch(new Request(`${BASE}/v1/lists/zu-kurz/ops`));
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------- Änderungen

test('Änderungen: fortlaufend nummeriert, abrufbar ab einer Nummer', async () => {
  const ctx = await created();
  for (const data of ['a1', 'a2', 'a3']) {
    const res = await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data } });
    assert.equal(res.status, 201);
  }
  const all = await body(await ctx.call('GET', '/ops?after=0', { proof: ctx.proof }));
  assert.deepEqual(all.items.map((i) => [i.nr, i.data]), [[1, 'a1'], [2, 'a2'], [3, 'a3']]);
  assert.equal(all.last, 3);
  const later = await body(await ctx.call('GET', '/ops?after=2', { proof: ctx.proof }));
  assert.deepEqual(later.items.map((i) => i.data), ['a3']);
  const none = await body(await ctx.call('GET', '/ops?after=3', { proof: ctx.proof }));
  assert.deepEqual(none, { snapshot: null, items: [], last: 3, more: false });
  assert.deepEqual(await body(await ctx.call('GET', '', { proof: ctx.proof })), { last: 3, members: 1, maxMembers: 5, admin: ctx.member });
});

test('Änderungen: Abruf in Seiten', async () => {
  const ctx = await created();
  for (let i = 0; i < LIMITS.page + 3; i++) await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data: `d${i}` } });
  const first = await body(await ctx.call('GET', '/ops?after=0', { proof: ctx.proof }));
  assert.equal(first.items.length, LIMITS.page);
  assert.equal(first.more, true);
  const second = await body(await ctx.call('GET', `/ops?after=${first.last}`, { proof: ctx.proof }));
  assert.equal(second.items.length, 3);
  assert.equal(second.more, false);
});

test('Änderungen: zu große oder leere Stapel werden abgelehnt', async () => {
  const ctx = await created();
  assert.equal((await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data: 'x'.repeat(LIMITS.opBytes) } })).status, 413);
  assert.equal((await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data: '' } })).status, 400);
  assert.equal((await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data: 5 } })).status, 400);
});

// ---------------------------------------------------------------- Gesamtstand

test('Gesamtstand: ersetzt ältere Änderungen; wer davor stand, bekommt ihn mit', async () => {
  const ctx = await created();
  for (const data of ['a1', 'a2', 'a3']) await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data } });
  assert.equal((await ctx.call('PUT', '/snapshot', { proof: ctx.proof, body: { upto: 2, data: 'stand2' } })).status, 200);
  await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data: 'a4' } });

  const fresh = await body(await ctx.call('GET', '/ops?after=0', { proof: ctx.proof }));
  assert.deepEqual(fresh.snapshot, { upto: 2, data: 'stand2' });
  assert.deepEqual(fresh.items.map((i) => i.nr), [3, 4], 'Nummern bleiben, auch nach dem Löschen');
  const current = await body(await ctx.call('GET', '/ops?after=3', { proof: ctx.proof }));
  assert.equal(current.snapshot, null);
  assert.deepEqual(current.items.map((i) => i.data), ['a4']);
});

test('Gesamtstand: nicht rückwärts und nicht über die letzte Nummer hinaus', async () => {
  const ctx = await created();
  for (const data of ['a1', 'a2', 'a3']) await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data } });
  assert.equal((await ctx.call('PUT', '/snapshot', { proof: ctx.proof, body: { upto: 9, data: 's' } })).status, 400);
  assert.equal((await ctx.call('PUT', '/snapshot', { proof: ctx.proof, body: { upto: 3, data: 's' } })).status, 200);
  assert.equal((await ctx.call('PUT', '/snapshot', { proof: ctx.proof, body: { upto: 2, data: 's' } })).status, 400);
  assert.equal((await ctx.call('PUT', '/snapshot', { proof: ctx.proof, body: { upto: 3, data: 's2' } })).status, 200);
});

test('Gesamtstand: zu viele Änderungen ohne Gesamtstand → 507', async () => {
  const ctx = await created();
  ctx.storage.sql.exec('WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) INSERT INTO ops (data, at) SELECT \'x\', 0 FROM n',
    LIMITS.opsBeforeSnapshot);
  assert.equal((await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data: 'zu viel' } })).status, 507);
  await ctx.call('PUT', '/snapshot', { proof: ctx.proof, body: { upto: LIMITS.opsBeforeSnapshot, data: 's' } });
  assert.equal((await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data: 'geht wieder' } })).status, 201);
});

// ---------------------------------------------------------------- Neuer Schlüssel, Löschen, Aufräumen

test('Neuer Schreib-Nachweis: der alte gilt danach nicht mehr', async () => {
  const ctx = await created();
  const next = await listKeys(newListKey(), ctx.listId);
  assert.equal((await ctx.call('PUT', '/proof', { proof: ctx.proof, body: { proofHash: await proofHash(next.writeProof) } })).status, 200);
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof })).status, 401);
  assert.equal((await ctx.call('GET', '/ops', { proof: next.writeProof })).status, 200);
});

test('Löschen: alles weg, die Liste ist danach unbekannt', async () => {
  const ctx = await created();
  await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data: 'a1' } });
  assert.equal((await ctx.call('DELETE', '', { proof: ctx.proof })).status, 204);
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof })).status, 404);
});

test('Aufräumen: nach 180 Tagen ohne Zugriff löscht der Wecker den Briefkasten', async () => {
  const ctx = await created();
  assert.equal(ctx.storage.alarm, ctx.clock.t + LIMITS.idleMs);
  ctx.clock.t += 1000;
  await ctx.call('GET', '/ops', { proof: ctx.proof });
  ctx.clock.t += LIMITS.idleMs - 10;
  await ctx.mailbox.alarm();   // zu früh (zuletzt benutzt vor weniger als 180 Tagen)
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof })).status, 200);
  ctx.clock.t += LIMITS.idleMs;
  await ctx.mailbox.alarm();
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof })).status, 404);
});

test('Bremse: mehr als die erlaubten Anfragen pro Minute → 429, danach wieder frei', async () => {
  const ctx = await created();
  let limited = 0;
  for (let i = 0; i < LIMITS.perMinute + 5; i++) {
    if ((await ctx.call('GET', '/ops', { proof: ctx.proof })).status === 429) limited++;
  }
  assert.ok(limited >= 5);
  ctx.clock.t += 61_000;
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof })).status, 200);
});

// ---------------------------------------------------------------- Beitritt

test('Beitritt: nur mit gültiger Einladung; Mitglied sieht die Anfrage und antwortet', async () => {
  const ctx = await created();
  const invite = 'einladung-einladung-123';
  assert.equal((await ctx.call('POST', '/requests', { invite, body: { data: 'anfrage' } })).status, 403);

  const issued = await ctx.call('POST', '/invites', { proof: ctx.proof, body: { hash: await sha256(invite), ttlMs: 30 * 60_000 } });
  assert.equal(issued.status, 201);
  assert.equal((await ctx.call('POST', '/requests', { invite: 'falsche-einladung-1234', body: { data: 'x' } })).status, 403);
  const { rid } = await body(await ctx.call('POST', '/requests', { invite, body: { data: 'anfrage' } }));
  assert.ok(rid);

  // Ohne Nachweis kann niemand die Anfragen sehen
  assert.equal((await ctx.call('GET', '/requests')).status, 401);
  const open = await body(await ctx.call('GET', '/requests', { proof: ctx.proof }));
  assert.deepEqual(open.requests.map((r) => [r.rid, r.data]), [[rid, 'anfrage']]);

  assert.deepEqual(await body(await ctx.call('GET', `/requests/${rid}`, { invite })), { answer: null });
  assert.equal((await ctx.call('GET', `/requests/${rid}`, { invite: 'falsche-einladung-1234' })).status, 403);
  assert.equal((await ctx.call('POST', `/requests/${rid}`, { proof: ctx.proof, body: { answer: 'schlüssel-für-c' } })).status, 200);
  assert.equal((await ctx.call('POST', `/requests/${rid}`, { proof: ctx.proof, body: { answer: 'nochmal' } })).status, 404);
  assert.deepEqual(await body(await ctx.call('GET', `/requests/${rid}`, { invite })), { answer: 'schlüssel-für-c' });
  assert.deepEqual((await body(await ctx.call('GET', '/requests', { proof: ctx.proof }))).requests, []);
});

test('Beitritt: ablehnen entfernt die Anfrage; abgelaufene Einladungen gelten nicht', async () => {
  const ctx = await created();
  const invite = 'einladung-einladung-456';
  await ctx.call('POST', '/invites', { proof: ctx.proof, body: { hash: await sha256(invite), ttlMs: 60_000 } });
  const { rid } = await body(await ctx.call('POST', '/requests', { invite, body: { data: 'anfrage' } }));
  await ctx.call('POST', `/requests/${rid}`, { proof: ctx.proof, body: { reject: true } });
  assert.equal((await ctx.call('GET', `/requests/${rid}`, { invite })).status, 404);

  ctx.clock.t += 61_000;
  assert.equal((await ctx.call('POST', '/requests', { invite, body: { data: 'zu spät' } })).status, 403);
});

test('Beitritt: höchstens 5 offene Anfragen', async () => {
  const ctx = await created();
  const invite = 'einladung-einladung-789';
  await ctx.call('POST', '/invites', { proof: ctx.proof, body: { hash: await sha256(invite), ttlMs: 60_000 } });
  for (let i = 0; i < LIMITS.openRequests; i++) await ctx.call('POST', '/requests', { invite, body: { data: `a${i}` } });
  assert.equal((await ctx.call('POST', '/requests', { invite, body: { data: 'eine zu viel' } })).status, 429);
});

/** Einladung ausstellen, Anfrage stellen, bestätigen – liefert die Mitglieds-ID des neuen Geräts. */
async function join(ctx, invite = `einladung-${crypto.randomUUID()}`) {
  await ctx.call('POST', '/invites', { proof: ctx.proof, body: { hash: await sha256(invite), ttlMs: 30 * 60_000 } });
  const res = await ctx.call('POST', '/requests', { invite, body: { data: 'anfrage' } });
  if (res.status !== 201) return { status: res.status };
  const { rid } = await body(res);
  const answered = await ctx.call('POST', `/requests/${rid}`, { proof: ctx.proof, body: { answer: 'schlüssel' } });
  return { status: answered.status, member: rid, invite };
}

test('Einladung: gilt höchstens 30 Minuten, auch wenn länger verlangt', async () => {
  const ctx = await created();
  const res = await ctx.call('POST', '/invites', { proof: ctx.proof, body: { hash: await sha256('einladung-lang-lang-lang'), ttlMs: 7 * 24 * 3600_000 } });
  assert.equal((await body(res)).expires, ctx.clock.t + 30 * 60_000);
  ctx.clock.t += 30 * 60_000;
  assert.equal((await ctx.call('POST', '/requests', { invite: 'einladung-lang-lang-lang', body: { data: 'x' } })).status, 403);
});

test('Einladung: späte Bestätigung kommt noch an, auch nach Ablauf der 30 Minuten', async () => {
  const ctx = await created();
  const invite = 'einladung-spaet-spaet-1';
  await ctx.call('POST', '/invites', { proof: ctx.proof, body: { hash: await sha256(invite), ttlMs: 30 * 60_000 } });
  const { rid } = await body(await ctx.call('POST', '/requests', { invite, body: { data: 'anfrage' } }));
  ctx.clock.t += 29 * 60_000;
  await ctx.call('POST', `/requests/${rid}`, { proof: ctx.proof, body: { answer: 'schlüssel' } });
  ctx.clock.t += 5 * 60_000;   // Einladung abgelaufen
  assert.deepEqual(await body(await ctx.call('GET', `/requests/${rid}`, { invite })), { answer: 'schlüssel' });
  ctx.clock.t += 24 * 3600_000;   // nach einem Tag ist auch die Antwort weg
  assert.equal((await ctx.call('GET', `/requests/${rid}`, { invite })).status, 403);
});

test('Einladung: unbeantwortete Anfragen verfallen mit der Einladung', async () => {
  const ctx = await created();
  const invite = 'einladung-offen-offen-1';
  await ctx.call('POST', '/invites', { proof: ctx.proof, body: { hash: await sha256(invite), ttlMs: 30 * 60_000 } });
  await ctx.call('POST', '/requests', { invite, body: { data: 'anfrage' } });
  ctx.clock.t += 31 * 60_000;
  assert.deepEqual((await body(await ctx.call('GET', '/requests', { proof: ctx.proof }))).requests, []);
});

test('Plätze: ohne eigenen Platz kein Zugang – auch nicht mit dem richtigen Schlüssel', async () => {
  const ctx = await created();
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof, member: '' })).status, 401);
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof, member: crypto.randomUUID() })).status, 401);
  const joined = await join(ctx);
  assert.equal(joined.status, 200);
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof, member: joined.member })).status, 200, 'neues Gerät hat seinen Platz');
});

test('Plätze: höchstens 5 Geräte; wer austritt, macht einen Platz frei', async () => {
  const ctx = await created();
  const members = [];
  for (let i = 0; i < 4; i++) {
    const joined = await join(ctx);
    assert.equal(joined.status, 200, `Gerät ${i + 2}`);
    members.push(joined.member);
  }
  const info = await body(await ctx.call('GET', '/members', { proof: ctx.proof }));
  assert.equal(info.members.length, 5);
  assert.equal(info.maxMembers, 5);
  assert.equal((await join(ctx)).status, 409, 'sechstes Gerät: Liste ist voll');

  // Austreten bzw. entfernen: Platz frei, Zugang des Geräts endet sofort
  assert.equal((await ctx.call('DELETE', `/members/${members[0]}`, { proof: ctx.proof })).status, 200);
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof, member: members[0] })).status, 401);
  assert.equal((await ctx.call('DELETE', `/members/${members[0]}`, { proof: ctx.proof })).status, 404);
  assert.equal((await join(ctx)).status, 200);
});

test('Plätze: Liste voll, während eine Anfrage noch offen ist – Bestätigen geht dann nicht', async () => {
  const ctx = await created();
  const invite = 'einladung-voll-voll-123';
  await ctx.call('POST', '/invites', { proof: ctx.proof, body: { hash: await sha256(invite), ttlMs: 30 * 60_000 } });
  const { rid } = await body(await ctx.call('POST', '/requests', { invite, body: { data: 'früh' } }));
  for (let i = 0; i < 4; i++) assert.equal((await join(ctx)).status, 200);
  assert.equal((await ctx.call('POST', `/requests/${rid}`, { proof: ctx.proof, body: { answer: 'k' } })).status, 409);
  assert.deepEqual(await body(await ctx.call('GET', `/requests/${rid}`, { invite })), { answer: null });
});

test('Admin: wer anlegt, ist Admin; nur er entfernt andere, austreten darf jeder', async () => {
  const ctx = await created();
  const b = await join(ctx);
  const c = await join(ctx);
  const info = await body(await ctx.call('GET', '/members', { proof: ctx.proof }));
  assert.equal(info.admin, ctx.member);
  // B (kein Admin) darf C nicht entfernen
  const denied = await ctx.call('DELETE', `/members/${c.member}`, { proof: ctx.proof, member: b.member });
  assert.equal(denied.status, 403);
  assert.match((await body(denied)).error, /Listen-Admin/);
  // B darf auch die Liste nicht löschen und den Schlüssel nicht erneuern
  assert.equal((await ctx.call('DELETE', '', { proof: ctx.proof, member: b.member })).status, 403);
  assert.equal((await ctx.call('PUT', '/proof', { proof: ctx.proof, member: b.member, body: { proofHash: await sha256('neu-neu-neu-neu-neu-neu') } })).status, 403);
  // B tritt selbst aus – erlaubt
  assert.equal((await ctx.call('DELETE', `/members/${b.member}`, { proof: ctx.proof, member: b.member })).status, 200);
  // Admin entfernt C – erlaubt, C hat sofort keinen Zugang mehr
  assert.equal((await ctx.call('DELETE', `/members/${c.member}`, { proof: ctx.proof })).status, 200);
  assert.equal((await ctx.call('GET', '/ops', { proof: ctx.proof, member: c.member })).status, 401);
});

test('Admin: verlässt der Admin die Liste, wird das am längsten dabei befindliche Gerät Admin', async () => {
  const ctx = await created();
  ctx.clock.t += 1000;
  const b = await join(ctx);
  ctx.clock.t += 1000;
  const c = await join(ctx);
  const left = await body(await ctx.call('DELETE', `/members/${ctx.member}`, { proof: ctx.proof }));
  assert.equal(left.admin, b.member);
  assert.equal((await body(await ctx.call('GET', '', { proof: ctx.proof, member: c.member }))).admin, b.member);
  assert.equal((await ctx.call('DELETE', `/members/${c.member}`, { proof: ctx.proof, member: b.member })).status, 200, 'neuer Admin darf entfernen');
});

test('Admin: ältere Listen ohne Eintrag – das zuerst beigetretene Gerät gilt als Admin', async () => {
  const ctx = await created();
  ctx.clock.t += 1000;
  const b = await join(ctx);
  ctx.storage.sql.exec("DELETE FROM meta WHERE k = 'admin'");
  assert.equal((await body(await ctx.call('GET', '/members', { proof: ctx.proof }))).admin, ctx.member);
  assert.equal((await ctx.call('DELETE', `/members/${ctx.member}`, { proof: ctx.proof, member: b.member })).status, 403);
});

test('Admin: als letztes Gerät darf jeder die Liste löschen', async () => {
  const ctx = await created();
  const b = await join(ctx);
  await ctx.call('DELETE', `/members/${ctx.member}`, { proof: ctx.proof });
  assert.equal((await ctx.call('DELETE', '', { proof: ctx.proof, member: b.member })).status, 204);
});

// ---------------------------------------------------------------- Einstieg (Worker)

test('Worker: leitet an den Briefkasten der Liste in der EU weiter, beantwortet CORS-Vorabfragen', async () => {
  const seen = [];
  const env = {
    MAILBOX: {
      jurisdiction: (where) => ({
        idFromName: (name) => `${where}:${name}`,
        get: (id) => ({ fetch: (request) => { seen.push([id, new URL(request.url).pathname]); return new Response('ok'); } }),
      }),
    },
  };
  const listId = newListId();
  const pre = await worker.fetch(new Request(`${BASE}/v1/lists/${listId}/ops`, { method: 'OPTIONS' }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal((await worker.fetch(new Request(`${BASE}/`), env)).status, 200);
  assert.equal((await worker.fetch(new Request(`${BASE}/v1/lists/kaputt/ops`), env)).status, 404);
  await worker.fetch(new Request(`${BASE}/v1/lists/${listId}/ops`), env);
  assert.deepEqual(seen, [[`eu:${listId}`, `/v1/lists/${listId}/ops`]]);
});

// ---------------------------------------------------------------- Zusammen mit dem Kern der App

test('Ablauf mit dem Kern der App: zwei Geräte gleichen über den Briefkasten ab, er sieht nur Datensalat', async () => {
  const ctx = await created();
  const devices = ['a', 'b'].map((id) => ({ replica: new Replica({ deviceId: id, now: () => ctx.clock.t }), seen: 0 }));

  async function sync(d) {
    if (d.replica.pending.length) {
      const count = d.replica.pending.length;
      const res = await ctx.call('POST', '/ops', { proof: ctx.proof, body: { data: await seal(ctx.keys, { ops: d.replica.pending }) } });
      assert.equal(res.status, 201);
      d.replica.acknowledge(count);
    }
    const page = await body(await ctx.call('GET', `/ops?after=${d.seen}`, { proof: ctx.proof }));
    if (page.snapshot) d.replica.receiveSnapshot(await unseal(ctx.keys, page.snapshot.data));
    for (const item of page.items) d.replica.receive((await unseal(ctx.keys, item.data)).ops);
    d.seen = page.last;
  }

  const [a, b] = devices;
  a.replica.set('entry', 'milch', { quantity: 1, status: 'open' });
  await sync(a);
  await sync(b);
  ctx.clock.t += 10;
  b.replica.set('entry', 'milch', { status: 'inCart' });
  await sync(b);
  await sync(a);
  assert.equal(a.replica.get('entry', 'milch').status, 'inCart');

  // Gesamtstand ablegen; ein drittes Gerät startet von dort
  const upto = a.seen;
  await ctx.call('PUT', '/snapshot', { proof: ctx.proof, body: { upto, data: await seal(ctx.keys, a.replica.snapshot()) } });
  const c = { replica: new Replica({ deviceId: 'c', now: () => ctx.clock.t }), seen: 0 };
  await sync(c);
  assert.deepEqual(c.replica.all('entry'), a.replica.all('entry'));

  const raw = ctx.storage.sql.exec('SELECT data FROM ops UNION ALL SELECT data FROM snapshot').toArray();
  assert.ok(raw.every((r) => !r.data.includes('milch') && !r.data.includes('inCart')));
  const meta = ctx.storage.sql.exec('SELECT v FROM meta').toArray().map((r) => r.v);
  assert.ok(!meta.includes(ctx.proof), 'nur der Prüfwert des Nachweises liegt beim Briefkasten');
});
