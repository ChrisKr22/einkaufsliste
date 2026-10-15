// Dauerhafter Speicher im Browser (IndexedDB). Daten bleiben auf dem Gerät.

const DB_NAME = 'feedyourself';
const DB_VERSION = 2;   // 2: eigene Produktfotos

export async function openIdbStore(name = DB_NAME) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of ['categories', 'products', 'entries']) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'productId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Die Datenbank ist in einem anderen Tab geöffnet.'));
  });
  return new IdbStore(db);
}

export class IdbStore {
  constructor(db) {
    this.db = db;
    this.persistent = true;
  }

  #run(store, mode, work) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const request = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Speichern abgebrochen'));
    });
  }

  getAll(store) {
    return this.#run(store, 'readonly', (os) => os.getAll());
  }

  get(store, key) {
    return this.#run(store, 'readonly', (os) => os.get(key));
  }

  put(store, value) {
    return this.#run(store, 'readwrite', (os) => { os.put(value); });
  }

  putMany(store, values) {
    return this.#run(store, 'readwrite', (os) => { for (const value of values) os.put(value); });
  }

  delete(store, key) {
    return this.#run(store, 'readwrite', (os) => { os.delete(key); });
  }

  clear(store) {
    return this.#run(store, 'readwrite', (os) => { os.clear(); });
  }

  /** Mehrere Speicher in einem Schritt leeren und neu befüllen – ganz oder gar nicht. */
  replaceAll(contents) {
    const stores = Object.keys(contents);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');
      for (const name of stores) {
        const os = tx.objectStore(name);
        os.clear();
        for (const value of contents[name]) os.put(value);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Einspielen abgebrochen'));
    });
  }
}
