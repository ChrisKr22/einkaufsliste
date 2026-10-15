// Übernimmt den mitgelieferten Katalog (data/catalog.json) in den Speicher.
// - Erster Start: alle Kategorien und Produkte anlegen.
// - Neuere Katalog-Version: fehlende ergänzen, Synonyme aktualisieren.
//   Namen und Reihenfolge, die man in der App geändert hat, bleiben unangetastet.

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
  let nextSortOrder = Math.max(-1, ...existingCategories.map((c) => c.sortOrder)) + 1;
  const newCategories = [];
  for (const item of catalog.categories) {
    if (categoriesByKey.has(item.id) || deletedKeys.has(item.id)) continue;
    const category = { id: newId(), key: item.id, name: item.name, sortOrder: nextSortOrder++ };
    categoriesByKey.set(item.id, category);
    newCategories.push(category);
  }
  await store.putMany('categories', newCategories);
  summary.categoriesAdded = newCategories.length;

  const existingProducts = await store.getAll('products');
  const productsByCatalogId = new Map(existingProducts.filter((p) => p.catalogId).map((p) => [p.catalogId, p]));
  const changed = [];
  for (const item of catalog.products) {
    const category = categoriesByKey.get(item.category) ?? categoriesByKey.get(FALLBACK_CATEGORY);
    const product = productsByCatalogId.get(item.id);
    if (product) {
      const synonymsChanged = JSON.stringify(product.synonyms) !== JSON.stringify(item.synonyms);
      if (synonymsChanged || !product.categoryId) {
        changed.push({ ...product, synonyms: item.synonyms, categoryId: product.categoryId ?? category?.id ?? null });
        if (synonymsChanged) summary.productsUpdated++;
      }
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
  await store.putMany('products', changed);
  await store.put('meta', { key: VERSION_KEY, value: catalog.version });
  return summary;
}
