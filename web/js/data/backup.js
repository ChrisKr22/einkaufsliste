// Sicherung: alle Daten als eine JSON-Datei exportieren und wieder einspielen.

export const BACKUP_APP = 'FeedYourself';
export const BACKUP_FORMAT = 1;
export const LAST_BACKUP_KEY = 'lastBackupAt';
const STORES = ['categories', 'products', 'entries', 'meta', 'photos'];
const OPTIONAL = new Set(['photos']);   // ältere Sicherungen haben noch keine Fotos
const STATUSES = new Set(['open', 'inCart', 'later']);

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
  return { categories: categories.length, products: products.length, entries: entries.length, photos: photos.length, exportedAt: backup.exportedAt };
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
  const categoryIds = new Set();
  for (const c of data.categories) {
    if (typeof c?.id !== 'string' || typeof c.key !== 'string' || typeof c.name !== 'string' || typeof c.sortOrder !== 'number') fail('Kategorie');
    categoryIds.add(c.id);
  }
  const productIds = new Set();
  for (const p of data.products) {
    if (typeof p?.id !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.synonyms ?? [])) fail('Produkt');
    productIds.add(p.id);
  }
  for (const e of data.entries) {
    if (typeof e?.id !== 'string' || !productIds.has(e.productId) || !(e.quantity >= 1) || !STATUSES.has(e.status)) fail('Listeneintrag');
  }
  for (const m of data.meta) {
    if (typeof m?.key !== 'string') fail('Einstellungen');
  }
  for (const photo of data.photos) {
    if (!productIds.has(photo?.productId) || typeof photo.dataUrl !== 'string' || !photo.dataUrl.startsWith('data:image/')) fail('Foto');
  }
  if (data.categories.length === 0) fail('keine Kategorien');
  return backup;
}

/** Ersetzt alle Daten durch die Sicherung (vorher mit parseBackup prüfen). */
export async function restoreBackup(store, backup, { lastBackupAt = null } = {}) {
  const contents = Object.fromEntries(STORES.map((name) => [name, backup.data[name]]));
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
