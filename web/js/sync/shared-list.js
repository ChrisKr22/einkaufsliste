// Steuerung der gemeinsamen Liste (KONZEPT.md 8.4): anlegen, einladen, beitreten, bestätigen, verlassen, abgleichen.
// Hält ihren eigenen Zustand (für die Ansichten) und tauscht beim Aktivieren den Speicher des Repositorys aus.
// Dieses Gerät ist in höchstens einer gemeinsamen Liste (mehrere Listen mit Auswahl folgen später).

import { newListId, newListKey } from './crypto.js';
import { JoinConnection, ListConnection, SYNC_URL } from './client.js';
import { checkCode, inviteLink, inviteText, newDeviceKeys, newInviteSecret, openForDevice, parseInvite, sealForDevice } from './join.js';
import { Replica } from './replica.js';
import { productRef, SharedStore } from './shared-store.js';
import { newId } from '../data/repository.js';

export const SESSION_KEY = 'sharedList';
export const JOIN_KEY = 'sharedJoin';
const SYNC_MS = 5_000;
const PUSH_DELAY_MS = 1_200;
const JOIN_POLL_MS = 3_000;
const REQUESTS_EVERY = 3;        // jeder dritte Abgleich fragt nach Beitrittsanfragen und Plätzen
const COMPACT_AFTER = 200;       // so viele Änderungen nach dem Gesamtstand → neuen ablegen
const INVITE_KEEP_MS = 24 * 60 * 60_000;

export class SharedList {
  /**
   * @param {import('../list-model.js').ListModel} model
   * @param {object} base  Gerätespeicher
   * @param {{baseUrl?: string, fetch?: typeof fetch, now?: () => number, appUrl?: () => string, timers?: boolean}} [options]
   */
  constructor(model, base, { baseUrl = SYNC_URL, fetch: fetchFn, now = () => Date.now(), appUrl = () => '', timers = true } = {}) {
    Object.assign(this, { model, base, baseUrl, fetchFn, now, appUrl, timers });
    this.session = null;        // gespeicherter Stand der aktiven Liste
    this.replica = null;
    this.connection = null;
    this.joinData = null;
    this.state = {
      status: 'none',           // none | active | lost
      name: '', members: [], memberCount: 1, maxMembers: 5,
      lastSync: null, error: null, requests: [],
      join: null,               // { phase: form|waiting|failed, name, code, message }
    };
    this.listeners = new Set();
    this.syncCount = 0;
    this.syncing = null;
    this.again = false;
    this.pushTimer = null;
    this.interval = null;
    this.joinTimer = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #set(changes) {
    Object.assign(this.state, changes);
    for (const listener of this.listeners) listener(this.state);
  }

