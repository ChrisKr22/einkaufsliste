// Briefkasten einer gemeinsamen Liste (KONZEPT.md 8.4) – läuft als Durable Object bei Cloudflare, eins pro Liste.
//
// Der Briefkasten kennt keine Inhalte: Er speichert verschlüsselte Texte mit laufender Nummer und gibt sie wieder aus.
// Lesen und Schreiben nur mit Schreib-Nachweis (gespeichert ist nur dessen SHA-256-Prüfwert) und einem Platz:
// Jedes Mitglieds-Gerät hat eine zufällige Mitglieds-ID und ein eigenes Mitglieds-Geheimnis (gespeichert nur als
// Prüfwert); höchstens 5 Plätze pro Liste. Die Mitglieds-IDs kennen alle Mitglieder – ausweisen kann sich damit nur,
// wer auch das Geheimnis hat. Wer entfernt wird, kommt darum sofort nicht mehr an die Liste, auch nicht mit dem
// Listenschlüssel und der ID eines anderen Geräts.
// Übergang für Plätze aus der Zeit vor den Geheimnissen: Das erste Geheimnis, das für einen solchen Platz kommt,
// gilt ab dann; Anfragen ganz ohne Geheimnis (alte App-Fassung) nur noch bis LEGACY_UNTIL und nur für solche Plätze.
// Beitrittsanfragen nur mit gültiger Einladung (nur als Prüfwert gespeichert, gilt höchstens 30 Minuten).
// Listen-Admin ist das Gerät, das die Liste angelegt hat: Nur es darf andere entfernen, den Schlüssel erneuern
// und die ganze Liste löschen. Verlässt es die Liste, wird das am längsten dabei befindliche Gerät Admin.
// IP-Adressen werden nicht gespeichert.
//
// Die Logik steckt in `Mailbox`; sie bekommt den SQLite-Speicher von außen – so lässt sie sich ohne Cloudflare testen.

export const LIMITS = {
  opBytes: 64 * 1024,          // ein eingeworfener Stapel Änderungen
  snapshotBytes: 512 * 1024,   // Gesamtstand
  requestBytes: 8 * 1024,      // Beitrittsanfrage / Antwort
  opsBeforeSnapshot: 5_000,    // danach muss erst ein Gesamtstand abgelegt werden
  page: 500,                   // Änderungen pro Abruf
  members: 5,                  // Geräte pro Liste
  openRequests: 5,
  perMinute: 600,              // Anfragen pro Liste und Minute
  inviteMaxMs: 30 * 60 * 1000,
  answerKeepMs: 24 * 60 * 60 * 1000,   // beantwortete Anfragen bleiben so lange abholbar
  idleMs: 180 * 24 * 60 * 60 * 1000,   // so lange unbenutzt → Briefkasten wird gelöscht
};

/** Bis dahin dürfen Plätze ohne Geheimnis (vor dem 17.10.2026 entstanden) noch ohne Geheimnis anfragen. */
export const LEGACY_UNTIL = Date.UTC(2026, 10, 1);   // 1. November 2026

const ID = /^[A-Za-z0-9_-]{22}$/;      // Listen-ID: 128 Bit base64url
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Invite, X-Member, X-Member-Secret',
  'Access-Control-Max-Age': '86400',
};

