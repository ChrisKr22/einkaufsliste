import Foundation

/// Farbfläche, Symbolfarbe und SF Symbol einer Kategorie (Platzhalter, solange ein Produkt kein Foto hat).
struct CategoryStyle: Hashable, Sendable {
    var tintHex: String
    var inkHex: String
    var symbol: String

    static let fallbackKey = "sonst"
    static let fallback = CategoryStyle(tintHex: "#E8E5E4", inkHex: "#5E5759", symbol: "bag.fill")

    /// Vorgaben für die Kategorien aus catalog.json. Neue Kategorien bekommen `fallback`.
    static func forKey(_ key: String) -> CategoryStyle {
        presets[key] ?? fallback
    }

    private static let presets: [String: CategoryStyle] = [
        "obst": .init(tintHex: "#F8E3E0", inkHex: "#A1392F", symbol: "leaf.fill"),
        "gemuese": .init(tintHex: "#E2EDD9", inkHex: "#3E6A2B", symbol: "carrot.fill"),
        "back": .init(tintHex: "#F3E7D3", inkHex: "#8A5A1F", symbol: "basket.fill"),
        "fleisch": .init(tintHex: "#F5DEDB", inkHex: "#9A3B36", symbol: "fork.knife"),
        "fisch": .init(tintHex: "#DCE8F2", inkHex: "#2F5F86", symbol: "fish.fill"),
        "milch": .init(tintHex: "#E3EAF2", inkHex: "#3C5F86", symbol: "drop.fill"),
        "kaese": .init(tintHex: "#F6EDCB", inkHex: "#86651A", symbol: "triangle.fill"),
        "tk": .init(tintHex: "#DDEFF5", inkHex: "#2F6A7A", symbol: "snowflake"),
        "nudeln": .init(tintHex: "#EFE6D6", inkHex: "#7D6236", symbol: "takeoutbag.and.cup.and.straw.fill"),
        "konserven": .init(tintHex: "#EDE3DA", inkHex: "#7A4E33", symbol: "cylinder.fill"),
        "oel": .init(tintHex: "#E8EBD2", inkHex: "#5E6A1E", symbol: "flame.fill"),
        "backen": .init(tintHex: "#F4E2EA", inkHex: "#8A3F62", symbol: "birthday.cake.fill"),
        "snacks": .init(tintHex: "#F5E6D2", inkHex: "#8A5A1F", symbol: "star.fill"),
        "getraenke": .init(tintHex: "#DCEBEF", inkHex: "#2F6A7A", symbol: "wineglass.fill"),
        "drogerie": .init(tintHex: "#E6E4F2", inkHex: "#4C4A86", symbol: "bubbles.and.sparkles.fill"),
        "sonst": fallback,
    ]
}
