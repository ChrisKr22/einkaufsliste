// Speicher-Weiche für eine gemeinsame Liste: Solange sie aktiv ist, kommen die Listeneinträge aus der Replica
// (gemeinsam, abgeglichen); Kategorien, Produkte, Fotos und Einstellungen bleiben im Speicher des Geräts.
// Das Repository und alle Ansichten arbeiten unverändert – sie sehen nur einen Speicher mit derselben Schnittstelle.
// Die private Liste bleibt im Gerätespeicher liegen und ist wieder da, sobald man die gemeinsame Liste verlässt.
//
// Produkte haben auf jedem Gerät eigene IDs. In der Replica steht darum ein Verweis:
//   c:<Katalog-ID>   für Katalogprodukte
//   s:<gemeinsame ID> für eigene Produkte – dazu ein Datensatz „product“ mit Name, Kategorie und Einheit.
// Kennt ein Gerät ein Produkt noch nicht, legt es dieses beim Lesen an.

import { FALLBACK_CATEGORY, newId } from '../data/repository.js';

const ENTRY_FIELDS = ['quantity', 'unit', 'note', 'status', 'addedAt', 'checkedAt'];
const normalizeName = (name) => String(name ?? '').trim().toLocaleLowerCase('de');

export function productRef(product) {
  return product.catalogId ? `c:${product.catalogId}` : `s:${product.sharedId ?? product.id}`;
}

export class SharedStore {
  /**
   * @param {object} base  Gerätespeicher (IdbStore oder MemoryStore)
   * @param {import('./replica.js').Replica} replica
   * @param {{onChange?: () => void}} [options]  nach jeder eigenen Änderung (Speichern, Verschicken)
   */
  constructor(base, replica, { onChange = () => {} } = {}) {
    this.base = base;
    this.replica = replica;
    this.onChange = onChange;
    this.persistent = base.persistent;
    this.lock = Promise.resolve();
  }

  /** Lesen der Einträge legt ggf. Produkte an – immer nacheinander, sonst entstünden doppelte. */
  #entries() {
    const run = this.lock.then(() => this.#readEntries());
    this.lock = run.catch(() => {});
    return run;
  }

  // ---------------------------------------------------------------- Schnittstelle wie MemoryStore/IdbStore

  async getAll(store) {
    if (store === 'entries') return this.#entries();
    // Produkte erst nach dem Anlegen fehlender (aus der gemeinsamen Liste) liefern
    if (store === 'products') await this.#entries();
    return this.base.getAll(store);
  }

  async get(store, key) {
    if (store !== 'entries') return this.base.get(store, key);
    return (await this.#entries()).find((e) => e.id === key);
  }

  async put(store, value) {
    if (store === 'entries') await this.#putEntry(value);
    else {
      await this.base.put(store, value);
      if (store === 'products') this.#syncProduct(value, await this.#categoryKeys());
    }
    this.onChange();
  }

  async putMany(store, values) {
    if (store !== 'entries') {
      await this.base.putMany(store, values);
      if (store === 'products') {
        const keys = await this.#categoryKeys();
        for (const value of values) this.#syncProduct(value, keys);
      }
    } else {
      for (const value of values) await this.#putEntry(value);
    }
    this.onChange();
  }

  async delete(store, key) {
    if (store === 'entries') this.#removeEntry(key);
    else await this.base.delete(store, key);
    this.onChange();
  }

  async clear(store) {
    if (store === 'entries') for (const entry of this.replica.all('entry')) this.#removeEntry(entry.id);
    else await this.base.clear(store);
    this.onChange();
  }

  /** Wie IdbStore.replaceAll; die Einträge gehen in die gemeinsame Liste, die private Liste bleibt, wie sie ist. */
  async replaceAll(contents) {
    const { entries, ...rest } = contents;
    if (Object.keys(rest).length) {
      if (this.base.replaceAll) await this.base.replaceAll({ ...rest, entries: await this.base.getAll('entries') });
      else for (const [name, values] of Object.entries(rest)) { await this.base.clear(name); await this.base.putMany(name, values); }
    }
    if (entries) {
      const keep = new Set(entries.map((e) => e.id));
      for (const entry of this.replica.all('entry')) if (!keep.has(entry.id)) this.#removeEntry(entry.id);
      for (const entry of entries) await this.#putEntry(entry);
    }
    this.onChange();
  }

  // ---------------------------------------------------------------- Einträge

  async #categoryKeys() {
    const categories = await this.base.getAll('categories');
    return { byId: new Map(categories.map((c) => [c.id, c.key])), byKey: new Map(categories.map((c) => [c.key, c.id])) };
  }

