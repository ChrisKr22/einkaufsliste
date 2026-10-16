// Listenverwaltung: mehrere Listen – private (nur auf diesem Gerät) und gemeinsame (über den Briefkasten).
// Merkt sich, welche Listen es gibt und welche geöffnet ist, und schaltet beim Wechsel den Speicher des Repositorys um:
// private Listen über PrivateStore (Einträge mit Listen-ID im Gerätespeicher), gemeinsame über die Steuerung SharedList.

import { DEFAULT_LIST_ID, PrivateStore, entryListId } from './data/private-store.js';
import { newId } from './data/repository.js';
import { LEGACY_SESSION_KEY, sessionKey } from './sync/shared-list.js';

export const LISTS_KEY = 'lists';
export const ACTIVE_KEY = 'activeList';
const DEFAULT_NAME = 'Meine Liste';

const cleanName = (name, fallback) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || fallback;

export class ListsManager {
  /**
   * @param {import('./list-model.js').ListModel} model
   * @param {object} base  Gerätespeicher
   * @param {import('./sync/shared-list.js').SharedList} shared
   */
  constructor(model, base, shared) {
    Object.assign(this, { model, base, shared });
    shared.lists = this;
    this.state = { lists: [], activeId: DEFAULT_LIST_ID };   // lists: [{ id, name, kind: 'private'|'shared' }]
    this.listeners = new Set();
    model.onDataReplaced = () => this.reload();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  get active() {
    return this.state.lists.find((l) => l.id === this.state.activeId) ?? this.state.lists[0];
  }

  has(listId) {
    return this.state.lists.some((l) => l.id === listId);
  }

  // ---------------------------------------------------------------- Start

  async init() {
    await this.#load();
    await this.shared.init();
    await this.#open(this.state.activeId);
  }

  /** Nach dem Einspielen einer Sicherung: Listen neu einlesen und die gemerkte öffnen. */
  async reload() {
    await this.shared.suspend();
    await this.#load();
    await this.#open(this.state.activeId);
  }

  async #load() {
    let lists = (await this.base.get('meta', LISTS_KEY))?.value;
    let activeId = (await this.base.get('meta', ACTIVE_KEY))?.value;
    if (!Array.isArray(lists) || !lists.length) {
      // Erster Start mit mehreren Listen: Die bisherige Liste heißt „Meine Liste“, eine gemeinsame wird übernommen.
      lists = [{ id: DEFAULT_LIST_ID, name: DEFAULT_NAME, kind: 'private' }];
      activeId = DEFAULT_LIST_ID;
      const legacy = (await this.base.get('meta', LEGACY_SESSION_KEY))?.value;
      if (legacy?.listId) {
        await this.base.put('meta', { key: sessionKey(legacy.listId), value: legacy });
        await this.base.delete('meta', LEGACY_SESSION_KEY);
        lists.push({ id: legacy.listId, name: legacy.name ?? 'Gemeinsame Liste', kind: 'shared' });
        activeId = legacy.listId;
      }
    }
    this.state = { lists, activeId: lists.some((l) => l.id === activeId) ? activeId : lists[0].id };
    await this.#save();
  }

  async #save() {
    await this.base.put('meta', { key: LISTS_KEY, value: this.state.lists });
    await this.base.put('meta', { key: ACTIVE_KEY, value: this.state.activeId });
  }

  async #open(id) {
    let list = this.state.lists.find((l) => l.id === id) ?? this.state.lists[0];
    if (list.kind === 'shared' && !(await this.shared.activate(list.id))) {
      // Gemeinsame Liste ohne gespeicherten Stand (z. B. aus einer alten Sicherung) – auslassen
      this.state.lists = this.state.lists.filter((l) => l.id !== list.id);
      list = this.state.lists.find((l) => l.kind === 'private') ?? await this.#ensurePrivate();
    }
    if (list.kind === 'private') {
      await this.shared.suspend();
      this.model.repository.store = new PrivateStore(this.base, list.id);
      await this.model.load();
    }
    this.state = { ...this.state, activeId: list.id };
    await this.#save();
    this.#emit();
  }

  async #ensurePrivate() {
    const list = { id: DEFAULT_LIST_ID, name: DEFAULT_NAME, kind: 'private' };
    this.state.lists = [list, ...this.state.lists];
    return list;
  }

  // ---------------------------------------------------------------- Wechseln, anlegen, umbenennen, löschen

  async switchTo(id) {
    if (id === this.state.activeId || !this.has(id)) return;
    await this.#open(id);
  }

  /** Neue private Liste (nur auf diesem Gerät) – wird gleich geöffnet. */
  async createPrivate(name) {
    const list = { id: newId(), name: cleanName(name, 'Neue Liste'), kind: 'private' };
    this.state = { ...this.state, lists: [...this.state.lists, list] };
    await this.#open(list.id);
    return list;
  }

  /** Neue gemeinsame Liste; adopt: Einträge der gerade offenen privaten Liste wandern hinein. */
  async createShared({ name, deviceName, adopt = false }) {
    await this.shared.create({ name, deviceName, adopt: adopt && this.active?.kind === 'private' });
  }

  async rename(id, name) {
    const list = this.state.lists.find((l) => l.id === id);
    if (!list || list.kind !== 'private') return;
    this.state = { ...this.state, lists: this.state.lists.map((l) => (l.id === id ? { ...l, name: cleanName(name, l.name) } : l)) };
    await this.#save();
    this.#emit();
  }

  /** Private Liste samt Einträgen löschen. Die letzte Liste bleibt immer stehen. */
  async deletePrivate(id) {
    const list = this.state.lists.find((l) => l.id === id);
    if (!list || list.kind !== 'private' || this.state.lists.length <= 1) return;
    for (const entry of await this.base.getAll('entries')) {
      if (entryListId(entry) === id) await this.base.delete('entries', entry.id);
    }
    this.state = { ...this.state, lists: this.state.lists.filter((l) => l.id !== id) };
    if (this.state.activeId === id) await this.#open(this.state.lists[0].id);
    else {
      await this.#save();
      this.#emit();
    }
  }

  // ---------------------------------------------------------------- Rückmeldungen der gemeinsamen Listen

  /** Neue gemeinsame Liste (angelegt oder beigetreten) – wird gleich geöffnet. */
  async added(session) {
    if (!this.has(session.listId)) this.state.lists = [...this.state.lists, { id: session.listId, name: session.name, kind: 'shared' }];
    this.state = { ...this.state, activeId: session.listId };
    await this.#save();
    this.#emit();
  }

  /** Gemeinsame Liste verlassen: aus der Übersicht nehmen und eine private öffnen. */
  async removed(listId) {
    this.state = { ...this.state, lists: this.state.lists.filter((l) => l.id !== listId) };
    const next = this.state.lists.find((l) => l.kind === 'private') ?? await this.#ensurePrivate();
    await this.#open(next.id);
  }

  /** Name einer gemeinsamen Liste kommt aus der Liste selbst; hier nur nachführen. */
  renamed(listId, name) {
    const list = this.state.lists.find((l) => l.id === listId);
    if (!list || !name || list.name === name) return;
    this.state = { ...this.state, lists: this.state.lists.map((l) => (l.id === listId ? { ...l, name } : l)) };
    this.#save();
    this.#emit();
  }
}
