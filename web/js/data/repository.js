// Zugriff auf Kategorien, Produkte und die Einkaufsliste.
// Ansichten und das ListModel sprechen nur hiermit, nie direkt mit dem Speicher –
// so lässt sich später ein Sync (z. B. für die Browser-Ansicht anderer) ergänzen.

import { DEFAULT_UNIT, isUnit, normalizeQuantity, stepUp, UNITS, unitOf } from '../units.js';
import { accessCount, createBackup, LAST_BACKUP_KEY, restoreBackup, sealBackup } from './backup.js';

export const FALLBACK_CATEGORY = 'sonst';
export const DELETED_CATEGORIES_KEY = 'deletedCategoryKeys';

/**
 * @typedef {{id: string, key: string, name: string, sortOrder: number}} Category
 * @typedef {{id: string, catalogId: string|null, name: string, synonyms: string[], categoryId: string|null,
 *   isCustom: boolean, purchaseCount: number, lastPurchasedAt: number|null, lastQuantity: number, lastNote: string,
 *   unit?: string, lastUnit?: string}} Product   (unit: Standard-Einheit, fehlt = Stück)
 * @typedef {'open'|'inCart'|'later'} EntryStatus
 * @typedef {{id: string, productId: string, quantity: number, unit?: string, note: string, status: EntryStatus, addedAt: number}} Entry
 * @typedef {Entry & {product: Product}} ListItem
 */

/**
 * Zufällige ID. crypto.randomUUID gibt es nur über HTTPS bzw. localhost –
 * beim Testen im WLAN (http://192.168…) wird sie aus getRandomValues gebildet.
 */
export function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const byName = (a, b) => a.name.localeCompare(b.name, 'de');
const normalizeName = (name) => name.trim().toLocaleLowerCase('de');

export class ShoppingRepository {
  /** @param {import('../storage/memory-store.js').MemoryStore} store */
  constructor(store, { now = () => Date.now() } = {}) {
    this.store = store;
    this.now = now;
  }

