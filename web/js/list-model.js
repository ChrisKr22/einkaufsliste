// Zustand und Aktionen der Einkaufsliste – für Planungs- und Einkaufsmodus gemeinsam.
// Unabhängig vom DOM, testbar mit Node.

import { backupFileName, openVault, parseBackup, summarize, withoutVault } from './data/backup.js';
import { FALLBACK_CATEGORY, newId } from './data/repository.js';
import { decodeShare, encodeShare, extractShareCode, shareText, shareUrl } from './data/share.js';
import { hiddenSuggestions, suggestionCandidates, suggestionMessage } from './data/suggest.js';
import { fold, searchProducts } from './search.js';
import { formatQuantity, stepDown, stepUp, UNITS, unitOf } from './units.js';

export class ListModel {
  /** @param {import('./data/repository.js').ShoppingRepository} repository */
  constructor(repository, { toastMs = 4500, finishMs = 3000 } = {}) {
    this.repository = repository;
    this.toastMs = toastMs;
    this.finishMs = finishMs;
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
      finishing: null,   // Countdown vor dem Abschließen: { bought, kept, ms }
      summary: null,     // nach „Einkauf abschließen“: { bought, kept }
      lastBackupAt: null,
      incomingShare: null, // { items } – geteilte Liste, die übernommen werden kann
      photos: new Map(),   // Produkt-ID → eigenes Foto (Data-URL)
      skipped: new Map(),  // Fokus: Eintrag-ID → Reihenfolge des Überspringens (nur für diesen Einkauf)
    };
    this.listeners = new Set();
    this.onDataReplaced = null;   // nach dem Einspielen einer Sicherung: Listen neu einlesen (setzt die Listenverwaltung)
    this.undoAction = null;
    this.toastTimer = null;
    this.finishTimer = null;
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
      if (onList) subtitle = `Schon auf der Liste · ${formatQuantity(onList.quantity, unitOf(onList))} → mehr`;
      else if (product.purchaseCount > 0) subtitle = `Zuletzt: ${formatQuantity(product.lastQuantity, product.lastUnit)}${product.lastNote ? ` · ${product.lastNote}` : ''}`;
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

  /**
   * Erstellt den Dateiinhalt. Erst `confirmExported()` vermerkt die Sicherung als erledigt.
   * @param {{password?: string, iterations?: number}} [options]  password: schützt die Zugänge zu gemeinsamen Listen;
   *   ohne Passwort fehlen sie in der Datei
   * @returns {Promise<{json: string, fileName: string, summary: object, sealed: number, dropped: number}>}
   */
  async prepareExport({ password = '', iterations } = {}) {
    const { backup, sealed, dropped } = await this.repository.exportFile({ password, iterations });
    return { json: JSON.stringify(backup, null, 1), fileName: backupFileName(Date.parse(backup.exportedAt)), summary: summarize(backup), sealed, dropped };
  }

  /** Zugänge zu gemeinsamen Listen auf diesem Gerät – dann fragt die Sicherung nach einem Passwort. */
  backupAccessCount() {
    return this.repository.accessCount();
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

  /**
   * Ersetzt alle Daten durch die Sicherung (mit Rückgängig).
   * @param {{password?: string}} [options]  öffnet die Zugänge zu gemeinsamen Listen; ohne Passwort bleiben sie weg
   *   (Zugänge, die dieses Gerät schon hat, bleiben erhalten). Falsches Passwort → Fehler, nichts wird geändert.
   */
  async importBackup(text, { password = '' } = {}) {
    let backup = parseBackup(text);
    const { products, entries, vault } = summarize(backup);
    backup = vault && password ? await openVault(backup, password) : withoutVault(backup);
    const skipped = vault && !password;
    await this.#perform(async () => {
      const snapshot = await this.repository.importBackup(backup);
      this.state.editingId = null;
      this.state.summary = null;
      this.undoAction = async () => {
        await this.repository.undoImport(snapshot);
        await this.onDataReplaced?.();
      };
      this.#showToast(`Sicherung eingespielt: ${products} Produkte, ${entries} auf der Liste${skipped ? ' – gemeinsame Listen ohne Passwort nicht übernommen' : ''}`, true);
      await this.onDataReplaced?.();
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
  // ---------------------------------------------------------------- Katalog-Vorschläge

  /** Eigene Produkte, die man für den gemeinsamen Katalog vorschlagen kann. */
  get catalogCandidates() {
    return suggestionCandidates(this.state.products);
  }

  /** Aus der Vorschlagsliste entfernte eigene Produkte. */
  get hiddenCatalogCandidates() {
    return hiddenSuggestions(this.state.products);
  }

  /** Nimmt ein eigenes Produkt aus der Vorschlagsliste (mit Rückgängig); das Produkt bleibt in der Suche. */
  async hideSuggestion(product) {
    await this.#perform(async () => {
      await this.repository.setSuggestHidden([product.id], true);
      this.undoAction = () => this.repository.setSuggestHidden([product.id], false);
      this.#showToast(`${product.name}: nicht mehr vorschlagen`, true);
    });
  }

