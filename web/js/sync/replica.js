// Kern des Abgleichs gemeinsamer Listen (KONZEPT.md 8.4) – ohne Netz, ohne Oberfläche.
//
// Eine Replica ist der Stand einer gemeinsamen Liste auf einem Gerät. Sie besteht aus Datensätzen
// (Art + ID, z. B. „entry“ / „product“ / „list“), deren Felder einzeln zusammengeführt werden:
// Jedes Feld merkt sich den Zeitstempel seiner letzten Änderung, und der größere Stempel gewinnt.
// Dadurch ist das Ergebnis gleich – egal in welcher Reihenfolge, wie oft oder wie verspätet Änderungen ankommen.
// Ändert A die Menge und B gleichzeitig die Anmerkung, bleiben beide erhalten.
//
// Entfernen setzt das Feld `_del` (Grabstein), damit ein Gerät, das offline war, den Datensatz nicht zurückbringt.
// Wird derselbe Datensatz später wieder gesetzt (`_del: false`), lebt er mit den neuen Werten wieder auf.

import { createClock, parseStamp } from './clock.js';

export const DELETED = '_del';
const SNAPSHOT_FORMAT = 1;
/** Grabsteine bleiben so lange im Gesamtstand; wer länger offline war, kann Entferntes zurückbringen. */
export const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

const keyOf = (kind, id) => `${kind}\u0000${id}`;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @typedef {{s: string, k: string, i: string, f: Record<string, unknown>}} Op
 *   s: Zeitstempel (Hybrid-Uhr), k: Art, i: ID, f: geänderte Felder
 * @typedef {Record<string, [unknown, string]>} FieldMap  Feld → [Wert, Zeitstempel]
 * @typedef {{kind: string, id: string, before: object|null, after: object|null, fields: object}} Change
 *   after: null, wenn entfernt; fields: alle Felder samt `_del` und Grund (z. B. `bought` beim Abschließen)
 */

export class Replica {
  /**
   * @param {{deviceId: string, now?: () => number, saved?: object}} options
   *   saved: Ergebnis von `toJSON()` (Stand dieses Geräts samt noch nicht verschickter Änderungen)
   */
  constructor({ deviceId, now = () => Date.now(), saved } = {}) {
    if (!deviceId) throw new Error('Geräte-ID fehlt');
    this.deviceId = deviceId;
    this.now = now;
    this.clock = createClock(deviceId, { now, state: saved?.clock });
    /** @type {Map<string, {kind: string, id: string, fields: FieldMap}>} */
    this.records = new Map();
    /** @type {Op[]} eigene Änderungen, die der Briefkasten noch nicht bestätigt hat */
    this.pending = [];
    if (saved) {
      for (const [kind, id, fields] of saved.records ?? []) this.records.set(keyOf(kind, id), { kind, id, fields });
      this.pending = [...(saved.pending ?? [])];
    }
  }

  // ---------------------------------------------------------------- Lesen

  /** Aktueller Wert eines Datensatzes ohne Zeitstempel; null, wenn unbekannt oder entfernt. */
  get(kind, id) {
    const record = this.records.get(keyOf(kind, id));
    return record ? valueOf(record) : null;
  }

  /** Alle vorhandenen (nicht entfernten) Datensätze einer Art, jeweils mit `id`. */
  all(kind) {
    const result = [];
    for (const record of this.records.values()) {
      if (record.kind !== kind) continue;
      const value = valueOf(record);
      if (value) result.push(value);
    }
    return result;
  }

  // ---------------------------------------------------------------- Ändern

  /**
   * Eigene Änderung: wirkt sofort hier und wartet in `pending` auf das Verschicken.
   * @returns {Change|null} null, wenn sich nichts geändert hat
   */
  set(kind, id, fields) {
    if (!kind || !id || !isPlainObject(fields) || Object.keys(fields).length === 0) throw new Error('ungültige Änderung');
    const op = { s: this.clock.tick(), k: kind, i: id, f: structuredClone(fields) };
    this.pending.push(op);
    return this.#apply(op);
  }

  /** Entfernt einen Datensatz (Grabstein); weitere Felder, z. B. der Grund, werden mitgeschrieben. */
  remove(kind, id, fields = {}) {
    return this.set(kind, id, { ...fields, [DELETED]: true });
  }