  /** @returns {Promise<Category[]>} */
  async categories() {
    return (await this.store.getAll('categories')).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** @returns {Promise<Product[]>} */
  async products() {
    return (await this.store.getAll('products')).sort(byName);
  }

  /** Alle Einträge der aktiven Liste, älteste zuerst. @returns {Promise<ListItem[]>} */
  async listItems() {
    const [entries, products] = await Promise.all([this.store.getAll('entries'), this.store.getAll('products')]);
    const productsById = new Map(products.map((p) => [p.id, p]));
    return entries
      .filter((e) => productsById.has(e.productId))
      .sort((a, b) => a.addedAt - b.addedAt)
      .map((e) => ({ ...e, product: productsById.get(e.productId) }));
  }

  /**
   * Legt das Produkt auf die Liste. Steht es schon drauf (nicht im Wagen), wird die Menge um eine Stufe erhöht.
   * Einheit: die des Produkts. Ohne Angaben werden Menge und Anmerkung vom letzten Einkauf übernommen
   * (die Menge nur, wenn damals dieselbe Einheit galt).
   * @returns {Promise<{type: 'added'|'incremented', item: ListItem, previousQuantity?: number}>}
   */
  async add(productId, { quantity, note } = {}) {
    const product = await this.store.get('products', productId);
    if (!product) throw new Error('Produkt nicht gefunden');

    const entries = await this.store.getAll('entries');
    const existing = entries.find((e) => e.productId === productId && e.status !== 'inCart');
    if (existing) {
      const previousQuantity = existing.quantity;
      const updated = { ...existing, quantity: stepUp(existing.quantity, unitOf(existing)), status: 'open' };
      await this.store.put('entries', updated);
      return { type: 'incremented', item: { ...updated, product }, previousQuantity };
    }

    const unit = unitOf(product);
    const remembered = (product.lastUnit ?? DEFAULT_UNIT) === unit ? product.lastQuantity : null;
    const entry = {
      id: newId(),
      productId,
      quantity: normalizeQuantity(quantity ?? remembered ?? UNITS[unit].initial, unit),
      unit,
      note: note ?? product.lastNote ?? '',
      status: 'open',
      addedAt: this.now(),
    };
    await this.store.put('entries', entry);
    return { type: 'added', item: { ...entry, product } };
  }

  /** Neues eigenes Produkt, z. B. aus „… als neues Produkt anlegen“. @returns {Promise<Product>} */
  async createProduct(name, categoryId = null) {
    const categories = await this.categories();
    const category = categories.find((c) => c.id === categoryId)
      ?? categories.find((c) => c.key === FALLBACK_CATEGORY)
      ?? categories.at(-1);
    const product = {
      id: newId(),
      catalogId: null,
      name: name.trim(),
      synonyms: [],
      categoryId: category?.id ?? null,
      isCustom: true,
      purchaseCount: 0,
      lastPurchasedAt: null,
      lastQuantity: 1,
      lastNote: '',
      unit: DEFAULT_UNIT,
    };
    await this.store.put('products', product);
    return product;
  }

  async setQuantity(entryId, quantity) {
    const entry = await this.store.get('entries', entryId);
    if (!entry) throw new Error('Eintrag nicht gefunden');
    await this.#update(entryId, { quantity: normalizeQuantity(quantity, unitOf(entry)) });
  }

  /** Einheit eines Eintrags ändern; die Menge springt auf den Startwert der neuen Einheit. */
  async setEntryUnit(entryId, unit) {
    if (!isUnit(unit)) throw new Error('Unbekannte Einheit');
    const entry = await this.store.get('entries', entryId);
    if (!entry) throw new Error('Eintrag nicht gefunden');
    if (unitOf(entry) === unit) return entry;
    await this.store.put('entries', { ...entry, unit, quantity: UNITS[unit].initial });
    return entry;
  }

  /** Setzt einen Eintrag auf einen früheren Stand zurück (für „Rückgängig“). */
  async replaceEntry(entry) {
    const { product, ...plain } = entry;
    await this.store.put('entries', plain);
  }

  /** Standard-Einheit eines Produkts (gilt ab dem nächsten Hinzufügen). */
  async setProductUnit(productId, unit) {
    if (!isUnit(unit)) throw new Error('Unbekannte Einheit');
    const product = await this.store.get('products', productId);
    if (!product) throw new Error('Produkt nicht gefunden');
    await this.store.put('products', { ...product, unit });
    return unitOf(product);
  }

  /** Merkt sich, dass eigene Produkte für den Katalog vorgeschlagen wurden. */
  async markSuggested(productIds, at = new Date().toISOString()) {
    for (const id of productIds) {
      const product = await this.store.get('products', id);
      if (product) await this.store.put('products', { ...product, suggestedAt: at });
    }
  }

  /** Eigene Produkte aus der Vorschlagsliste nehmen (hidden) oder wieder aufnehmen. Das Produkt selbst bleibt. */
  async setSuggestHidden(productIds, hidden) {
    for (const id of productIds) {
      const product = await this.store.get('products', id);
      if (!product) continue;
      const { suggestHidden, ...rest } = product;
      await this.store.put('products', hidden ? { ...rest, suggestHidden: true } : rest);
    }
  }

  async setNote(entryId, note) {
    await this.#update(entryId, { note });
  }

  async remove(entryId) {
    await this.store.delete('entries', entryId);
  }

  // ---------------------------------------------------------------- Kategorien

  async renameCategory(categoryId, name) {
    const category = await this.store.get('categories', categoryId);
    if (!category) throw new Error('Kategorie nicht gefunden');
    await this.store.put('categories', { ...category, name });
  }

  /** Neue Reihenfolge (Laufweg im Laden) als Liste von Kategorie-IDs. */
  async reorderCategories(ids) {
    const position = new Map(ids.map((id, index) => [id, index]));
    const categories = await this.categories();
    const ordered = [...categories].sort((a, b) =>
      (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity) || a.sortOrder - b.sortOrder);
    await this.#saveOrder(ordered);
  }

  /** Neue eigene Kategorie, direkt vor „Sonstiges“. @returns {Promise<Category>} */
  async addCategory(name) {
    const categories = await this.categories();
    const category = { id: newId(), key: `eigene-${newId().slice(0, 8)}`, name, sortOrder: 0 };
    const at = categories.findIndex((c) => c.key === FALLBACK_CATEGORY);
    categories.splice(at < 0 ? categories.length : at, 0, category);
    await this.#saveOrder(categories);
    return { ...category, sortOrder: categories.indexOf(category) };
  }

  /**
   * Löscht eine Kategorie; ihre Produkte wandern nach „Sonstiges“.
   * Der Schlüssel wird gemerkt, damit ein späteres Katalog-Update sie nicht wieder anlegt.
   * @returns {Promise<{category: Category, productIds: string[]}>} zum Wiederherstellen
   */
  async deleteCategory(categoryId) {
    const category = await this.store.get('categories', categoryId);
    if (!category) throw new Error('Kategorie nicht gefunden');
    if (category.key === FALLBACK_CATEGORY) throw new Error('„Sonstiges“ lässt sich nicht löschen.');
    const fallback = (await this.categories()).find((c) => c.key === FALLBACK_CATEGORY);
    const products = (await this.store.getAll('products')).filter((p) => p.categoryId === categoryId);
    await this.store.putMany('products', products.map((p) => ({ ...p, categoryId: fallback?.id ?? null })));
    await this.store.delete('categories', categoryId);
    await this.#setDeletedKeys((keys) => [...new Set([...keys, category.key])]);
    return { category, productIds: products.map((p) => p.id) };
  }

  /** Macht `deleteCategory` rückgängig. */
  async restoreCategory({ category, productIds }) {
    await this.store.put('categories', category);
    const ids = new Set(productIds);
    const products = (await this.store.getAll('products')).filter((p) => ids.has(p.id));
    await this.store.putMany('products', products.map((p) => ({ ...p, categoryId: category.id })));
    await this.#setDeletedKeys((keys) => keys.filter((k) => k !== category.key));
    const ordered = (await this.categories()).sort((a, b) =>
      a.sortOrder - b.sortOrder || (a.id === category.id ? -1 : b.id === category.id ? 1 : 0));
    await this.#saveOrder(ordered);
  }

  async #saveOrder(categories) {
    await this.store.putMany('categories', categories.map((c, index) => ({ ...c, sortOrder: index })));
  }

