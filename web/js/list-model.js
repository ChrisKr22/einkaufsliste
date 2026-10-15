// Zustand und Aktionen der Einkaufsliste – für Planungs- und Einkaufsmodus gemeinsam.
// Unabhängig vom DOM, testbar mit Node.

import { backupFileName, parseBackup, summarize } from './data/backup.js';
import { FALLBACK_CATEGORY } from './data/repository.js';
import { decodeShare, encodeShare, extractShareCode, shareText, shareUrl } from './data/share.js';
import { fold, searchProducts } from './search.js';

export class ListModel {
  /** @param {import('./data/repository.js').ShoppingRepository} repository */
  constructor(repository, { toastMs = 3500 } = {}) {
    this.repository = repository;
    this.toastMs = toastMs;
    this.state = {
      categories: [],
      products: [],
      items: [],
      query: '',
      editingId: null,
      toast: null,       // { id, text, canUndo }
      error: null,
      addedCount: 0,     // Auslöser für Haptik/Animation
      cartedCount: 0,    // dito beim Einkaufen
      summary: null,     // nach „Einkauf abschließen“: { bought, kept }
      lastBackupAt: null,
      incomingShare: null, // { items } – geteilte Liste, die übernommen werden kann
      photos: new Map(),   // Produkt-ID → eigenes Foto (Data-URL)
    };
    this.listeners = new Set();
    this.undoAction = null;
    this.toastTimer = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  #set(changes) {
    Object.assign(this.state, changes);
    this.#emit();
  }

  // ---------------------------------------------------------------- Abgeleitete Werte

  /** Einträge auf der Liste (ohne die bereits im Wagen liegenden). */
  get plannedItems() {
    return this.state.items.filter((i) => i.status !== 'inCart');
  }

  get openCount() {
    return this.state.items.filter((i) => i.status === 'open').length;
  }

  /** Gruppiert nach Kategorie, in Laden-Reihenfolge. Ohne gültige Kategorie → „Sonstiges“. */
  get sections() {
    const { categories } = this.state;
    const known = new Set(categories.map((c) => c.id));
    const fallback = categories.find((c) => c.key === FALLBACK_CATEGORY);
    const groups = new Map();
    for (const item of this.plannedItems) {
      const id = known.has(item.product.categoryId) ? item.product.categoryId : fallback?.id;
      if (!id) continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(item);
    }
    return categories.filter((c) => groups.has(c.id)).map((category) => ({ category, items: groups.get(category.id) }));
  }

  get trimmedQuery() {
    return this.state.query.trim();
  }

  get suggestions() {
    const planned = this.plannedItems;
    return searchProducts(this.trimmedQuery, this.state.products).map((product) => {
      const onList = planned.find((i) => i.product.id === product.id);
      let subtitle;
      if (onList) subtitle = `Schon auf der Liste · ${onList.quantity}× → +1`;
      else if (product.purchaseCount > 0) subtitle = `Zuletzt: ${product.lastQuantity}×${product.lastNote ? ` · ${product.lastNote}` : ''}`;
      else subtitle = this.categoryFor(product)?.name ?? 'Sonstiges';
      return { product, subtitle, isOnList: Boolean(onList) };
    });
  }

  /** „… als neues Produkt anlegen“ nur, wenn es kein Produkt mit genau diesem Namen gibt. */
  get canCreateFromQuery() {
    const q = fold(this.trimmedQuery);
    return q.length > 0 && !this.state.products.some((p) => fold(p.name) === q);
  }

  get editingItem() {
    return this.state.items.find((i) => i.id === this.state.editingId) ?? null;
  }

  // ---------------------------------------------------------------- Kategorien (Einstellungen)

  /** Kategorien in Laden-Reihenfolge mit Anzahl der Produkte. */
  get categoryRows() {
    const counts = new Map();
    for (const p of this.state.products) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
    return this.state.categories.map((category) => ({
      category,
      productCount: counts.get(category.id) ?? 0,
      canDelete: category.key !== FALLBACK_CATEGORY,
    }));
  }

  async renameCategory(category, name) {
    const trimmed = name.trim() || 'Neue Kategorie';
    if (trimmed === category.name) return;
    await this.#perform(() => this.repository.renameCategory(category.id, trimmed));
  }

