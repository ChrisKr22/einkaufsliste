// Katalog-Vorschläge: eigene Produkte als Nachricht an die Person schicken, die den Katalog pflegt.
// Ohne Server – die Nachricht enthält eine lesbare Liste und einen Code, den
// tools/catalog/vorschlaege.py liest und (nach Prüfung) in Catalog/catalog.json übernimmt.

import { DEFAULT_UNIT, UNITS, unitOf } from '../units.js';
import { packJson, unpackJson } from './share.js';

export const SUGGEST_MARKER = 'FY-KATALOG:';
const FORMAT = 1;
const MAX_PRODUCTS = 100;

const isOwn = (p) => p.isCustom && !p.catalogId;

/** Eigene (nicht aus dem Katalog stammende) Produkte, meistgekaufte zuerst – ohne die aus der Liste entfernten. */
export function suggestionCandidates(products) {
  return products
    .filter((p) => isOwn(p) && !p.suggestHidden)
    .sort((a, b) => (b.purchaseCount ?? 0) - (a.purchaseCount ?? 0) || a.name.localeCompare(b.name, 'de'));
}

/** Eigene Produkte, die man aus der Vorschlagsliste entfernt hat. */
export function hiddenSuggestions(products) {
  return products.filter((p) => isOwn(p) && p.suggestHidden);
}

/** Vorauswahl: mindestens zweimal gekauft und noch nicht vorgeschlagen. */
export function preselected(product) {
  return (product.purchaseCount ?? 0) >= 2 && !product.suggestedAt;
}

/**
 * @param {Array<object>} products eigene Produkte
 * @param {(product: object) => {key: string, name: string}|null} categoryOf
 * @returns {Promise<string>} Nachricht zum Teilen
 */
export async function suggestionMessage(products, categoryOf) {
  if (!products.length) throw new Error('Kein Produkt ausgewählt');
  const rows = products.slice(0, MAX_PRODUCTS).map((p) => {
    const category = categoryOf(p);
    const row = { n: p.name };
    if (category) { row.k = category.key; row.kn = category.name; }
    if (unitOf(p) !== DEFAULT_UNIT) row.u = unitOf(p);
    if (p.synonyms?.length) row.y = p.synonyms;
    if (p.purchaseCount) row.c = p.purchaseCount;
    return row;
  });
  const code = await packJson({ v: FORMAT, p: rows });
  const lines = [`Vorschlag für den FeedYourself-Katalog (${rows.length === 1 ? '1 Produkt' : `${rows.length} Produkte`})`, ''];
  for (const row of rows) {
    const details = [row.kn, row.u ? `in ${UNITS[row.u].label}` : null].filter(Boolean).join(', ');
    lines.push(`• ${row.n}${details ? ` – ${details}` : ''}`);
  }
  lines.push('', 'Zum Übernehmen bitte unverändert weitergeben:', `${SUGGEST_MARKER}${code}`);
  return lines.join('\n');
}

/** Liest den Code aus einer Vorschlags-Nachricht (für Tests; das Werkzeug macht dasselbe in Python). */
export async function readSuggestion(text) {
  const match = String(text ?? '').match(new RegExp(`${SUGGEST_MARKER}([zj][A-Za-z0-9_-]+)`));
  if (!match) throw new Error('Kein Katalog-Vorschlag gefunden');
  const payload = await unpackJson(match[1]);
  if (payload?.v !== FORMAT || !Array.isArray(payload.p)) throw new Error('Kein gültiger Katalog-Vorschlag');
  return payload.p;
}