  async #setDeletedKeys(change) {
    const keys = (await this.store.get('meta', DELETED_CATEGORIES_KEY))?.value ?? [];
    await this.store.put('meta', { key: DELETED_CATEGORIES_KEY, value: change(keys) });
  }

  // ---------------------------------------------------------------- Eigene Fotos

  /** @returns {Promise<Map<string, string>>} Produkt-ID → Bild (Data-URL) */
  async photos() {
    return new Map((await this.store.getAll('photos')).map((p) => [p.productId, p.dataUrl]));
  }

  /** Speichert ein eigenes Foto; liefert das vorherige (oder null) zum Rückgängigmachen. */
  async setPhoto(productId, dataUrl) {
    const previous = (await this.store.get('photos', productId))?.dataUrl ?? null;
    await this.store.put('photos', { productId, dataUrl, updatedAt: this.now() });
    return previous;
  }

  /** Entfernt das eigene Foto (zurück zum Standardbild); liefert es zum Rückgängigmachen. */
  async removePhoto(productId) {
    const previous = (await this.store.get('photos', productId))?.dataUrl ?? null;
    await this.store.delete('photos', productId);
    return previous;
  }

  // ---------------------------------------------------------------- Sicherung

  /** Gerätespeicher ohne Listen-Weiche – die Sicherung umfasst alle Listen. */
  get #deviceStore() {
    return this.store.base ?? this.store;
  }

  /** Vollständiger Stand im Klartext – nur für interne Zwecke (Rückgängig, Tests), nie als Datei. */
  exportBackup() {
    return createBackup(this.#deviceStore, this.now());
  }

  /**
   * Inhalt der Sicherungsdatei: Zugänge zu gemeinsamen Listen nur mit Passwort (verschlüsselt), sonst ohne sie.
   * @returns {Promise<{backup: object, sealed: number, dropped: number}>}
   */
  async exportFile({ password = '', iterations } = {}) {
    return sealBackup(await this.exportBackup(), password, iterations ? { iterations } : undefined);
  }

  /** Zugänge zu gemeinsamen Listen auf diesem Gerät (sie brauchen in der Sicherung ein Passwort). */
  async accessCount() {
    return accessCount(await this.exportBackup());
  }

  async markBackedUp() {
    await this.store.put('meta', { key: LAST_BACKUP_KEY, value: this.now() });
  }

  /** @returns {Promise<number|null>} Zeitpunkt der letzten Sicherung */
  async lastBackupAt() {
    return (await this.store.get('meta', LAST_BACKUP_KEY))?.value ?? null;
  }

  /** Ersetzt alle Daten; liefert den vorherigen Stand zum Rückgängigmachen. */
  async importBackup(backup) {
    const previous = await createBackup(this.#deviceStore, this.now());
    const lastBackupAt = await this.lastBackupAt();
    // Zugänge, die dieses Gerät schon hat, bleiben – auch wenn die Sicherung (ohne Passwort) keine mitbringt.
    await restoreBackup(this.#deviceStore, backup, { lastBackupAt, keepAccess: previous.data.meta });
    return { previous, lastBackupAt, whole: true };
  }

  /** Macht ein Einspielen rückgängig – eine ganze Sicherung im Gerätespeicher, eine geteilte Liste in der aktiven Liste. */
  async undoImport({ previous, lastBackupAt, whole = false }) {
    await restoreBackup(whole ? this.#deviceStore : this.store, previous, { lastBackupAt });
  }

  // ---------------------------------------------------------------- Geteilte Liste übernehmen

  /**
   * Fügt geteilte Einträge zur eigenen Liste hinzu (ersetzt nichts).
   * Produkte werden über die Katalog-ID, sonst über den Namen gefunden; unbekannte werden angelegt.
   * Steht ein Produkt schon auf der Liste, gilt die größere Menge, die Anmerkung wird ergänzt.
   * @returns {Promise<{added: number, updated: number, created: number, snapshot: object}>}
   */
  async importSharedItems(items) {
    const snapshot = await createBackup(this.store, this.now());
    const categories = await this.categories();
    const fallback = categories.find((c) => c.key === FALLBACK_CATEGORY);
    const products = await this.store.getAll('products');
    const entries = await this.store.getAll('entries');
    const byCatalogId = new Map(products.filter((p) => p.catalogId).map((p) => [p.catalogId, p]));
    const byName = new Map(products.map((p) => [normalizeName(p.name), p]));
    const result = { added: 0, updated: 0, created: 0, snapshot };

    for (const item of items) {
      let product = (item.catalogId && byCatalogId.get(item.catalogId)) || byName.get(normalizeName(item.name));
      if (!product) {
        const category = categories.find((c) => c.key === item.categoryKey) ?? fallback;
        product = {
          id: newId(), catalogId: null, name: item.name, synonyms: [], categoryId: category?.id ?? null,
          isCustom: true, purchaseCount: 0, lastPurchasedAt: null, lastQuantity: 1, lastNote: '', unit: unitOf(item),
        };
        await this.store.put('products', product);
        byName.set(normalizeName(product.name), product);
        result.created++;
      }
      const existing = entries.find((e) => e.productId === product.id && e.status !== 'inCart');
      if (existing) {
        const notes = [existing.note, item.note].filter(Boolean);
        const note = notes.length === 2 && notes[0] !== notes[1] ? `${notes[0]} / ${notes[1]}` : (notes[0] ?? '');
        const sameUnit = unitOf(existing) === unitOf(item);
        const quantity = sameUnit ? Math.max(existing.quantity, item.quantity) : existing.quantity;
        const merged = { ...existing, quantity, note, status: 'open' };
        await this.store.put('entries', merged);
        Object.assign(existing, merged);
        result.updated++;
      } else {
        const unit = unitOf(item);
        const entry = { id: newId(), productId: product.id, quantity: normalizeQuantity(item.quantity, unit), unit, note: item.note, status: 'open', addedAt: this.now() };
        await this.store.put('entries', entry);
        entries.push(entry);
        result.added++;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- Einkauf

  /** Offen, im Wagen oder zurückgestellt. */
  async setStatus(entryId, status) {
    await this.#update(entryId, { status, checkedAt: status === 'open' ? null : this.now() });
  }

  /**
   * Einkauf abschließen: Was im Wagen liegt, gilt als gekauft – der Eintrag verschwindet,
   * am Produkt werden Anzahl, Datum, Menge und Anmerkung für „Zuletzt gekauft“ gemerkt.
   * Zurückgestellte und offene Einträge bleiben für den nächsten Einkauf (wieder offen).
   * @returns {Promise<{bought: number, kept: number}>}
   */
  async finishShopping() {
    const [entries, products] = await Promise.all([this.store.getAll('entries'), this.store.getAll('products')]);
    const productsById = new Map(products.map((p) => [p.id, p]));
    const now = this.now();
    let bought = 0;
    let kept = 0;
    for (const entry of entries) {
      if (entry.status === 'inCart') {
        const product = productsById.get(entry.productId);
        if (product) {
          await this.store.put('products', {
            ...product,
            purchaseCount: (product.purchaseCount ?? 0) + 1,
            lastPurchasedAt: now,
            lastQuantity: entry.quantity,
            lastUnit: unitOf(entry),
            lastNote: entry.note,
          });
        }
        await this.store.delete('entries', entry.id);
        bought++;
      } else {
        if (entry.status === 'later') await this.store.put('entries', { ...entry, status: 'open', checkedAt: null });
        kept++;
      }
    }
    return { bought, kept };
  }

  /** Stellt einen entfernten Eintrag unverändert wieder her (für „Rückgängig“). */
  async restore(item) {
    if (await this.store.get('entries', item.id)) return;
    const { product, ...entry } = item;
    await this.store.put('entries', entry);
  }

  async #update(entryId, changes) {
    const entry = await this.store.get('entries', entryId);
    if (!entry) throw new Error('Eintrag nicht gefunden');
    await this.store.put('entries', { ...entry, ...changes });
  }
}
