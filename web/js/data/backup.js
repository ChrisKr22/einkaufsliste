// Sicherung: alle Daten als eine JSON-Datei exportieren und wieder einspielen.
//
// Zugänge zu gemeinsamen Listen (Listenschlüssel, Mitglieds-Geheimnis, offener Beitritt) machen jeden, der die Datei
// hat, zum Mitglied. Sie kommen darum nur mit Passwort in die Datei – verschlüsselt im „Tresor“ (PBKDF2 + AES-GCM).
// Ohne Passwort fehlen sie; das Gerät tritt nach dem Einspielen neu bei. Alles andere bleibt ohne Passwort lesbar.

import { isSafeId } from './ids.js';
import { fromBase64Url, toBase64Url } from './share.js';

export const BACKUP_APP = 'FeedYourself';
export const BACKUP_FORMAT = 1;
export const LAST_BACKUP_KEY = 'lastBackupAt';
const STORES = ['categories', 'products', 'entries', 'meta', 'photos'];
const OPTIONAL = new Set(['photos']);   // ältere Sicherungen haben noch keine Fotos
const STATUSES = new Set(['open', 'inCart', 'later']);
const UNIT_KEYS = new Set(['stk', 'pck', 'g', 'kg', 'ml', 'l']);
const validUnit = (u) => u === undefined || UNIT_KEYS.has(u);

// Schlüssel der Zugänge im Gerätespeicher (meta) – wie in sync/shared-list.js und lists.js (Test prüft das).
const ACCESS_PREFIX = 'shared:';
const ACCESS_KEYS = new Set(['sharedJoin', 'sharedList']);
const LISTS_KEY = 'lists';
export const isAccessKey = (key) => typeof key === 'string' && (key.startsWith(ACCESS_PREFIX) || ACCESS_KEYS.has(key));

const VAULT_FORMAT = 1;
export const VAULT_ITERATIONS = 600_000;    // PBKDF2-SHA256 (OWASP-Empfehlung 2023)
const VAULT_LIMITS = { min: 100_000, max: 5_000_000 };   // fremde Dateien sollen das Gerät nicht minutenlang rechnen lassen
const VAULT_AAD = new TextEncoder().encode('feedyourself/sicherung');
export const MIN_PASSWORD = 8;

/** @returns {Promise<object>} vollständige Sicherung */
export async function createBackup(store, now = Date.now()) {
  const data = {};
  for (const name of STORES) data[name] = await store.getAll(name);
  data.meta = data.meta.filter((m) => m.key !== LAST_BACKUP_KEY);
  return { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: new Date(now).toISOString(), data };
}

export function backupFileName(now = Date.now()) {
  return `feedyourself-sicherung-${new Date(now).toISOString().slice(0, 10)}.json`;
}

export function summarize(backup) {
  const { categories, products, entries, photos = [] } = backup.data;
  return {
    categories: categories.length, products: products.length, entries: entries.length, photos: photos.length, exportedAt: backup.exportedAt,
    vault: Boolean(backup.vault),   // Zugänge zu gemeinsamen Listen, mit Passwort verschlüsselt
    vaultCount: Number.isInteger(backup.vault?.count) && backup.vault.count > 0 ? backup.vault.count : null,
  };
}

/** Wie viele Zugänge zu gemeinsamen Listen (bzw. offene Beitritte) in einer Sicherung im Klartext stehen. */
export function accessCount(backup) {
  return backup.data.meta.filter((m) => isAccessKey(m.key)).length;
}

async function vaultKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * Für die Datei: Zugänge aus `meta` nehmen und – mit Passwort – verschlüsselt als `vault` anhängen.
 * Ohne Passwort fehlen sie in der Datei.
 * @returns {Promise<{backup: object, sealed: number, dropped: number}>}
 */
export async function sealBackup(backup, password = '', { iterations = VAULT_ITERATIONS } = {}) {
  const access = backup.data.meta.filter((m) => isAccessKey(m.key));
  const result = { ...backup, data: { ...backup.data, meta: backup.data.meta.filter((m) => !isAccessKey(m.key)) } };
  delete result.vault;
  if (!access.length) return { backup: result, sealed: 0, dropped: 0 };
  if (!password) return { backup: result, sealed: 0, dropped: access.length };
  if (password.length < MIN_PASSWORD) throw new Error(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await vaultKey(password, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: VAULT_AAD }, key, new TextEncoder().encode(JSON.stringify(access))));
  result.vault = { v: VAULT_FORMAT, kdf: 'PBKDF2-SHA256', iterations, salt: toBase64Url(salt), iv: toBase64Url(iv), data: toBase64Url(data), count: access.length };
  return { backup: result, sealed: access.length, dropped: 0 };
}

/**
 * Tresor einer Sicherung mit dem Passwort öffnen: Die Zugänge kommen zurück nach `meta`.
 * @returns {Promise<object>} Sicherung ohne `vault`, mit den Zugängen
 */
export async function openVault(backup, password) {
  const { vault } = backup;
  if (!vault) return backup;
  let entries;
  try {
    const key = await vaultKey(String(password ?? ''), fromBase64Url(vault.salt), vault.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(vault.iv), additionalData: VAULT_AAD }, key, fromBase64Url(vault.data));
    entries = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw Object.assign(new Error('Das Passwort stimmt nicht.'), { code: 'password' });
  }
  if (!Array.isArray(entries) || !entries.every((m) => isAccessKey(m?.key))) throw new Error('Die Sicherung ist beschädigt (Zugänge).');
  const result = { ...backup, data: { ...backup.data, meta: [...backup.data.meta.filter((m) => !isAccessKey(m.key)), ...entries] } };
  delete result.vault;
  return result;
}

