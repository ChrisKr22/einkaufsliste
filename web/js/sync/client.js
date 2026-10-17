// Verbindung zum Briefkasten (tools/sync) – nur Netz und Verschlüsselung, kein Zustand der App.
// Alles, was hinausgeht, ist mit dem Listenschlüssel bzw. der Einladung verschlüsselt.

import { listKeys, proofHash, seal, unseal } from './crypto.js';
import { inviteKeys } from './join.js';

export const SYNC_URL = 'https://feedyourself-sync.ck-lists.workers.dev';

export class SyncError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MESSAGES = {
  401: 'Kein Zugang mehr – dieses Gerät wurde aus der Liste entfernt.',
  403: 'Die Einladung ist ungültig oder abgelaufen.',
  404: 'Diese Liste gibt es nicht mehr.',
  409: 'Die Liste ist voll (höchstens 5 Geräte).',
  429: 'Zu viele Anfragen – gleich noch einmal versuchen.',
};

async function request(fetchFn, base, listId, method, path, { body, proof, member, secret, invite, extra } = {}) {
  const headers = { ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (proof) headers.Authorization = `Bearer ${proof}`;
  if (member) headers['X-Member'] = member;
  if (secret) headers['X-Member-Secret'] = secret;
  if (invite) headers['X-Invite'] = invite;
  let response;
  try {
    response = await fetchFn(`${base}/v1/lists/${listId}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
    });
  } catch {
    throw new SyncError(0, 'Keine Verbindung zum Briefkasten.');
  }
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* unten */ }
  if (!response.ok) {
    // 403: Der Briefkasten sagt selbst, woran es liegt (abgelaufene Einladung oder nur für den Admin erlaubt).
    const message = response.status === 403 ? json?.error ?? MESSAGES[403] : MESSAGES[response.status] ?? json?.error ?? `Fehler ${response.status}`;
    throw new SyncError(response.status, message);
  }
  return json;
}

/** Zugang eines Mitglieds zu seiner Liste. */
export class ListConnection {
  /**
   * @param {{listId: string, listKey: string, memberId: string, memberSecret: string, baseUrl?: string, fetch?: typeof fetch}} options
   *   memberSecret: Geheimnis dieses Geräts – weist es zusammen mit der Mitglieds-ID beim Briefkasten aus
   */
  constructor({ listId, listKey, memberId, memberSecret, baseUrl = SYNC_URL, fetch: fetchFn = (...a) => globalThis.fetch(...a) }) {
    Object.assign(this, { listId, listKey, memberId, memberSecret, baseUrl, fetchFn });
    this.keys = null;
  }

  async #keys() {
    this.keys ??= await listKeys(this.listKey, this.listId);
    return this.keys;
  }

  async #call(method, path, body, extra) {
    const keys = await this.#keys();
    return request(this.fetchFn, this.baseUrl, this.listId, method, path, { body, proof: keys.writeProof, member: this.memberId, secret: this.memberSecret, extra });
  }

  /** Briefkasten anlegen; dieses Gerät bekommt den ersten Platz. */
  async create() {
    const keys = await this.#keys();
    await request(this.fetchFn, this.baseUrl, this.listId, 'PUT', '', {
      body: { proofHash: await proofHash(keys.writeProof), memberId: this.memberId, secretHash: await proofHash(this.memberSecret) },
    });
  }

  info() {
    return this.#call('GET', '');
  }

  /** Änderungen einwerfen. @returns {Promise<number>} Nummer im Briefkasten */
  async push(ops) {
    const { nr } = await this.#call('POST', '/ops', { data: await seal(await this.#keys(), { ops }) });
    return nr;
  }

  /**
   * Alles nach Nummer `after` abholen (mehrere Seiten), entschlüsselt.
   * Unlesbare Einträge werden übersprungen (z. B. mit altem Schlüssel verschlüsselt).
   * @returns {Promise<{snapshot: object|null, snapshotUpto: number, ops: object[], last: number}>}
   */
  async pull(after) {
    const keys = await this.#keys();
    let snapshot = null;
    let snapshotUpto = 0;
    const ops = [];
    let last = after;
    for (let page = 0; page < 50; page++) {
      // Startnummer als Kopfzeile: Die Adresse bleibt gleich, darum fragt der Browser nicht jedes Mal vorab (CORS) nach.
      const result = await this.#call('GET', '/ops', undefined, { 'X-After': String(last) });
      if (result.snapshot) {
        snapshotUpto = result.snapshot.upto;
        try { snapshot = await unseal(keys, result.snapshot.data); } catch { /* überspringen */ }
      }
      for (const item of result.items) {
        try { ops.push(...((await unseal(keys, item.data)).ops ?? [])); } catch { /* überspringen */ }
      }
      last = result.last;
      if (!result.more) break;
    }
    return { snapshot, snapshotUpto, ops, last };
  }

  async putSnapshot(upto, snapshot) {
    await this.#call('PUT', '/snapshot', { upto, data: await seal(await this.#keys(), snapshot) });
  }

  members() {
    return this.#call('GET', '/members');
  }

  /** Austreten (eigene ID) oder – nur als Admin – ein anderes Gerät entfernen. */
  leave(memberId = this.memberId) {
    return this.#call('DELETE', `/members/${memberId}`);
  }

  destroy() {
    return this.#call('DELETE', '');
  }

  /** Einladung beim Briefkasten gültig machen (höchstens 30 Minuten). @returns {Promise<number>} Ablaufzeit */
  async registerInvite(secret, ttlMs = 30 * 60_000) {
    const { token } = await inviteKeys(secret, this.listId);
    const { expires } = await this.#call('POST', '/invites', { hash: await proofHash(token), ttlMs });
    return expires;
  }

  /**
   * Offene Beitrittsanfragen, entschlüsselt mit den bekannten Einladungen.
   * @param {string[]} secrets  Einladungs-Geheimnisse der Liste
   * @returns {Promise<Array<{rid: string, at: number, secret: string, publicJwk: object, device: string}>>}
   */
  async requests(secrets) {
    const { requests } = await this.#call('GET', '/requests');
    const keys = await Promise.all(secrets.map(async (secret) => ({ secret, keys: await inviteKeys(secret, this.listId) })));
    const result = [];
    for (const r of requests) {
      for (const { secret, keys: k } of keys) {
        try {
          const data = await unseal(k, r.data);
          result.push({ rid: r.rid, at: r.at, secret, publicJwk: data.pub, device: String(data.device ?? '').slice(0, 40) });
          break;
        } catch { /* andere Einladung */ }
      }
    }
    return result;
  }

  answer(rid, answer) {
    return this.#call('POST', `/requests/${rid}`, { answer });
  }

  reject(rid) {
    return this.#call('POST', `/requests/${rid}`, { reject: true });
  }
}

/** Beitritt von einem neuen Gerät aus – nur mit der Einladung. */
export class JoinConnection {
  constructor({ listId, secret, baseUrl = SYNC_URL, fetch: fetchFn = (...a) => globalThis.fetch(...a) }) {
    Object.assign(this, { listId, secret, baseUrl, fetchFn });
  }

  /**
   * @param {string} memberSecret  Geheimnis des neuen Geräts; der Briefkasten bekommt nur den Prüfwert,
   *   das bestätigende Mitglied gar nichts davon
   * @returns {Promise<string>} Anfrage-ID (wird nach Bestätigung die Mitglieds-ID)
   */
  async request(publicJwk, device, memberSecret) {
    const keys = await inviteKeys(this.secret, this.listId);
    const { rid } = await request(this.fetchFn, this.baseUrl, this.listId, 'POST', '/requests', {
      invite: keys.token, body: { data: await seal(keys, { pub: publicJwk, device }), secretHash: await proofHash(memberSecret) },
    });
    return rid;
  }

  /** @returns {Promise<string|null>} verschlüsselte Antwort oder null, solange nicht bestätigt */
  async answer(rid) {
    const keys = await inviteKeys(this.secret, this.listId);
    const { answer } = await request(this.fetchFn, this.baseUrl, this.listId, 'GET', `/requests/${rid}`, { invite: keys.token });
    return answer;
  }
}