  /** Alle entfernten Produkte wieder in die Vorschlagsliste aufnehmen. */
  async showHiddenSuggestions() {
    const ids = this.hiddenCatalogCandidates.map((p) => p.id);
    if (!ids.length) return;
    await this.#perform(async () => {
      await this.repository.setSuggestHidden(ids, false);
      this.undoAction = () => this.repository.setSuggestHidden(ids, true);
      this.#showToast(ids.length === 1 ? '1 Produkt wieder in der Liste' : `${ids.length} Produkte wieder in der Liste`, true);
    });
  }

  /** Nachricht für die ausgewählten Produkte (null, wenn keins ausgewählt ist). */
  async suggestionText(productIds) {
    const wanted = new Set(productIds);
    const products = this.catalogCandidates.filter((p) => wanted.has(p.id));
    if (!products.length) return null;
    return suggestionMessage(products, (p) => this.categoryFor(p));
  }

  async confirmSuggested(productIds) {
    await this.#perform(async () => {
      await this.repository.markSuggested(productIds);
      this.#showToast(productIds.length === 1 ? 'Vorschlag geteilt' : `${productIds.length} Vorschläge geteilt`, false);
    });
  }

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
        subtitle: `${formatQuantity(product.lastQuantity ?? 1, product.lastUnit)}${product.lastNote ? ` · ${product.lastNote}` : ''}`,
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

  /** Fokus-Ansicht: offene Einträge je Kategorie in Laden-Reihenfolge; übersprungene rücken in ihrer
   *  Kategorie nach hinten (in der Reihenfolge, in der sie übersprungen wurden). */
  get focusSections() {
    const { skipped } = this.state;
    return this.shopSections.map(({ category, items }) => {
      const fresh = items.filter((i) => !skipped.has(i.id));
      const later = items.filter((i) => skipped.has(i.id)).sort((a, b) => skipped.get(a.id) - skipped.get(b.id));
      return { category, items: [...fresh, ...later] };
    });
  }

  get focusQueue() {
    return this.focusSections.flatMap((s) => s.items);
  }

  /** Fokus: einmal tippen – Produkt ans Ende seiner Kategorie, beliebig oft wiederholbar. */
  skip(item) {
    if (!item || item.status !== 'open') return;
    this.skipCounter = (this.skipCounter ?? 0) + 1;
    const skipped = new Map(this.state.skipped);
    skipped.set(item.id, this.skipCounter);
    this.#set({ skipped });
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
        this.#finishAdd(`${result.item.product.name}: jetzt ${formatQuantity(result.item.quantity, unitOf(result.item))}`);
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
      const result = await this.repository.add(product.id, { note: '' });
      this.undoAction = () => this.repository.remove(result.item.id);
      this.#finishAdd(`${product.name} angelegt und hinzugefügt`);
    });
  }

  async increment(item) {
    await this.#perform(() => this.repository.setQuantity(item.id, stepUp(item.quantity, unitOf(item))));
  }

  /** Bei Menge 1 wird der Eintrag entfernt (mit Rückgängig). */
  async decrement(item) {
    const next = stepDown(item.quantity, unitOf(item));
    if (next !== null) await this.#perform(() => this.repository.setQuantity(item.id, next));
    else await this.remove(item);
  }

  /** Kann die Menge noch kleiner werden, ohne den Eintrag zu entfernen? */
  canDecrease(item) {
    return stepDown(item.quantity, unitOf(item)) !== null;
  }

  /** Einheit dieses Eintrags ändern (Menge springt auf den Startwert, z. B. 1 kg). */
  async setEntryUnit(item, unit) {
    await this.#perform(async () => {
      const previous = await this.repository.setEntryUnit(item.id, unit);
      this.undoAction = () => this.repository.replaceEntry(previous);
      this.#showToast(`${item.product.name}: jetzt in ${UNITS[unit].label}`, true);
    });
  }

  /** Standard-Einheit eines Produkts (Einstellungen) – gilt ab dem nächsten Hinzufügen. */
  async setProductUnit(product, unit) {
    await this.#perform(async () => {
      const previous = await this.repository.setProductUnit(product.id, unit);
      this.undoAction = () => this.repository.setProductUnit(product.id, previous);
      this.#showToast(`${product.name}: Einheit ${UNITS[unit].label}`, true);
    });
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
  /** Kurzer Hinweis ohne Rückgängig. compact: schmal und mittig (nur so breit wie der Text). */
  notify(text, { compact = false } = {}) {
    this.undoAction = null;
    this.#showToast(text, false);
    if (compact) this.state.toast.compact = true;
    this.#emit();
  }

  dismissToast() {
    clearTimeout(this.toastTimer);
    this.#set({ toast: null });
  }

  clearError() {
    this.#set({ error: null });
  }

  /** Tippen (Kacheln, Liste) oder nach rechts wischen. */
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

  /**
   * „Fertig“: Countdown starten. Erst wenn er abläuft, wird der Einkauf abgeschlossen – bis dahin
   * ist nichts gespeichert, „Rückgängig“ bricht nur ab.
   */
  startFinish() {
    if (this.state.finishing || this.state.summary) return;
    const bought = this.cartItems.length;
    if (bought === 0) return;
    clearTimeout(this.toastTimer);
    this.undoAction = null;
    this.finishTimer = setTimeout(() => this.confirmFinish(), this.finishMs);
    this.finishTimer.unref?.();   // Node-Tests nicht aufhalten
    this.#set({ toast: null, finishing: { bought, kept: this.state.items.length - bought, ms: this.finishMs } });
  }

  /** „Rückgängig“ während des Countdowns: Einkauf läuft weiter, nichts wurde geändert. */
  cancelFinish() {
    if (!this.state.finishing) return;
    clearTimeout(this.finishTimer);
    this.state.finishing = null;
    this.notify('Einkauf läuft weiter');
  }

  /** Countdown abgelaufen (oder App verlassen): jetzt abschließen. */
  async confirmFinish() {
    if (!this.state.finishing) return null;
    clearTimeout(this.finishTimer);
    this.state.finishing = null;
    return this.finishShopping();
  }

  async finishShopping() {
    let summary = null;
    await this.#perform(async () => {
      summary = await this.repository.finishShopping();
      this.undoAction = null;
      clearTimeout(this.toastTimer);
      this.state.toast = null;
    });
    if (summary) this.#set({ summary, skipped: new Map() });
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
    this.state.toast = { id: newId(), text, canUndo };
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