/** Sicherung ohne den Tresor (Einspielen ohne Passwort – die gemeinsamen Listen fehlen danach). */
export function withoutVault(backup) {
  const result = { ...backup };
  delete result.vault;
  return result;
}

/**
 * Prüft eine eingelesene Sicherung und liefert sie zurück – oder wirft einen verständlichen Fehler.
 * @param {string|object} input Dateiinhalt oder bereits gelesenes Objekt
 */
export function parseBackup(input) {
  let backup = input;
  if (typeof input === 'string') {
    try { backup = JSON.parse(input); } catch { throw new Error('Die Datei ist keine gültige Sicherung (kein JSON).'); }
  }
  if (!backup || backup.app !== BACKUP_APP) throw new Error('Die Datei ist keine FeedYourself-Sicherung.');
  if (typeof backup.format !== 'number' || backup.format > BACKUP_FORMAT) {
    throw new Error('Die Sicherung stammt aus einer neueren Version der App und kann hier nicht eingespielt werden.');
  }
  const data = backup.data ?? {};
  for (const name of STORES) {
    if (data[name] === undefined && OPTIONAL.has(name)) data[name] = [];
    if (!Array.isArray(data[name])) throw new Error(`Die Sicherung ist unvollständig (${name} fehlt).`);
  }
  const fail = (what) => { throw new Error(`Die Sicherung ist beschädigt (${what}).`); };
  // IDs landen in HTML-Attributen – eine Sicherung kann von fremder Hand stammen, darum nur sichere Form.
  const categoryIds = new Set();
  for (const c of data.categories) {
    if (!isSafeId(c?.id) || typeof c.key !== 'string' || typeof c.name !== 'string' || typeof c.sortOrder !== 'number') fail('Kategorie');
    categoryIds.add(c.id);
  }
  const productIds = new Set();
  for (const p of data.products) {
    if (!isSafeId(p?.id) || typeof p.name !== 'string' || !Array.isArray(p.synonyms ?? [])) fail('Produkt');
    productIds.add(p.id);
  }
  for (const e of data.entries) {
    if (!isSafeId(e?.id) || !productIds.has(e.productId) || !(e.quantity > 0) || !validUnit(e.unit) || !STATUSES.has(e.status)) fail('Listeneintrag');
  }
  for (const m of data.meta) {
    if (typeof m?.key !== 'string') fail('Einstellungen');
  }
  for (const photo of data.photos) {
    if (!productIds.has(photo?.productId) || typeof photo.dataUrl !== 'string' || !photo.dataUrl.startsWith('data:image/')) fail('Foto');
  }
  if (data.categories.length === 0) fail('keine Kategorien');
  if (backup.vault !== undefined) {
    const v = backup.vault;
    const b64 = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x);
    if (!v || v.v !== VAULT_FORMAT || v.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(v.iterations)
      || v.iterations < VAULT_LIMITS.min || v.iterations > VAULT_LIMITS.max || !b64(v.salt) || !b64(v.iv) || !b64(v.data)) fail('Zugänge');
  }
  return backup;
}

/**
 * Ersetzt alle Daten durch die Sicherung (vorher mit parseBackup prüfen).
 * @param {{lastBackupAt?: number|null, keepAccess?: object[]|null}} [options]
 *   keepAccess: bisheriger `meta`-Inhalt des Geräts – dessen Zugänge zu gemeinsamen Listen bleiben, soweit die Sicherung
 *   keine eigenen für dieselbe Liste mitbringt (eine Sicherung ohne Passwort soll bestehende Zugänge nicht löschen).
 */
export async function restoreBackup(store, backup, { lastBackupAt = null, keepAccess = null } = {}) {
  const contents = Object.fromEntries(STORES.map((name) => [name, backup.data[name]]));
  if (keepAccess) contents.meta = mergeAccess(contents.meta, keepAccess);
  if (lastBackupAt) contents.meta = [...contents.meta.filter((m) => m.key !== LAST_BACKUP_KEY), { key: LAST_BACKUP_KEY, value: lastBackupAt }];
  if (store.replaceAll) {
    await store.replaceAll(contents);
    return;
  }
  for (const name of STORES) {
    await store.clear(name);
    await store.putMany(name, contents[name]);
  }
}

function mergeAccess(incoming, current) {
  const keys = new Set(incoming.map((m) => m.key));
  const kept = current.filter((m) => isAccessKey(m.key) && !keys.has(m.key));
  if (!kept.length) return incoming;
  // Damit die Listenauswahl die behaltenen gemeinsamen Listen weiter zeigt
  const ownLists = current.find((m) => m.key === LISTS_KEY)?.value ?? [];
  const keptIds = new Set(kept.filter((m) => m.key.startsWith(ACCESS_PREFIX)).map((m) => m.key.slice(ACCESS_PREFIX.length)));
  return [...incoming, ...kept].map((m) => {
    if (m.key !== LISTS_KEY || !Array.isArray(m.value)) return m;
    const known = new Set(m.value.map((l) => l.id));
    const extra = ownLists.filter((l) => l.kind === 'shared' && keptIds.has(l.id) && !known.has(l.id));
    return extra.length ? { ...m, value: [...m.value, ...extra] } : m;
  });
}
