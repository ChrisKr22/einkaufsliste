// Kleine Helfer für die Ansichten.

import { categoryStyle } from '../category-style.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const icon = {
  plus: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  basket: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5.5 10h13l-1.5 9.5h-10zM8.5 10l3.5-6 3.5 6M10 13.5v3M14 13.5v3"/></svg>',
};

// Woher Produktbilder kommen: eigene Fotos (Gerät) und Katalogfotos (images/<katalog-id>.png).
const photoSources = { own: new Map(), bundled: new Set() };

export function setPhotoSources({ own, bundled }) {
  if (own) photoSources.own = own;
  if (bundled) photoSources.bundled = bundled;
}

/** Bildadresse für ein Produkt: eigenes Foto vor Katalogfoto; null = Platzhalter. */
export function photoUrl(product) {
  if (product?.id && photoSources.own.has(product.id)) return photoSources.own.get(product.id);
  if (product?.catalogId && photoSources.bundled.has(product.catalogId)) return `images/${product.catalogId}.png`;
  return null;
}

/** Bild bzw. Kategorie-Symbol als Inhalt einer Bildfläche. */
export function photoContent(product, categoryKey) {
  const url = photoUrl(product);
  if (url) return `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">`;
  return `<svg viewBox="0 0 24 24"><path d="${categoryStyle(categoryKey).path}"/></svg>`;
}

/** Produktbild: eigenes Foto, Katalogfoto oder Kategorie-Fläche mit Symbol. */
export function thumb(product, categoryKey, size = '') {
  const style = categoryStyle(categoryKey);
  const hasPhoto = photoUrl(product) ? ' has-photo' : '';
  return `<span class="thumb ${size}${hasPhoto}" style="--tint:${style.tint};--ink:${style.ink}" aria-hidden="true">`
    + `${photoContent(product, categoryKey)}</span>`;
}

export function stepper(item, { large = false } = {}) {
  const name = esc(item.product.name);
  return `<div class="stepper${large ? ' large' : ''}">`
    + `<button type="button" data-dec="${item.id}" aria-label="${name} weniger">${icon.minus}</button>`
    + `<span class="qty" aria-label="${item.quantity} Stück">${item.quantity}×</span>`
    + `<button type="button" data-inc="${item.id}" aria-label="${name} mehr">${icon.plus}</button>`
    + '</div>';
}

/** Kurzes haptisches Feedback, wo der Browser es kann (iPhone-Safari unterstützt es nicht). */
export function buzz() {
  try { navigator.vibrate?.(12); } catch { /* egal */ }
}
