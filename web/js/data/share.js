// Liste teilen ohne Server: Die Einträge stecken komprimiert im Link (#liste=…).
// Wer den Link in der Web-App öffnet – oder ihn in der installierten App einfügt –, kann sie übernehmen.

export const SHARE_PARAM = 'liste';
const FORMAT = 1;
const MAX_ITEMS = 300;

// ---------------------------------------------------------------- Base64url

function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

// ---------------------------------------------------------------- Kodieren / Dekodieren

/**
 * @param {Array<{catalogId: string|null, name: string, categoryKey: string|null, quantity: number, note: string}>} items
 * @returns {Promise<string>} Code für den Link (z… = komprimiert, j… = unkomprimiert)
 */
export async function encodeShare(items) {
  const payload = {
    v: FORMAT,
    i: items.map((it) => {
      const row = { n: it.name, q: it.quantity };
      if (it.catalogId) row.c = it.catalogId;
      if (it.categoryKey) row.k = it.categoryKey;
      if (it.note) row.t = it.note;
      return row;
    }),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === 'function') {
    return `z${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  }
  return `j${toBase64Url(bytes)}`;
}

/** @returns {Promise<Array<{catalogId, name, categoryKey, quantity, note}>>} */
export async function decodeShare(code) {
  const fail = () => { throw new Error('Der Link enthält keine gültige Einkaufsliste.'); };
  if (typeof code !== 'string' || code.length < 2) fail();
  let payload;
  try {
    let bytes = fromBase64Url(code.slice(1));
    if (code[0] === 'z') {
      if (typeof DecompressionStream !== 'function') throw new Error('Dieser Browser kann den Link nicht lesen. Bitte Safari aktualisieren.');
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } else if (code[0] !== 'j') fail();
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error.message.startsWith('Dieser Browser')) throw error;
    fail();
  }
  if (payload?.v !== FORMAT || !Array.isArray(payload.i) || payload.i.length === 0 || payload.i.length > MAX_ITEMS) fail();
  return payload.i.map((row) => {
    if (typeof row?.n !== 'string' || !row.n.trim()) fail();
    return {
      catalogId: typeof row.c === 'string' ? row.c : null,
      name: row.n.trim().slice(0, 80),
      categoryKey: typeof row.k === 'string' ? row.k : null,
      quantity: Math.min(99, Math.max(1, Math.round(Number(row.q) || 1))),
      note: typeof row.t === 'string' ? row.t.slice(0, 200) : '',
    };
  });
}

/** Findet den Code in einem Link oder einer eingefügten Nachricht. */
export function extractShareCode(text) {
  const match = String(text ?? '').match(new RegExp(`[#&?]${SHARE_PARAM}=([zj][A-Za-z0-9_-]+)`));
  return match ? match[1] : null;
}

export function shareUrl(baseUrl, code) {
  return `${baseUrl.split('#')[0]}#${SHARE_PARAM}=${code}`;
}

/** Lesbare Nachricht: nach Kategorien, mit Menge und Anmerkung. */
export function shareText(sections, url) {
  const count = sections.reduce((n, s) => n + s.items.length, 0);
  const lines = [`Einkaufsliste (${count === 1 ? '1 Produkt' : `${count} Produkte`})`];
  for (const { category, items } of sections) {
    lines.push('', category.name);
    for (const item of items) lines.push(`• ${item.product.name} ${item.quantity}×${item.note ? ` – ${item.note}` : ''}`);
  }
  if (url) lines.push('', 'In FeedYourself übernehmen:', url);
  return lines.join('\n');
}
