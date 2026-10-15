import Foundation

/// Tolerante Produktsuche: Groß/Klein, Umlaute (Öl = Ol = Oel), Teilwörter, Synonyme, kleine Tippfehler.
enum ProductSearch {
    /// Liefert die besten Treffer, häufig gekaufte Produkte zuerst bei gleicher Güte.
    static func search(_ query: String, in products: [ShopProduct], limit: Int = 6) -> [ShopProduct] {
        let q = TextNormalizer.fold(query)
        guard !q.isEmpty else { return [] }

        let scored: [(product: ShopProduct, score: Double)] = products.compactMap { product in
            score(query: q, product: product).map { (product, $0) }
        }
        return scored
            .sorted { a, b in
                if a.score != b.score { return a.score < b.score }
                if a.product.purchaseCount != b.product.purchaseCount { return a.product.purchaseCount > b.product.purchaseCount }
                if a.product.name.count != b.product.name.count { return a.product.name.count < b.product.name.count }
                return a.product.name.localizedStandardCompare(b.product.name) == .orderedAscending
            }
            .prefix(limit)
            .map(\.product)
    }

    /// Kleinere Zahl = besserer Treffer, nil = kein Treffer.
    static func score(query q: String, product: ShopProduct) -> Double? {
        let names = TextNormalizer.variants(product.name)
        let synonyms = product.synonyms.flatMap(TextNormalizer.variants)

        if names.contains(where: { $0.hasPrefix(q) }) { return 0 }
        if names.contains(where: { TextNormalizer.words($0).contains { $0.hasPrefix(q) } }) { return 0.5 }
        if names.contains(where: { $0.contains(q) }) { return 1 }
        if synonyms.contains(where: { $0.hasPrefix(q) }) { return 2 }
        if synonyms.contains(where: { TextNormalizer.words($0).contains { $0.hasPrefix(q) } }) { return 2.5 }
        if synonyms.contains(where: { $0.contains(q) }) { return 3 }

        // Tippfehler: ab 4 Zeichen ein falscher, fehlender oder vertauschter Buchstabe.
        if q.count >= 4 {
            let words = (names + synonyms).flatMap(TextNormalizer.words)
            if words.contains(where: { TextNormalizer.isWithinOneEdit(q, ofPrefixOf: $0) }) { return 4 }
        }
        return nil
    }
}

enum TextNormalizer {
    /// Kleinbuchstaben, ß → ss, Akzente/Umlaute entfernt (ä → a).
    static func fold(_ text: String) -> String {
        text.lowercased()
            .replacingOccurrences(of: "ß", with: "ss")
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "de_DE"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Umlaute ausgeschrieben (ä → ae), damit auch „oel“ das Olivenöl findet.
    static func expand(_ text: String) -> String {
        fold(text.lowercased()
            .replacingOccurrences(of: "ä", with: "ae")
            .replacingOccurrences(of: "ö", with: "oe")
            .replacingOccurrences(of: "ü", with: "ue"))
    }

    static func variants(_ text: String) -> [String] {
        let a = fold(text), b = expand(text)
        return a == b ? [a] : [a, b]
    }

    static func words(_ text: String) -> [String] {
        text.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "," || $0 == "(" || $0 == ")" }).map(String.init)
    }

    /// Ist `query` höchstens eine Änderung vom gleich langen Anfang von `word` entfernt?
    static func isWithinOneEdit(_ query: String, ofPrefixOf word: String) -> Bool {
        let q = Array(query)
        let w = Array(word)
        guard w.count >= q.count - 1 else { return false }
        // Vergleich mit Präfixen der Länge q-1 … q+1 (fehlender / zusätzlicher Buchstabe).
        for length in max(1, q.count - 1)...min(w.count, q.count + 1) {
            if distance(q, Array(w.prefix(length))) <= 1 { return true }
        }
        return false
    }

    /// Damerau-Levenshtein (mit Vertauschung benachbarter Zeichen).
    static func distance(_ a: [Character], _ b: [Character]) -> Int {
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var d = Array(repeating: Array(repeating: 0, count: b.count + 1), count: a.count + 1)
        for i in 0...a.count { d[i][0] = i }
        for j in 0...b.count { d[0][j] = j }
        for i in 1...a.count {
            for j in 1...b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
                if i > 1, j > 1, a[i - 1] == b[j - 2], a[i - 2] == b[j - 1] {
                    d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
                }
            }
        }
        return d[a.count][b.count]
    }
}
