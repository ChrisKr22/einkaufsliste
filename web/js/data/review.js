// Pflegemodus: Katalog-Vorschläge in der App prüfen und als Freigabe-Code weitergeben.
// Ablauf: Nachrichten (FY-KATALOG:…) einfügen → pro Produkt aufnehmen oder ablehnen → Freigabe teilen (FY-FREIGABE:…)
// → am Mac: tools/catalog/vorschlaege.py --freigabe übernimmt sie in Catalog/catalog.json und Catalog/abgelehnt.json.
// Alles hier läuft nur auf dem Gerät; ins Repository kommt erst, was am Mac übernommen und gepusht wird.

import { fold } from '../search.js';
import { DEFAULT_UNIT, isUnit } from '../units.js';
import { packJson, unpackJson } from './share.js';
import { readSuggestion } from './suggest.js';

export const RELEASE_MARKER = 'FY-FREIGABE:';
const RELEASE_FORMAT = 1;
const MAX_NAME = 80;
const MAX_SYNONYMS = 10;
const MAX_ITEMS = 200;
export const FALLBACK_KEY = 'sonst';

const clean = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, MAX_NAME);

/** Leere Prüfliste: items = offene Vorschläge, rejected = früher abgelehnte Namen (vereinfacht). */
export function emptyReview() {
  return { items: [], rejected: [] };
}

/** Gespeicherten Stand prüfen; Unbrauchbares fällt weg. */
export function normalizeReview(value) {
  const review = emptyReview();
  if (!value || typeof value !== 'object') return review;
  if (Array.isArray(value.rejected)) review.rejected = value.rejected.filter((n) => typeof n === 'string').slice(-1000);
  if (Array.isArray(value.items)) {
    for (const item of value.items.slice(0, MAX_ITEMS)) {
      const name = clean(item?.name);
      if (!name) continue;
      review.items.push({
        key: fold(name),
        name,
        category: typeof item.category === 'string' ? item.category : FALLBACK_KEY,
        unit: isUnit(item.unit) ? item.unit : DEFAULT_UNIT,
        synonyms: Array.isArray(item.synonyms) ? item.synonyms.map(clean).filter(Boolean).slice(0, MAX_SYNONYMS) : [],
        count: Number.isFinite(item.count) ? Math.max(0, Math.round(item.count)) : 0,
        decision: item.decision === 'accept' || item.decision === 'reject' ? item.decision : null,
      });
    }
  }
  return review;
}

/** Alle Vorschlags-Codes aus einem eingefügten Text (auch mehrere Nachrichten hintereinander). */
export async function readSuggestions(text) {
  const codes = String(text ?? '').match(/FY-KATALOG:[zj][A-Za-z0-9_-]+/g) ?? [];
  if (!codes.length) throw new Error('Kein Katalog-Vorschlag gefunden (FY-KATALOG:…)');
  const rows = [];
  for (const code of codes) rows.push(...await readSuggestion(code));
  return rows;
}

/**
 * Vorschläge in die Prüfliste übernehmen; gleiche Namen werden zusammengeführt (Kaufzahlen addiert).
 * @param {{items: Array, rejected: string[]}} review
 * @param {Array<{n: string, k?: string, u?: string, y?: string[], c?: number}>} rows
 * @param {Set<string>} categoryKeys Katalog-Kategorien; unbekannte → Sonstiges
 * @returns {{review: object, added: number, merged: number}}
 */
export function addSuggestions(review, rows, categoryKeys) {
  const items = review.items.map((i) => ({ ...i, synonyms: [...i.synonyms] }));
  let added = 0;
  let merged = 0;
  for (const row of rows) {
    const name = clean(row?.n);
    if (!name) continue;
    const key = fold(name);
    const existing = items.find((i) => i.key === key);
    const count = Number.isFinite(row.c) ? Math.max(0, Math.round(row.c)) : 0;
    if (existing) {
      existing.count += count;
      merged++;
      continue;
    }
    if (items.length >= MAX_ITEMS) break;
    items.push({
      key,
      name,
      category: categoryKeys.has(row.k) ? row.k : FALLBACK_KEY,
      unit: isUnit(row.u) ? row.u : DEFAULT_UNIT,
      synonyms: (Array.isArray(row.y) ? row.y : []).map(clean).filter((s) => s && fold(s) !== key).slice(0, MAX_SYNONYMS),
      count,
      decision: null,
    });
    added++;
  }
  return { review: { ...review, items }, added, merged };
}

/**
 * Hinweise je Vorschlag: schon im Katalog (Name oder Suchwort) oder früher abgelehnt.
 * @param {Array<{name: string, synonyms?: string[], catalogId?: string|null}>} products
 */
export function reviewHints(review, products) {
  const known = new Map();
  for (const p of products) {
    if (!p.catalogId) continue;
    known.set(fold(p.name), p.name);
    for (const s of p.synonyms ?? []) if (!known.has(fold(s))) known.set(fold(s), p.name);
  }
  const rejected = new Set(review.rejected);
  return new Map(review.items.map((i) => [i.key, { inCatalog: known.get(fold(i.name)) ?? null, rejectedBefore: rejected.has(fold(i.name)) }]));
}

/** Freigabe-Nachricht für alle entschiedenen Vorschläge (null, wenn noch nichts entschieden ist). */
export async function releaseMessage(review) {
  const accepted = review.items.filter((i) => i.decision === 'accept');
  const rejected = review.items.filter((i) => i.decision === 'reject');
  if (!accepted.length && !rejected.length) return null;
  const payload = {
    v: RELEASE_FORMAT,
    a: accepted.map((i) => {
      const row = { n: i.name, k: i.category };
      if (i.unit !== DEFAULT_UNIT) row.u = i.unit;
      if (i.synonyms.length) row.y = i.synonyms;
      return row;
    }),
    r: rejected.map((i) => i.name),
  };
  const code = await packJson(payload);
  const lines = ['FeedYourself – Katalog-Freigabe', ''];
  if (accepted.length) lines.push(`Aufnehmen (${accepted.length}): ${accepted.map((i) => i.name).join(', ')}`);
  if (rejected.length) lines.push(`Ablehnen (${rejected.length}): ${rejected.map((i) => i.name).join(', ')}`);
  lines.push('', 'Am Mac übernehmen: pbpaste | python3 tools/catalog/vorschlaege.py --freigabe -', `${RELEASE_MARKER}${code}`);
  return lines.join('\n');
}

/** Nach dem Teilen: entschiedene Vorschläge aus der Liste nehmen, abgelehnte merken. */
export function clearDecided(review) {
  const rejected = new Set(review.rejected);
  for (const i of review.items) if (i.decision === 'reject') rejected.add(fold(i.name));
  return { items: review.items.filter((i) => !i.decision), rejected: [...rejected] };
}

/** Liest eine Freigabe (für Tests; das Werkzeug am Mac macht dasselbe in Python). */
export async function readRelease(text) {
  const match = String(text ?? '').match(new RegExp(`${RELEASE_MARKER}([zj][A-Za-z0-9_-]+)`));
  if (!match) throw new Error('Keine Freigabe gefunden');
  const payload = await unpackJson(match[1]);
  if (payload?.v !== RELEASE_FORMAT || !Array.isArray(payload.a) || !Array.isArray(payload.r)) throw new Error('Keine gültige Freigabe');
  return payload;
}
