// Übernimmt den mitgelieferten Katalog (data/catalog.json) in den Speicher.
// - Erster Start: alle Kategorien und Produkte anlegen.
// - Neuere Katalog-Version: fehlende ergänzen, Synonyme aktualisieren, im Katalog umbenannte Namen nachziehen,
//   verschobene Produkte umziehen („moved_from“). Neue Kategorien landen hinter ihrem Vorgänger im Katalog.
//   Namen, Reihenfolge und Zuordnungen, die man in der App geändert hat, bleiben unangetastet.
// - Neues Katalogprodukt mit dem Namen eines eigenen Produkts (z. B. ein angenommener Vorschlag): Das eigene Produkt
//   wird zum Katalogprodukt – Kaufzahl, Foto, Einheit, Kategorie und Listeneinträge bleiben, es gibt kein Doppel.
//   Gibt es daneben schon das Katalogprodukt, aber noch unbenutzt (nie gekauft, auf keiner Liste, kein Foto),
//   ersetzt das eigene es (z. B. ein Doppel aus einer gemeinsamen Liste).

import { fold } from '../search.js';
import { DEFAULT_UNIT, isUnit } from '../units.js';
import { DELETED_CATEGORIES_KEY, FALLBACK_CATEGORY, newId } from './repository.js';

const VERSION_KEY = 'catalogVersion';

export async function importCatalog(catalog, store) {
  const summary = { categoriesAdded: 0, productsAdded: 0, productsUpdated: 0, skipped: false };
  const existingCategories = await store.getAll('categories');
  const importedVersion = (await store.get('meta', VERSION_KEY))?.value ?? 0;
  if (existingCategories.length > 0 && catalog.version <= importedVersion) {
    summary.skipped = true;
    return summary;
  }

  const categoriesByKey = new Map(existingCategories.map((c) => [c.key, c]));
  // In der App gelöschte Kategorien nicht wieder anlegen; ihre Produkte kommen nach „Sonstiges“.
  const deletedKeys = new Set((await store.get('meta', DELETED_CATEGORIES_KEY))?.value ?? []);
  // Reihenfolge wie in der App; eine neue Kategorie kommt direkt hinter ihren Vorgänger im Katalog.
  const ordered = [...existingCategories].sort((a, b) => a.sortOrder - b.sortOrder);
  const changedCategories = new Set();
  let previousKey = null;
  for (const item of catalog.categories) {
    const existing = categoriesByKey.get(item.id);
    if (existing) {
      // Im Katalog umbenannt und in der App nicht selbst umbenannt: neuen Namen übernehmen.
      if (existing.name !== item.name && (item.renamed_from ?? []).includes(existing.name)) {
        existing.name = item.name;
        changedCategories.add(existing);
      }
    } else if (!deletedKeys.has(item.id)) {
      const category = { id: newId(), key: item.id, name: item.name, sortOrder: 0 };
      const after = previousKey ? ordered.indexOf(categoriesByKey.get(previousKey)) : -1;
      ordered.splice(after + 1, 0, category);
      categoriesByKey.set(item.id, category);
      changedCategories.add(category);
      summary.categoriesAdded++;
    }
    if (categoriesByKey.has(item.id)) previousKey = item.id;
  }
  if (summary.categoriesAdded > 0) {
    ordered.forEach((category, index) => {
      if (category.sortOrder !== index) { category.sortOrder = index; changedCategories.add(category); }
    });
  }
  await store.putMany('categories', [...changedCategories]);

  const existingProducts = await store.getAll('products');
  const productsByCatalogId = new Map(existingProducts.filter((p) => p.catalogId).map((p) => [p.catalogId, p]));
  // Liegt das eigene Produkt noch in „Sonstiges“, kommt es in die Katalog-Kategorie; selbst einsortierte bleiben, wo sie sind.
  const fallbackId = categoriesByKey.get(FALLBACK_CATEGORY)?.id;
  const keepOwnCategory = (own) => Boolean(own.categoryId) && own.categoryId !== fallbackId;
  const ownByName = new Map(existingProducts.filter((p) => p.isCustom && !p.catalogId).map((p) => [fold(p.name), p]));
  const adopt = (own, item, category) => {
    ownByName.delete(fold(item.name));
    const { suggestHidden, suggestedAt, ...rest } = own;
    return { ...rest, catalogId: item.id, isCustom: false, name: item.name, synonyms: item.synonyms, categoryId: keepOwnCategory(own) ? own.categoryId : category?.id ?? own.categoryId ?? null };
  };
  const listed = new Set((await store.getAll('entries')).map((e) => e.productId));
  const withPhoto = new Set((await store.getAll('photos')).map((p) => p.productId));
  const unused = (p) => !p.purchaseCount && !p.lastPurchasedAt && !listed.has(p.id) && !withPhoto.has(p.id);
  const changed = [];
  const removed = [];
  for (const item of catalog.products) {
    const category = categoriesByKey.get(item.category) ?? categoriesByKey.get(FALLBACK_CATEGORY);
    const product = productsByCatalogId.get(item.id);
    const twin = product && ownByName.get(fold(item.name));
    if (twin && unused(product)) {
      removed.push(product.id);
      changed.push(adopt(twin, item, category));
      summary.productsUpdated++;
    } else if (product) {
      const synonymsChanged = JSON.stringify(product.synonyms) !== JSON.stringify(item.synonyms);
      // Im Katalog umbenannt (der alte Name steht jetzt unter den Synonymen): neuen Namen übernehmen.
      // Hat man das Produkt in der App selbst anders benannt, bleibt dieser Name.
      const renamed = product.name !== item.name && item.synonyms.includes(product.name);
      // Im Katalog in eine andere Kategorie verschoben: nur umziehen, wenn es in der App noch in der alten liegt.
      const oldCategory = item.moved_from && categoriesByKey.get(item.moved_from);
      const moved = Boolean(oldCategory && category && product.categoryId === oldCategory.id && category.id !== oldCategory.id);
      if (synonymsChanged || renamed || moved || !product.categoryId) {
        const categoryId = moved ? category.id : product.categoryId ?? category?.id ?? null;
        changed.push({ ...product, name: renamed ? item.name : product.name, synonyms: item.synonyms, categoryId });
        if (synonymsChanged || renamed || moved) summary.productsUpdated++;
      }
    } else if (ownByName.has(fold(item.name))) {
      changed.push(adopt(ownByName.get(fold(item.name)), item, category));
      summary.productsUpdated++;
    } else {
      changed.push({
        id: newId(),
        catalogId: item.id,
        name: item.name,
        synonyms: item.synonyms,
        categoryId: category?.id ?? null,
        isCustom: false,
        purchaseCount: 0,
        lastPurchasedAt: null,
        lastQuantity: 1,
        lastNote: '',
        unit: isUnit(item.unit) ? item.unit : DEFAULT_UNIT,   // optional in catalog.json
      });
      summary.productsAdded++;
    }
  }
  for (const id of removed) await store.delete('products', id);
  await store.putMany('products', changed);
  await store.put('meta', { key: VERSION_KEY, value: catalog.version });
  return summary;
}
