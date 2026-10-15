import Foundation

// Werttypen, mit denen Ansichten und ViewModels arbeiten.
// Sie kennen SwiftData nicht – so lässt sich die Speicherung später austauschen
// oder um einen Sync (z. B. für eine Browser-Ansicht) ergänzen.

struct ShopCategory: Identifiable, Hashable, Sendable {
    let id: UUID
    var key: String          // stabile ID aus catalog.json, z. B. "obst"
    var name: String
    var sortOrder: Int       // Laufweg im Laden
    var style: CategoryStyle
}

struct ShopProduct: Identifiable, Hashable, Sendable {
    let id: UUID
    var catalogID: String?   // nil bei eigenen Produkten
    var name: String
    var synonyms: [String]
    var categoryID: UUID?
    var isCustom: Bool
    var purchaseCount: Int
    var lastPurchasedAt: Date?
    var lastQuantity: Int
    var lastNote: String
}

enum EntryStatus: String, Codable, Sendable {
    case open      // fehlt noch
    case inCart    // im Einkaufswagen
    case later     // zurückgestellt / nicht gefunden
}

struct ListItem: Identifiable, Hashable, Sendable {
    let id: UUID
    var product: ShopProduct
    var quantity: Int
    var note: String
    var status: EntryStatus
    var addedAt: Date
}

enum AddResult: Equatable {
    case added(ListItem)
    case incremented(ListItem, previousQuantity: Int)

    var item: ListItem {
        switch self {
        case .added(let item), .incremented(let item, _): item
        }
    }
}

enum RepositoryError: LocalizedError {
    case notFound

    var errorDescription: String? {
        switch self {
        case .notFound: "Der Eintrag wurde nicht gefunden."
        }
    }
}