  async reorderCategories(ids) {
    await this.#perform(() => this.repository.reorderCategories(ids));
  }

  /** Eine Position nach oben (-1) oder unten (+1) – Tastatur-Alternative zum Ziehen. */
  async moveCategory(categoryId, delta) {
    const ids = this.state.categories.map((c) => c.id);
    const from = ids.indexOf(categoryId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await this.reorderCategories(ids);
  }

  /** @returns {Promise<object|null>} die neue Kategorie */
  async addCategory(name = 'Neue Kategorie') {
    let category = null;
    await this.#perform(async () => {
      category = await this.repository.addCategory(name);
    });
    return category;
  }

  async deleteCategory(category) {
    await this.#perform(async () => {
      const snapshot = await this.repository.deleteCategory(category.id);
      this.undoAction = () => this.repository.restoreCategory(snapshot);
      const n = snapshot.productIds.length;
      const moved = n === 0 ? '' : ` – ${n === 1 ? '1 Produkt' : `${n} Produkte`} unter Sonstiges`;
      this.#showToast(`„${category.name}“ gelöscht${moved}`, true);
    });
  }

  // ---------------------------------------------------------------- Sicherung

  /** Erstellt den Dateiinhalt. Erst `confirmExported()` vermerkt die Sicherung als erledigt. */
  async prepareExport() {
    const backup = await this.repository.exportBackup();
    return { json: JSON.stringify(backup, null, 1), fileName: backupFileName(Date.parse(backup.exportedAt)), summary: summarize(backup) };
  }

  async confirmExported() {
    await this.#perform(async () => {
      await this.repository.markBackedUp();
      this.#showToast('Sicherung erstellt', false);
    });
  }

  /** Prüft eine Datei und beschreibt sie – wirft einen verständlichen Fehler, wenn sie nicht passt. */
  previewImport(text) {
    return summarize(parseBackup(text));
  }

  /** Ersetzt alle Daten durch die Sicherung (mit Rückgängig). */
  async importBackup(text) {
    const backup = parseBackup(text);
    const { products, entries } = summarize(backup);
    await this.#perform(async () => {
      const snapshot = await this.repository.importBackup(backup);
      this.state.editingId = null;
      this.state.summary = null;
      this.undoAction = () => this.repository.undoImport(snapshot);
      this.#showToast(`Sicherung eingespielt: ${products} Produkte, ${entries} auf der Liste`, true);
    });
  }

  // ---------------------------------------------------------------- Eigene Fotos

  hasOwnPhoto(product) {
    return this.state.photos.has(product.id);
  }

  async setPhoto(product, dataUrl) {
    await this.#perform(async () => {
      const previous = await this.repository.setPhoto(product.id, dataUrl);
      this.undoAction = () => (previous ? this.repository.setPhoto(product.id, previous) : this.repository.removePhoto(product.id));
      this.#showToast(`Foto für ${product.name} gespeichert`, true);
    });
  }

  async removePhoto(product) {
    await this.#perform(async () => {
      const previous = await this.repository.removePhoto(product.id);
      if (previous) this.undoAction = () => this.repository.setPhoto(product.id, previous);
      this.#showToast(`${product.name}: wieder Standardbild`, Boolean(previous));
    });
  }

  // ---------------------------------------------------------------- Liste teilen / übernehmen

  /** Text + Link mit der aktuellen Liste (ohne bereits Gekauftes im Wagen). */
  async shareList(baseUrl) {
    const sections = this.sections;
    const items = sections.flatMap(({ category, items: list }) => list.map((item) => ({
      catalogId: item.product.catalogId,
      name: item.product.name,
      categoryKey: category.key,
      quantity: item.quantity,
      note: item.note,
    })));
    if (!items.length) return null;
    const url = shareUrl(baseUrl, await encodeShare(items));
    return { text: shareText(sections, url), url, count: items.length };
  }

  /** Liest einen Link bzw. eine eingefügte Nachricht und zeigt den Übernehmen-Dialog. */
  async receiveShared(textOrUrl) {
    const code = extractShareCode(textOrUrl);
    if (!code) throw new Error('Darin ist kein FeedYourself-Link mit einer Liste enthalten.');
    const items = await decodeShare(code);
    this.#set({ incomingShare: { items } });
    return items;
  }

  dismissShared() {
    this.#set({ incomingShare: null });
  }

  async acceptShared() {
    const items = this.state.incomingShare?.items;
    if (!items) return;
    this.state.incomingShare = null;
    await this.#perform(async () => {
      const result = await this.repository.importSharedItems(items);
      const lastBackupAt = this.state.lastBackupAt;
      this.undoAction = () => this.repository.undoImport({ previous: result.snapshot, lastBackupAt });
      const n = result.added + result.updated;
      this.#showToast(`${n === 1 ? '1 Produkt' : `${n} Produkte`} aus der geteilten Liste übernommen`, true);
    });
  }

  // ---------------------------------------------------------------- Zuletzt gekauft

  /**
   * Früher gekaufte Produkte für die Kachelreihe im Planungsmodus.
   * @param {'recent'|'frequent'} order  zuletzt gekauft zuerst oder am häufigsten gekauft zuerst
   */
  purchasedProducts(order = 'recent', limit = 24) {
    const planned = new Map(this.plannedItems.map((i) => [i.product.id, i]));
    const byRecent = (a, b) => (b.lastPurchasedAt ?? 0) - (a.lastPurchasedAt ?? 0);
    const byCount = (a, b) => (b.purchaseCount ?? 0) - (a.purchaseCount ?? 0);
    const byName = (a, b) => a.name.localeCompare(b.name, 'de');
    return this.state.products
      .filter((p) => (p.purchaseCount ?? 0) > 0)
      .sort((a, b) => (order === 'frequent'
        ? byCount(a, b) || byRecent(a, b)
        : byRecent(a, b) || byCount(a, b)) || byName(a, b))
      .slice(0, limit)
      .map((product) => ({
        product,
        isOnList: planned.has(product.id),
        subtitle: `${product.lastQuantity ?? 1}×${product.lastNote ? ` · ${product.lastNote}` : ''}`,
      }));
  }

  // ---------------------------------------------------------------- Einkaufsmodus

  get openItems() {
    return this.state.items.filter((i) => i.status === 'open');
  }

  get cartItems() {
    return this.state.items.filter((i) => i.status === 'inCart');
  }

  get laterItems() {
    return this.state.items.filter((i) => i.status === 'later');
  }

  /** Nur offene Einträge, nach Kategorie in Laden-Reihenfolge. */
  get shopSections() {
    return this.sections
      .map(({ category, items }) => ({ category, items: items.filter((i) => i.status === 'open') }))
      .filter((s) => s.items.length > 0);
  }

  /** Fokus-Ansicht: alle offenen Einträge nacheinander, in Laden-Reihenfolge. */
  get focusQueue() {
    return this.shopSections.flatMap((s) => s.items);
  }

  /** Fortschritt: erledigt = im Wagen; Gesamt = offen + im Wagen + zurückgestellt. */
  get progress() {
    const done = this.cartItems.length;
    const total = this.state.items.length;
    return { done, total, ratio: total ? done / total : 0 };
  }

  categoryFor(product) {
    return this.state.categories.find((c) => c.id === product.categoryId) ?? null;
  }

  // ---------------------------------------------------------------- Aktionen

  async load() {
    await this.#reload();
  }

  setQuery(query) {
    this.#set({ query });
  }

  openEditor(itemId) {
    this.#set({ editingId: itemId });
  }

  closeEditor() {
    this.#set({ editingId: null });
  }

  async add(productId) {
    await this.#perform(async () => {
      const result = await this.repository.add(productId);
      if (result.type === 'added') {
        this.undoAction = () => this.repository.remove(result.item.id);
        this.#finishAdd(`${result.item.product.name} hinzugefügt`);
      } else {
        this.undoAction = () => this.repository.setQuantity(result.item.id, result.previousQuantity);
        this.#finishAdd(`${result.item.product.name}: jetzt ${result.item.quantity}×`);
      }
    });
  }

  /** Enter im Suchfeld: besten Treffer übernehmen, sonst neues Produkt anlegen. */
  async submitSearch() {
    const [first] = this.suggestions;
    if (first) await this.add(first.product.id);
    else if (this.canCreateFromQuery) await this.createProductFromQuery();
  }

  async createProductFromQuery() {
    const name = this.trimmedQuery;
    if (!name) return;
    await this.#perform(async () => {
      const product = await this.repository.createProduct(name.charAt(0).toUpperCase() + name.slice(1));
      const result = await this.repository.add(product.id, { quantity: 1, note: '' });
      this.undoAction = () => this.repository.remove(result.item.id);
      this.#finishAdd(`${product.name} angelegt und hinzugefügt`);
    });
  }

  async increment(item) {
    await this.#perform(() => this.repository.setQuantity(item.id, item.quantity + 1));
  }

  /** Bei Menge 1 wird der Eintrag entfernt (mit Rückgängig). */
  async decrement(item) {
    if (item.quantity > 1) await this.#perform(() => this.repository.setQuantity(item.id, item.quantity - 1));
    else await this.remove(item);
  }

  async setQuantity(item, quantity) {
    await this.#perform(() => this.repository.setQuantity(item.id, quantity));
  }

  async setNote(item, note) {
    await this.#perform(() => this.repository.setNote(item.id, note));
  }

  async remove(item) {
    await this.#perform(async () => {
      await this.repository.remove(item.id);
      if (this.state.editingId === item.id) this.state.editingId = null;
      this.undoAction = () => this.repository.restore(item);
      this.#showToast(`${item.product.name} entfernt`, true);
    });
  }

  async undo() {
    const action = this.undoAction;
    if (!action) return;
    this.undoAction = null;
    await this.#perform(async () => {
      await action();
      this.dismissToast();
    });
  }

  /** Kurzer Hinweis ohne Rückgängig (z. B. „Liste kopiert“). */
  notify(text) {
    this.undoAction = null;
    this.#showToast(text, false);
    this.#emit();
  }

  dismissToast() {
    clearTimeout(this.toastTimer);
    this.#set({ toast: null });
  }

  clearError() {
    this.#set({ error: null });
  }

  /** Tippen oder nach rechts (Fokus: auch nach oben) wischen. */
  async toCart(item) {
    await this.#changeStatus(item, 'inCart', `${item.product.name} im Wagen`);
    this.state.cartedCount++;
    this.#set({});
  }

  /** Nach links wischen: nicht gefunden / später. */
  async toLater(item) {
    await this.#changeStatus(item, 'later', `${item.product.name} zurückgestellt`);
  }

  /** „Doch gefunden“ bzw. „Zurück“ aus dem Wagen. */
  async reopen(item) {
    await this.#perform(() => this.repository.setStatus(item.id, 'open'));
  }

  async finishShopping() {
    let summary = null;
    await this.#perform(async () => {
      summary = await this.repository.finishShopping();
      this.undoAction = null;
      clearTimeout(this.toastTimer);
      this.state.toast = null;
    });
    if (summary) this.#set({ summary });
    return summary;
  }

  dismissSummary() {
    this.#set({ summary: null });
  }

  // ---------------------------------------------------------------- Intern

  async #changeStatus(item, status, text) {
    const previous = item.status;
    await this.#perform(async () => {
      await this.repository.setStatus(item.id, status);
      this.undoAction = () => this.repository.setStatus(item.id, previous);
      this.#showToast(text, true);
    });
  }

  #finishAdd(text) {
    this.state.query = '';
    this.state.addedCount++;
    this.#showToast(text, true);
  }

  #showToast(text, canUndo) {
    clearTimeout(this.toastTimer);
    this.state.toast = { id: crypto.randomUUID(), text, canUndo };
    this.toastTimer = setTimeout(() => {
      this.undoAction = null;
      this.#set({ toast: null });
    }, this.toastMs);
    this.toastTimer.unref?.();   // Node-Tests nicht aufhalten
  }

  async #perform(work) {
    try {
      await work();
    } catch (error) {
      this.state.error = error?.message ?? String(error);
    }
    await this.#reload();
  }

  async #reload() {
    try {
      const [categories, products, items, lastBackupAt, photos] = await Promise.all([
        this.repository.categories(),
        this.repository.products(),
        this.repository.listItems(),
        this.repository.lastBackupAt?.() ?? null,
        this.repository.photos?.() ?? new Map(),
      ]);
      Object.assign(this.state, { categories, products, items, lastBackupAt, photos });
    } catch (error) {
      this.state.error = error?.message ?? String(error);
    }
    this.#emit();
  }
}