export function json(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const fail = (status, error) => json({ error }, status);

export async function sha256(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let binary = '';
  for (const b of digest) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `/v1/lists/<id>/<rest…>` → { listId, rest } oder null */
export function parsePath(pathname) {
  const match = /^\/v1\/lists\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (!match || !ID.test(match[1])) return null;
  return { listId: match[1], rest: (match[2] ?? '').split('/').filter(Boolean) };
}

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS ops (nr INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), upto INTEGER NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS members (mid TEXT PRIMARY KEY, at INTEGER NOT NULL, secret TEXT)',   // secret: Prüfwert des Mitglieds-Geheimnisses
  'CREATE TABLE IF NOT EXISTS requests (rid TEXT PRIMARY KEY, invite TEXT NOT NULL, data TEXT NOT NULL, answer TEXT, at INTEGER NOT NULL, secret TEXT)',
];

// Briefkästen von vor den Mitglieds-Geheimnissen: Spalte nachrüsten (gibt es sie schon, scheitert der Befehl – egal).
const MIGRATIONS = [
  'ALTER TABLE members ADD COLUMN secret TEXT',
  'ALTER TABLE requests ADD COLUMN secret TEXT',
];

export class Mailbox {
  /**
   * @param {{sql: {exec: (query: string, ...params: unknown[]) => {toArray: () => object[]}},
   *   deleteAll: () => Promise<void>, setAlarm: (at: number) => Promise<void>|void}} storage
   */
  constructor(storage, { now = () => Date.now() } = {}) {
    this.storage = storage;
    this.now = now;
    this.window = { start: 0, count: 0 };
    this.ready = false;
  }

  #prepare() {
    if (this.ready) return;
    for (const statement of SCHEMA) this.storage.sql.exec(statement);
    for (const statement of MIGRATIONS) {
      try { this.storage.sql.exec(statement); } catch { /* schon vorhanden */ }
    }
    this.ready = true;
  }

  #rows(query, ...params) {
    return this.storage.sql.exec(query, ...params).toArray();
  }

  #meta(key) {
    return this.#rows('SELECT v FROM meta WHERE k = ?', key)[0]?.v ?? null;
  }

  #setMeta(key, value) {
    this.#rows('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, String(value));
  }

  /** Schreib-Nachweis der Liste und Platz samt Mitglieds-Geheimnis des anfragenden Geräts. */
  async #authorized(request, now) {
    const stored = this.#meta('proof');
    const header = request.headers.get('Authorization') ?? '';
    const proof = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!stored || !TOKEN.test(proof) || (await sha256(proof)) !== stored) return false;
    const member = request.headers.get('X-Member') ?? '';
    const row = this.#rows('SELECT secret FROM members WHERE mid = ?', member)[0];
    if (!row) return false;
    const secret = request.headers.get('X-Member-Secret') ?? '';
    if (row.secret) return TOKEN.test(secret) && (await sha256(secret)) === row.secret;
    // Platz von vor den Geheimnissen: Das erste Geheimnis gilt ab jetzt; ohne Geheimnis nur noch in der Übergangszeit.
    if (TOKEN.test(secret)) {
      this.#rows('UPDATE members SET secret = ? WHERE mid = ? AND secret IS NULL', await sha256(secret), member);
      return true;
    }
    return now < LEGACY_UNTIL;
  }

  /** Prüfwert des Mitglieds-Geheimnisses aus einer Anfrage; fehlt bei alten App-Fassungen (dann null). */
  #secretHash(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !TOKEN.test(value)) throw Object.assign(new Error('Prüfwert des Mitglieds-Geheimnisses ungültig'), { status: 400 });
    return value;
  }

  #memberCount() {
    return this.#rows('SELECT COUNT(*) AS n FROM members')[0].n;
  }

  /** Mitglieds-ID des Admins; bei älteren Listen ohne Eintrag das zuerst beigetretene Gerät. */
  #admin() {
    const stored = this.#meta('admin');
    if (stored && this.#rows('SELECT 1 FROM members WHERE mid = ?', stored).length) return stored;
    return this.#rows('SELECT mid FROM members ORDER BY at, mid LIMIT 1')[0]?.mid ?? null;
  }

  async #body(request, maxBytes) {
    const text = await request.text();
    if (text.length > maxBytes) throw Object.assign(new Error('zu groß'), { status: 413 });
    try {
      const body = JSON.parse(text);
      if (body && typeof body === 'object' && !Array.isArray(body)) return body;
    } catch { /* unten */ }
    throw Object.assign(new Error('ungültige Anfrage'), { status: 400 });
  }

  async fetch(request) {
    try {
      return await this.#handle(request);
    } catch (error) {
      return fail(error.status ?? 500, error.status ? error.message : 'interner Fehler');
    }
  }

  async #handle(request) {
    const url = new URL(request.url);
    const path = parsePath(url.pathname);
    if (!path) return fail(404, 'unbekannt');

    const now = this.now();
    if (now - this.window.start > 60_000) this.window = { start: now, count: 0 };
    if (++this.window.count > LIMITS.perMinute) return fail(429, 'zu viele Anfragen');

    this.#prepare();
    const exists = this.#meta('proof') !== null;
    const [section, sub] = path.rest;
    const method = request.method;

    // Anlegen: PUT /v1/lists/<id>  { proofHash, memberId, secretHash } – das anlegende Gerät bekommt den ersten Platz
    if (!section && method === 'PUT') {
      if (exists) return fail(409, 'gibt es schon');
      const { proofHash, memberId, secretHash } = await this.#body(request, 1024);
      if (typeof proofHash !== 'string' || !TOKEN.test(proofHash)) return fail(400, 'Prüfwert fehlt');
      if (typeof memberId !== 'string' || !TOKEN.test(memberId)) return fail(400, 'Mitglieds-ID fehlt');
      const secret = this.#secretHash(secretHash);
      this.#setMeta('proof', proofHash);
      this.#setMeta('admin', memberId);
      this.#rows('INSERT INTO members (mid, at, secret) VALUES (?, ?, ?)', memberId, now, secret);
      this.#setMeta('created', now);
      await this.#touch(now);
      return json({ ok: true }, 201);
    }
    if (!exists) return fail(404, 'unbekannte Liste');

    // Beitrittsanfrage stellen und Antwort abholen – mit Einladung statt Schreib-Nachweis
    if (section === 'requests' && method === 'POST' && !sub) return this.#createRequest(request, now);
    if (section === 'requests' && method === 'GET' && sub) return this.#requestStatus(request, sub, now);

    if (!(await this.#authorized(request, now))) return fail(401, 'kein Zugang');
    await this.#touch(now);
    const caller = request.headers.get('X-Member');
    const isAdmin = caller === this.#admin();

    if (!section && method === 'DELETE') {
      if (!isAdmin && this.#memberCount() > 1) return fail(403, 'Nur der Listen-Admin kann die Liste löschen.');
      await this.storage.deleteAll();
      this.ready = false;
      return json(null, 204);
    }
    if (!section && method === 'GET') {
      const [{ last }] = this.#rows('SELECT COALESCE(MAX(nr), 0) AS last FROM ops');
      return json({ last: Math.max(last, Number(this.#meta('upto') ?? 0)), members: this.#memberCount(), maxMembers: LIMITS.members, admin: this.#admin() });
    }
    if (section === 'ops' && method === 'POST') return this.#append(request, now);
    if (section === 'ops' && method === 'GET') return this.#read(url);
    if (section === 'snapshot' && method === 'PUT') return this.#putSnapshot(request, now);
    if (section === 'proof' && method === 'PUT') {
      // Neuer Listenschlüssel (jemand wurde entfernt): ab jetzt gilt nur der neue Nachweis
      if (!isAdmin) return fail(403, 'Nur der Listen-Admin kann den Schlüssel erneuern.');
      const { proofHash } = await this.#body(request, 1024);
      if (typeof proofHash !== 'string' || !TOKEN.test(proofHash)) return fail(400, 'Prüfwert fehlt');
      this.#setMeta('proof', proofHash);
      return json({ ok: true });
    }
    // Plätze: ansehen, verlassen bzw. jemanden entfernen (Platz wird sofort frei, Zugang endet sofort)
    if (section === 'members' && method === 'GET' && !sub) {
      return json({ members: this.#rows('SELECT mid, at FROM members ORDER BY at'), maxMembers: LIMITS.members, admin: this.#admin() });
    }
    if (section === 'members' && method === 'DELETE' && sub) {
      // Austreten darf jeder für sich; andere entfernen nur der Admin.
      if (sub !== caller && !isAdmin) return fail(403, 'Nur der Listen-Admin kann Mitglieder entfernen.');
      const wasAdmin = sub === this.#admin();
      const removed = this.#rows('DELETE FROM members WHERE mid = ? RETURNING mid', sub);
      if (!removed.length) return fail(404, 'unbekanntes Mitglied');
      if (wasAdmin) {
        const next = this.#rows('SELECT mid FROM members ORDER BY at, mid LIMIT 1')[0]?.mid;
        if (next) this.#setMeta('admin', next);
      }
      return json({ ok: true, admin: this.#admin() });
    }
    if (section === 'invites' && method === 'POST') {
      const { hash, ttlMs } = await this.#body(request, 1024);
      if (typeof hash !== 'string' || !TOKEN.test(hash)) return fail(400, 'Prüfwert fehlt');
      const expires = now + Math.min(Math.max(Number(ttlMs) || 0, 60_000), LIMITS.inviteMaxMs);
      this.#rows('INSERT INTO invites (hash, expires) VALUES (?, ?) ON CONFLICT (hash) DO UPDATE SET expires = excluded.expires', hash, expires);
      return json({ expires }, 201);
    }
    if (section === 'requests' && method === 'GET' && !sub) {
      this.#cleanup(now);
      return json({ requests: this.#rows('SELECT rid, data, at FROM requests WHERE answer IS NULL ORDER BY at') });
    }
    if (section === 'requests' && method === 'POST' && sub) {
      const { answer, reject } = await this.#body(request, LIMITS.requestBytes);
      if (reject === true) {
        this.#rows('DELETE FROM requests WHERE rid = ?', sub);
        return json({ ok: true });
      }
      if (typeof answer !== 'string' || !answer) return fail(400, 'Antwort fehlt');
      const open = this.#rows('SELECT rid FROM requests WHERE rid = ? AND answer IS NULL', sub);
      if (!open.length) return fail(404, 'unbekannte oder schon beantwortete Anfrage');
      if (this.#memberCount() >= LIMITS.members) return fail(409, 'Liste ist voll');
      // Bestätigt: Die Anfrage-ID wird die Mitglieds-ID des neuen Geräts, sein Geheimnis kam mit der Anfrage
      this.#rows('UPDATE requests SET answer = ? WHERE rid = ?', answer, sub);
      this.#rows('INSERT INTO members (mid, at, secret) SELECT ?, ?, secret FROM requests WHERE rid = ?', sub, now, sub);
      return json({ ok: true });
    }
    return fail(404, 'unbekannt');
  }

  async #append(request, now) {
    const { data } = await this.#body(request, LIMITS.opBytes);
    if (typeof data !== 'string' || !data) return fail(400, 'Daten fehlen');
    const [{ count }] = this.#rows('SELECT COUNT(*) AS count FROM ops');
    if (count >= LIMITS.opsBeforeSnapshot) return fail(507, 'Gesamtstand nötig');
    const [{ nr }] = this.#rows('INSERT INTO ops (data, at) VALUES (?, ?) RETURNING nr', data, now);
    return json({ nr }, 201);
  }

  /** GET ops?after=N – Änderungen nach Nummer N. Liegt N vor dem Gesamtstand, kommt dieser zuerst mit. */
  #read(url) {
    const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
    const snap = this.#rows('SELECT upto, data FROM snapshot WHERE id = 1')[0] ?? null;
    const needsSnapshot = snap !== null && after < snap.upto;
    const from = needsSnapshot ? snap.upto : after;
    const items = this.#rows('SELECT nr, data FROM ops WHERE nr > ? ORDER BY nr LIMIT ?', from, LIMITS.page + 1);
    const more = items.length > LIMITS.page;
    if (more) items.pop();
    const last = items.at(-1)?.nr ?? from;
    return json({ snapshot: needsSnapshot ? { upto: snap.upto, data: snap.data } : null, items, last, more });
  }

  /** PUT snapshot { upto, data } – Gesamtstand bis Nummer `upto`; ältere Änderungen werden gelöscht. */
  async #putSnapshot(request, now) {
    const { upto, data } = await this.#body(request, LIMITS.snapshotBytes);
    const [{ last }] = this.#rows('SELECT COALESCE(MAX(nr), 0) AS last FROM ops');
    const current = this.#rows('SELECT upto FROM snapshot WHERE id = 1')[0]?.upto ?? 0;
    if (!Number.isInteger(upto) || upto < current || upto > Math.max(last, current) || typeof data !== 'string' || !data) {
      return fail(400, 'ungültiger Gesamtstand');
    }
    this.#rows('INSERT INTO snapshot (id, upto, data, at) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET upto = excluded.upto, data = excluded.data, at = excluded.at',
      upto, data, now);
    this.#setMeta('upto', upto);
    this.#rows('DELETE FROM ops WHERE nr <= ?', upto);
    return json({ ok: true });
  }

  async #inviteHash(request, now, { allowExpired = false } = {}) {
    const invite = request.headers.get('X-Invite') ?? '';
    if (!TOKEN.test(invite)) return null;
    const hash = await sha256(invite);
    const row = this.#rows('SELECT expires FROM invites WHERE hash = ?', hash)[0];
    return row && (allowExpired || row.expires > now) ? hash : null;
  }

  async #createRequest(request, now) {
    const invite = await this.#inviteHash(request, now);
    if (!invite) return fail(403, 'Einladung ungültig oder abgelaufen');
    if (this.#memberCount() >= LIMITS.members) return fail(409, 'Liste ist voll');
    const { data, secretHash } = await this.#body(request, LIMITS.requestBytes);
    if (typeof data !== 'string' || !data) return fail(400, 'Daten fehlen');
    const secret = this.#secretHash(secretHash);
    this.#cleanup(now);
    const [{ open }] = this.#rows('SELECT COUNT(*) AS open FROM requests');
    if (open >= LIMITS.openRequests) return fail(429, 'zu viele offene Anfragen');
    const rid = crypto.randomUUID();
    this.#rows('INSERT INTO requests (rid, invite, data, at, secret) VALUES (?, ?, ?, ?, ?)', rid, invite, data, now, secret);
    return json({ rid }, 201);
  }

  /** Antwort abholen – auch nach Ablauf der Einladung, damit eine späte Bestätigung noch ankommt. */
  async #requestStatus(request, rid, now) {
    this.#cleanup(now);
    const invite = await this.#inviteHash(request, now, { allowExpired: true });
    if (!invite) return fail(403, 'Einladung ungültig oder abgelaufen');
    const row = this.#rows('SELECT answer FROM requests WHERE rid = ? AND invite = ?', rid, invite)[0];
    if (!row) return fail(404, 'unbekannte Anfrage – abgelehnt oder abgelaufen');
    return json({ answer: row.answer ?? null });
  }

  /**
   * Aufräumen: Offene Anfragen verfallen mit ihrer Einladung; beantwortete bleiben noch 24 Stunden abholbar,
   * ebenso so lange der Prüfwert der Einladung, mit dem sie abgeholt werden.
   */
  #cleanup(now) {
    this.#rows('DELETE FROM requests WHERE answer IS NULL AND invite IN (SELECT hash FROM invites WHERE expires <= ?)', now);
    this.#rows('DELETE FROM requests WHERE answer IS NOT NULL AND at <= ?', now - LIMITS.answerKeepMs);
    this.#rows('DELETE FROM invites WHERE expires <= ? AND hash NOT IN (SELECT invite FROM requests)', now);
  }

  async #touch(now) {
    this.#setMeta('access', now);
    await this.storage.setAlarm(now + LIMITS.idleMs);
  }

  /** Wecker: Lange unbenutzte Briefkästen werden gelöscht. */
  async alarm() {
    this.#prepare();
    const access = Number(this.#meta('access') ?? 0);
    if (this.now() - access >= LIMITS.idleMs) {
      await this.storage.deleteAll();
      this.ready = false;
    } else {
      await this.storage.setAlarm(access + LIMITS.idleMs);
    }
  }
}