  /**
   * Änderungen anderer Geräte übernehmen – in beliebiger Reihenfolge, doppelte schaden nicht.
   * Unlesbare Einträge (z. B. von einer neueren App-Version) werden übersprungen.
   * @param {Op[]} ops
   * @returns {Change[]} was sich dadurch sichtbar geändert hat
   */
  receive(ops) {
    const changes = new Map();
    for (const op of ops ?? []) {
      if (!isValidOp(op)) continue;
      this.clock.receive(op.s);
      const change = this.#apply(op);
      if (!change) continue;
      const key = keyOf(op.k, op.i);
      const first = changes.get(key);
      changes.set(key, first ? { ...change, before: first.before } : change);
    }
    return [...changes.values()].filter((c) => !sameValue(c.before, c.after));
  }

  /** Der Briefkasten hat die ersten `count` wartenden Änderungen angenommen. */
  acknowledge(count) {
    this.pending.splice(0, count);
  }

  // ---------------------------------------------------------------- Gesamtstand

  /**
   * Gesamtstand zum Ablegen im Briefkasten: alle Felder mit Zeitstempeln. Alte Grabsteine fallen weg.
   * Neue Mitglieder laden ihn zuerst und danach die Änderungen, die seitdem kamen.
   */
  snapshot({ tombstoneTtlMs = TOMBSTONE_TTL_MS } = {}) {
    const cutoff = this.now() - tombstoneTtlMs;
    const records = [];
    for (const { kind, id, fields } of this.records.values()) {
      const deleted = fields[DELETED];
      if (deleted?.[0] === true && parseStamp(deleted[1]).time < cutoff) continue;
      records.push([kind, id, structuredClone(fields)]);
    }
    return { v: SNAPSHOT_FORMAT, records };
  }

  /** Gesamtstand eines anderen Geräts einmischen (ersetzt nichts; jeweils der neuere Wert gewinnt). */
  receiveSnapshot(snapshot) {
    if (snapshot?.v !== SNAPSHOT_FORMAT || !Array.isArray(snapshot.records)) throw new Error('unbekannter Gesamtstand');
    const ops = [];
    for (const entry of snapshot.records) {
      if (!Array.isArray(entry) || entry.length !== 3 || !isPlainObject(entry[2])) continue;
      const [kind, id, fields] = entry;
      for (const [field, pair] of Object.entries(fields)) {
        if (Array.isArray(pair) && pair.length === 2) ops.push({ s: pair[1], k: kind, i: id, f: { [field]: pair[0] } });
      }
    }
    return this.receive(ops);
  }

  /** Zum Speichern auf dem Gerät (JSON-tauglich). */
  toJSON() {
    return {
      clock: this.clock.state,
      records: [...this.records.values()].map(({ kind, id, fields }) => [kind, id, fields]),
      pending: this.pending,
    };
  }

  // ---------------------------------------------------------------- intern

  /** @returns {Change|null} */
  #apply(op) {
    const key = keyOf(op.k, op.i);
    let record = this.records.get(key);
    const before = record ? valueOf(record) : null;
    if (!record) {
      record = { kind: op.k, id: op.i, fields: {} };
      this.records.set(key, record);
    }
    let changed = false;
    for (const [field, value] of Object.entries(op.f)) {
      const current = record.fields[field];
      if (current && current[1] >= op.s) continue;
      record.fields[field] = [structuredClone(value), op.s];
      changed = true;
    }
    return changed ? { kind: op.k, id: op.i, before, after: valueOf(record), fields: fieldsOf(record) } : null;
  }
}

function valueOf(record) {
  if (record.fields[DELETED]?.[0] === true) return null;
  const value = { id: record.id };
  // Felder sortiert: gleicher Stand ergibt auf jedem Gerät dasselbe Objekt, egal in welcher Reihenfolge Änderungen kamen
  for (const [field, [fieldValue]] of Object.entries(record.fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (field !== DELETED) value[field] = structuredClone(fieldValue);
  }
  return value;
}

function fieldsOf(record) {
  return Object.fromEntries(Object.entries(record.fields).map(([field, [value]]) => [field, structuredClone(value)]));
}

function isValidOp(op) {
  if (!isPlainObject(op) || typeof op.k !== 'string' || !op.k || typeof op.i !== 'string' || !op.i || !isPlainObject(op.f)) return false;
  try {
    parseStamp(op.s);
    return true;
  } catch {
    return false;
  }
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
