// Speicher im Arbeitsspeicher – für Tests und als Notlösung, falls IndexedDB nicht verfügbar ist.
// Gleiche Schnittstelle wie IdbStore.

export const STORES = ['categories', 'products', 'entries', 'meta', 'photos'];
const KEY = { categories: 'id', products: 'id', entries: 'id', meta: 'key', photos: 'productId' };

export class MemoryStore {
  constructor() {
    this.data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
    this.persistent = false;
  }

  async getAll(store) {
    return [...this.data[store].values()].map((v) => structuredClone(v));
  }

  async get(store, key) {
    const value = this.data[store].get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  async put(store, value) {
    this.data[store].set(value[KEY[store]], structuredClone(value));
  }

  async putMany(store, values) {
    for (const value of values) await this.put(store, value);
  }

  async delete(store, key) {
    this.data[store].delete(key);
  }

  async clear(store) {
    this.data[store].clear();
  }
}