  #connection(session) {
    return new ListConnection({ listId: session.listId, listKey: session.listKey, memberId: session.memberId, baseUrl: this.baseUrl, fetch: this.fetchFn });
  }

  // ---------------------------------------------------------------- Start

  async init() {
    if (this.timers) this.#watchVisibility();
    const session = (await this.base.get('meta', SESSION_KEY))?.value;
    if (session) await this.#activate(session);
    const join = (await this.base.get('meta', JOIN_KEY))?.value;
    if (join && !session) {
      this.joinData = join;
      this.#set({ join: { phase: 'waiting', name: join.name, code: join.code } });
      this.#pollJoin();
    }
  }

  async #activate(session) {
    this.session = session;
    this.replica = new Replica({ deviceId: session.deviceId, now: this.now, saved: session.replica });
    this.connection = this.#connection(session);
    this.model.repository.store = new SharedStore(this.base, this.replica, { onChange: () => this.#localChange() });
    this.#set({ status: 'active', error: null, lastSync: session.lastSync ?? null, ...this.#summary() });
    await this.model.load();
    if (this.timers) this.#startTimers();
    this.sync();
  }

  async #deactivate() {
    this.#stopTimers();
    this.session = null;
    this.replica = null;
    this.connection = null;
    this.model.repository.store = this.base;
    await this.base.delete('meta', SESSION_KEY);
    this.#set({ status: 'none', name: '', members: [], memberCount: 1, requests: [], error: null, lastSync: null });
    await this.model.load();
  }

  #summary() {
    const members = this.replica.all('member').map((m) => ({ id: m.id, name: m.name ?? 'Gerät', me: m.id === this.session.memberId }));
    return { name: this.replica.get('list', 'info')?.name ?? this.session.name ?? 'Gemeinsame Liste', members };
  }

  async #save() {
    if (!this.session) return;
    this.session = { ...this.session, replica: this.replica.toJSON() };
    await this.base.put('meta', { key: SESSION_KEY, value: this.session });
  }

  // ---------------------------------------------------------------- Anlegen

  /**
   * Neue gemeinsame Liste; wahlweise wandert die bisherige private Liste hinein.
   * @param {{name: string, deviceName: string, adopt?: boolean}} options
   */
  async create({ name, deviceName, adopt = true }) {
    if (this.session) throw new Error('Dieses Gerät ist schon in einer gemeinsamen Liste.');
    const session = {
      listId: newListId(), listKey: newListKey(), memberId: crypto.randomUUID(), deviceId: newId().slice(0, 8),
      name: cleanName(name, 'Gemeinsame Liste'), deviceName: cleanName(deviceName, 'Mein Gerät'), seen: 0, snapshotUpto: 0, replica: null,
    };
    await this.#connection(session).create();
    const replica = new Replica({ deviceId: session.deviceId, now: this.now });
    replica.set('list', 'info', { name: session.name });
    replica.set('member', session.memberId, { name: session.deviceName, joinedAt: this.now() });
    session.replica = replica.toJSON();
    const privateEntries = adopt ? await this.base.getAll('entries') : [];
    await this.base.put('meta', { key: SESSION_KEY, value: session });
    await this.#activate(session);
    if (privateEntries.length) {
      await this.model.repository.store.putMany('entries', privateEntries);
      for (const entry of privateEntries) await this.base.delete('entries', entry.id);
      await this.model.load();
    }
    await this.sync();
  }

  // ---------------------------------------------------------------- Einladen und bestätigen

  /** Neue Einladung (30 Minuten gültig). @returns {Promise<{link: string, text: string, expires: number}>} */
  async invite() {
    if (!this.session) throw new Error('Keine gemeinsame Liste aktiv.');
    const secret = newInviteSecret();
    const expires = await this.connection.registerInvite(secret);
    // Die Einladung liegt verschlüsselt in der Liste – so kann jedes Mitglied die Anfrage bestätigen.
    this.replica.set('invite', newId().slice(0, 12), { secret, expires });
    await this.#save();
    this.#schedulePush(0);
    const link = inviteLink(this.appUrl(), { listId: this.session.listId, secret, name: this.state.name });
    return { link, text: inviteText(link, this.state.name), expires };
  }

  async approve(rid) {
    const request = this.state.requests.find((r) => r.rid === rid);
    if (!request) return;
    const answer = await sealForDevice(request.publicJwk, { listId: this.session.listId, listKey: this.session.listKey, name: this.state.name });
    await this.#guard(() => this.connection.answer(rid, answer));
    this.replica.set('member', rid, { name: request.device || 'Gerät', joinedAt: this.now() });
    await this.#save();
    this.#set({ requests: this.state.requests.filter((r) => r.rid !== rid), ...this.#summary() });
    await this.sync();
  }

  async reject(rid) {
    await this.#guard(() => this.connection.reject(rid));
    this.#set({ requests: this.state.requests.filter((r) => r.rid !== rid) });
  }

  // ---------------------------------------------------------------- Verlassen

  /** Gerät verlässt die Liste; war es das letzte, wird der Briefkasten gelöscht. Die private Liste kommt zurück. */
  async leave() {
    if (!this.session) return;
    try {
      await this.#flush();
      const { members } = await this.connection.info();
      if (members <= 1) await this.connection.destroy();
      else await this.connection.leave();
    } catch (error) {
      if (![401, 404].includes(error.status)) throw error;   // ohne Zugang ist man ohnehin draußen
    }
    await this.#deactivate();
  }

  // ---------------------------------------------------------------- Beitreten (neues Gerät)

  /** Eingefügter Link oder Nachricht mit Einladung → Dialog „Beitreten?“. @returns {boolean} ob eine Einladung darin war */
  receiveInvite(text) {
    const invite = parseInvite(text);
    if (!invite) return false;
    if (this.session) {
      this.#set({ join: { phase: 'failed', name: invite.name, message: 'Dieses Gerät ist schon in einer gemeinsamen Liste. Erst verlassen, dann beitreten.' } });
      return true;
    }
    this.pendingInvite = invite;
    this.#set({ join: { phase: 'form', name: invite.name } });
    return true;
  }

  async sendJoin(deviceName) {
    const invite = this.pendingInvite;
    if (!invite) return;
    try {
      const keys = await newDeviceKeys();
      const join = new JoinConnection({ listId: invite.listId, secret: invite.secret, baseUrl: this.baseUrl, fetch: this.fetchFn });
      const device = cleanName(deviceName, 'Neues Gerät');
      const rid = await join.request(keys.publicJwk, device);
      this.joinData = { ...invite, rid, deviceName: device, ...keys, code: await checkCode(invite.secret, keys.publicJwk), startedAt: this.now() };
      await this.base.put('meta', { key: JOIN_KEY, value: this.joinData });
      this.pendingInvite = null;
      this.#set({ join: { phase: 'waiting', name: invite.name, code: this.joinData.code } });
      this.#pollJoin();
    } catch (error) {
      this.#set({ join: { phase: 'failed', name: invite.name, message: error.message } });
    }
  }

  /** Einmal nachsehen, ob die Anfrage bestätigt wurde. @returns {Promise<boolean>} beigetreten */
  async checkJoin() {
    const data = this.joinData;
    if (!data) return false;
    try {
      const answer = await new JoinConnection({ listId: data.listId, secret: data.secret, baseUrl: this.baseUrl, fetch: this.fetchFn }).answer(data.rid);
      if (!answer) return false;
      const payload = await openForDevice(data.privateJwk, answer);
      if (payload.listId !== data.listId || typeof payload.listKey !== 'string') throw new Error('Antwort passt nicht zur Einladung.');
      await this.base.delete('meta', JOIN_KEY);
      this.joinData = null;
      clearTimeout(this.joinTimer);
      const session = {
        listId: data.listId, listKey: payload.listKey, memberId: data.rid, deviceId: newId().slice(0, 8),
        name: cleanName(payload.name, data.name || 'Gemeinsame Liste'), deviceName: data.deviceName, seen: 0, snapshotUpto: 0, replica: null,
      };
      await this.base.put('meta', { key: SESSION_KEY, value: session });
      this.#set({ join: null });
      await this.#activate(session);
      await this.sync();
      this.model.notify(`Du bist jetzt in „${session.name}“`);
      return true;
    } catch (error) {
      if (error.status === 0) return false;   // offline – später weiter versuchen
      await this.cancelJoin();
      this.#set({ join: { phase: 'failed', name: data.name, message: error.status === 403 || error.status === 404
        ? 'Die Anfrage wurde abgelehnt oder ist abgelaufen. Bitte um eine neue Einladung.' : error.message } });
      return false;
    }
  }

  #pollJoin() {
    clearTimeout(this.joinTimer);
    if (!this.timers) return;
    this.joinTimer = setTimeout(async () => {
      if (!this.joinData) return;
      if (!(await this.checkJoin()) && this.joinData) this.#pollJoin();
    }, JOIN_POLL_MS);
  }

  async cancelJoin() {
    clearTimeout(this.joinTimer);
    this.joinData = null;
    this.pendingInvite = null;
    await this.base.delete('meta', JOIN_KEY);
    this.#set({ join: null });
  }

  dismissJoin() {
    if (this.state.join?.phase === 'waiting') return;
    this.pendingInvite = null;
    this.#set({ join: null });
  }

  // ---------------------------------------------------------------- Abgleich

  #localChange() {
    this.#save();
    this.#schedulePush(PUSH_DELAY_MS);
  }

  #schedulePush(delay) {
    clearTimeout(this.pushTimer);
    if (!this.timers) return;
    this.pushTimer = setTimeout(() => this.sync(), delay);
  }

  /** Einmal abgleichen: Eigenes einwerfen, Neues abholen. Läuft schon einer, folgt direkt danach ein weiterer. */
  sync() {
    if (!this.session) return Promise.resolve();
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      try {
        do {
          this.again = false;
          await this.#syncOnce();
        } while (this.again && this.session);
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  async #flush() {
    const pending = this.replica.pending.length;
    if (!pending) return;
    await this.connection.push(this.replica.pending.slice(0, pending));
    this.replica.acknowledge(pending);
    await this.#save();
  }

  async #syncOnce() {
    const { listId } = this.session;
    try {
      await this.#flush();
      const { snapshot, snapshotUpto, ops, last } = await this.connection.pull(this.session.seen);
      if (this.session?.listId !== listId) return;   // inzwischen verlassen
      const changes = [];
      if (snapshot) changes.push(...this.replica.receiveSnapshot(snapshot));
      changes.push(...this.replica.receive(ops));
      this.session = { ...this.session, seen: last, lastSync: this.now() };
      this.session.snapshotUpto = Math.max(this.session.snapshotUpto ?? 0, snapshotUpto);
      if (changes.some((c) => c.kind === 'entry' && c.after === null && c.fields.bought)) await this.#rememberBought(changes);

      // Solange eine Einladung offen ist, bei jedem Abgleich nach Anfragen sehen – sonst nur ab und zu.
      const inviteOpen = this.replica.all('invite').some((i) => i.expires > this.now());
      if (inviteOpen || this.syncCount++ % REQUESTS_EVERY === 0) await this.#checkRequests();
      if (last - (this.session.snapshotUpto ?? 0) > COMPACT_AFTER) {
        await this.connection.putSnapshot(last, this.replica.snapshot());
        this.session.snapshotUpto = last;
      }
      this.#cleanupInvites();
      await this.#save();
      this.#set({ status: 'active', lastSync: this.session.lastSync, error: null, ...this.#summary() });
      if (changes.length) await this.model.load();
    } catch (error) {
      if (error.status === 401 || error.status === 404) this.#set({ status: 'lost', error: error.message });
      else if (error.status === 507) {
        await this.connection.putSnapshot(this.session.seen, this.replica.snapshot()).catch(() => {});
        this.session.snapshotUpto = this.session.seen;
      } else this.#set({ error: error.message });
    }
  }

  async #checkRequests() {
    const secrets = this.replica.all('invite').filter((i) => i.expires > this.now() - INVITE_KEEP_MS).map((i) => i.secret);
    const [info, requests] = await Promise.all([
      this.connection.info(),
      secrets.length ? this.connection.requests(secrets) : Promise.resolve([]),
    ]);
    const withCodes = await Promise.all(requests.map(async (r) => ({ ...r, code: await checkCode(r.secret, r.publicJwk) })));
    this.#set({ memberCount: info.members, maxMembers: info.maxMembers, requests: withCodes });
  }

  #cleanupInvites() {
    for (const invite of this.replica.all('invite')) {
      if (invite.expires < this.now() - INVITE_KEEP_MS) this.replica.remove('invite', invite.id);
    }
  }

  /** Ein anderes Gerät hat den Einkauf abgeschlossen: „Zuletzt gekauft“ auch hier fortschreiben. */
  async #rememberBought(changes) {
    const products = await this.base.getAll('products');
    const byRef = new Map(products.map((p) => [productRef(p), p]));
    for (const p of products) if (!p.catalogId) byRef.set(`s:${p.id}`, p);
    for (const change of changes) {
      if (change.kind !== 'entry' || change.after !== null || !change.fields.bought || !change.before) continue;
      const product = byRef.get(change.before.ref);
      if (!product) continue;
      const updated = {
        ...product,
        purchaseCount: (product.purchaseCount ?? 0) + 1,
        lastPurchasedAt: this.now(),
        lastQuantity: change.before.quantity ?? product.lastQuantity,
        lastUnit: change.before.unit ?? product.lastUnit,
        lastNote: change.before.note ?? '',
      };
      await this.base.put('products', updated);
      byRef.set(change.before.ref, updated);
    }
  }

  async #guard(work) {
    try {
      return await work();
    } catch (error) {
      if (error.status === 401 || error.status === 404) this.#set({ status: 'lost', error: error.message });
      throw error;
    }
  }

  // ---------------------------------------------------------------- Zeitgeber

  /** Zurück in der App (oder wieder online): sofort abgleichen bzw. nach der Bestätigung des Beitritts sehen. */
  #watchVisibility() {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (this.session) this.sync();
      else if (this.joinData) this.checkJoin();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
  }

  #startTimers() {
    this.#stopTimers();
    this.interval = setInterval(() => {
      if (document.visibilityState === 'visible') this.sync();
    }, SYNC_MS);
  }

  #stopTimers() {
    clearInterval(this.interval);
    clearTimeout(this.pushTimer);
  }
}

function cleanName(name, fallback) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return clean || fallback;
}
