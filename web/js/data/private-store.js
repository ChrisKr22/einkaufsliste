// Speicher-Weiche für eine private Liste: Alle privaten Listen liegen im selben Gerätespeicher, jeder Eintrag trägt
// die ID seiner Liste. Einträge ohne Listen-ID (aus der Zeit vor mehreren Listen) gehören zu „Meine Liste“.
// Kategorien, Produkte, Fotos und Einstellungen teilen sich alle Listen. Gleiche Schnittstelle wie MemoryStore/IdbStore.

export const DEFAULT_LIST_ID = 'default';

export const entryListId = (entry) => entry.listId ?? DEFAULT_LIST_ID;

export class PrivateStore {
  constructor(base, listId = DEFAULT_LIST_ID) {
    this.base = base;
    this.listId = listId;
    this.persistent = base.persistent;
  }

  #mine = (entry) => entryListId(entry) === this.listId;
  #tag = (entry) => ({ ...entry, listId: this.listId });

  async getAll(store) {
    const all = await this.base.getAll(store);
    return store === 'entries' ? all.filter(this.#mine) : all;
  }

  async get(store, key) {
    const value = await this.base.get(store, key);
    return store === 'entries' && value && !this.#mine(value) ? undefined : value;
  }

  put(store, value) {
    return this.base.put(store, store === 'entries' ? this.#tag(value) : value);
  }

  putMany(store, values) {
    return this.base.putMany(store, store === 'entries' ? values.map(this.#tag) : values);
  }

  async delete(store, key) {
    if (store === 'entries' && !(await this.get(store, key))) return;
    await this.base.delete(store, key);
  }

  async clear(store) {
    if (store !== 'entries') return this.base.clear(store);
    for (const entry of await this.getAll('entries')) await this.base.delete('entries', entry.id);
  }

  /** Wie IdbStore.replaceAll – bei den Einträgen nur die dieser Liste; die anderen Listen bleiben unberührt. */
  async replaceAll(contents) {
    const next = { ...contents };
    if (contents.entries) {
      const others = (await this.base.getAll('entries')).filter((e) => !this.#mine(e));
      next.entries = [...others, ...contents.entries.map(this.#tag)];
    }
    if (this.base.replaceAll) return this.base.replaceAll(next);
    for (const [name, values] of Object.entries(next)) {
      await this.base.clear(name);
      await this.base.putMany(name, values);
    }
  }
}