  async #readEntries() {
    const records = this.replica.all('entry');
    if (!records.length) return [];
    const products = await this.base.getAll('products');
    const byRef = new Map();
    const customByName = new Map();
    for (const p of products) {
      byRef.set(productRef(p), p);
      if (!p.catalogId) {
        byRef.set(`s:${p.id}`, p);
        customByName.set(normalizeName(p.name), p);
      }
    }
    let categories = null;
    const result = [];
    for (const record of records) {
      if (typeof record.ref !== 'string') continue;
      let product = byRef.get(record.ref);
      if (!product) {
        categories ??= await this.#categoryKeys();
        product = await this.#materialize(record, categories, customByName);
        byRef.set(record.ref, product);
      }
      const entry = { id: record.id, productId: product.id };
      for (const field of ENTRY_FIELDS) if (record[field] !== undefined && record[field] !== null) entry[field] = record[field];
      entry.note ??= '';
      entry.status ??= 'open';
      entry.addedAt ??= 0;
      if (!(entry.quantity > 0)) entry.quantity = 1;
      result.push(entry);
    }
    return result;
  }

  /** Produkt, das ein anderes Gerät auf die Liste gesetzt hat, hier anlegen (bzw. ein gleichnamiges eigenes verknüpfen). */
  async #materialize(record, categories, customByName) {
    const shared = record.ref.startsWith('s:') ? record.ref.slice(2) : null;
    const info = (shared && this.replica.get('product', shared)) || {};
    const name = String(info.name ?? record.name ?? 'Unbekanntes Produkt').slice(0, 80);
    const categoryKey = info.cat ?? record.cat;
    if (shared) {
      const sameName = customByName.get(normalizeName(name));
      if (sameName) {
        const linked = { ...sameName, sharedId: shared };
        await this.base.put('products', linked);
        return linked;
      }
    }
    const product = {
      id: shared ?? newId(),
      catalogId: shared ? null : record.ref.slice(2),
      name,
      synonyms: [],
      categoryId: categories.byKey.get(categoryKey) ?? categories.byKey.get(FALLBACK_CATEGORY) ?? null,
      isCustom: Boolean(shared),
      purchaseCount: 0,
      lastPurchasedAt: null,
      lastQuantity: 1,
      lastNote: '',
      unit: info.unit ?? record.unit ?? 'stk',
    };
    await this.base.put('products', product);
    return product;
  }

  async #putEntry(entry) {
    const product = await this.base.get('products', entry.productId);
    if (!product) throw new Error('Produkt nicht gefunden');
    const keys = await this.#categoryKeys();
    const fields = { ref: productRef(product), name: product.name, cat: keys.byId.get(product.categoryId) ?? null };
    for (const field of ENTRY_FIELDS) fields[field] = entry[field] ?? null;
    const current = this.replica.get('entry', entry.id);
    if (!current) {
      this.replica.set('entry', entry.id, { ...fields, _del: false });
    } else {
      // Nur geänderte Felder schreiben – sonst überschriebe eine Änderung die gleichzeitige eines anderen Geräts.
      const changed = {};
      for (const [field, value] of Object.entries(fields)) {
        if (JSON.stringify(current[field] ?? null) !== JSON.stringify(value)) changed[field] = value;
      }
      if (Object.keys(changed).length) this.replica.set('entry', entry.id, changed);
    }
    this.#syncProduct(product, keys);   // erst jetzt steht fest, dass das Produkt auf der Liste ist
  }

  #removeEntry(id) {
    const current = this.replica.get('entry', id);
    if (!current) return;
    // Was beim Entfernen im Wagen lag, wurde gekauft (Einkauf abgeschlossen) – andere Geräte merken es sich für „Zuletzt gekauft“.
    this.replica.remove('entry', id, { bought: current.status === 'inCart' });
  }

  /** Eigene Produkte, die auf der gemeinsamen Liste stehen (oder standen), mit Name, Kategorie und Einheit teilen. */
  #syncProduct(product, keys) {
    if (!product || product.catalogId) return;
    const id = product.sharedId ?? product.id;
    const fields = { name: product.name, cat: keys.byId.get(product.categoryId) ?? null, unit: product.unit ?? 'stk' };
    const current = this.replica.get('product', id);
    const used = current || this.replica.all('entry').some((e) => e.ref === `s:${id}`);
    if (!used) return;
    const changed = {};
    for (const [field, value] of Object.entries(fields)) if ((current?.[field] ?? null) !== value) changed[field] = value;
    if (Object.keys(changed).length) this.replica.set('product', id, current ? changed : { ...changed, _del: false });
  }
}
