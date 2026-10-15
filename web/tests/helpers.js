import { readFileSync } from 'node:fs';
import { importCatalog } from '../js/data/catalog-import.js';
import { ShoppingRepository } from '../js/data/repository.js';
import { MemoryStore } from '../js/storage/memory-store.js';

export const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));

/** Frischer Speicher mit dem echten Katalog. */
export async function makeStore({ withCatalog = true } = {}) {
  const store = new MemoryStore();
  if (withCatalog) await importCatalog(catalog, store);
  let clock = 1_000;
  const repository = new ShoppingRepository(store, { now: () => clock++ });
  return { store, repository };
}

export async function productNamed(repository, name) {
  const product = (await repository.products()).find((p) => p.name === name);
  if (!product) throw new Error(`Produkt fehlt: ${name}`);
  return product;
}

export const makeProduct = (name, synonyms = [], purchaseCount = 0) => ({
  id: crypto.randomUUID(), catalogId: null, name, synonyms, categoryId: null, isCustom: false,
  purchaseCount, lastPurchasedAt: null, lastQuantity: 1, lastNote: '',
});
