// Tolerante Produktsuche: Groß/Klein, Umlaute (Öl = Ol = Oel), Teilwörter, Synonyme, kleine Tippfehler.

/** Kleinbuchstaben, ß → ss, Akzente/Umlaute entfernt (ä → a). */
export function fold(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Umlaute ausgeschrieben (ä → ae), damit auch „oel“ das Olivenöl findet. */
export function expand(text) {
  return fold(String(text ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'));
}

export function variants(text) {
  const a = fold(text);
  const b = expand(text);
  return a === b ? [a] : [a, b];
}

export function words(text) {
  return text.split(/[\s\-,()]+/).filter(Boolean);
}

/** Damerau-Levenshtein (mit Vertauschung benachbarter Zeichen). */
export function distance(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Ist `query` höchstens eine Änderung vom gleich langen Anfang von `word` entfernt? */
export function isWithinOneEdit(query, word) {
  if (word.length < query.length - 1) return false;
  const upper = Math.min(word.length, query.length + 1);
  for (let length = Math.max(1, query.length - 1); length <= upper; length++) {
    if (distance(query, word.slice(0, length)) <= 1) return true;
  }
  return false;
}

/** Kleinere Zahl = besserer Treffer, null = kein Treffer. */
export function score(q, product) {
  const names = variants(product.name);
  const synonyms = (product.synonyms ?? []).flatMap(variants);
  const anyWord = (list) => list.some((s) => words(s).some((w) => w.startsWith(q)));

  if (names.some((n) => n.startsWith(q))) return 0;
  if (anyWord(names)) return 0.5;
  if (names.some((n) => n.includes(q))) return 1;
  if (synonyms.some((s) => s.startsWith(q))) return 2;
  if (anyWord(synonyms)) return 2.5;
  if (synonyms.some((s) => s.includes(q))) return 3;
  // Tippfehler: ab 4 Zeichen ein falscher, fehlender oder vertauschter Buchstabe.
  if (q.length >= 4 && [...names, ...synonyms].flatMap(words).some((w) => isWithinOneEdit(q, w))) return 4;
  return null;
}

/** Beste Treffer zuerst; bei gleicher Güte häufig Gekauftes, dann kürzere Namen. */
export function searchProducts(query, products, limit = 6) {
  const q = fold(query);
  if (!q) return [];
  return products
    .map((product) => ({ product, score: score(q, product) }))
    .filter((r) => r.score !== null)
    .sort((a, b) =>
      a.score - b.score
      || (b.product.purchaseCount ?? 0) - (a.product.purchaseCount ?? 0)
      || a.product.name.length - b.product.name.length
      || a.product.name.localeCompare(b.product.name, 'de'))
    .slice(0, limit)
    .map((r) => r.product);
}
