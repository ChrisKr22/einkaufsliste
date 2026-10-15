import Foundation
import SwiftData

// SwiftData-Modelle. Alle Felder haben Standardwerte, keine Unique-Constraints,
// Beziehungen sind optional – Voraussetzung für einen späteren Sync.

@Model
final class CategoryModel {
    var id: UUID = UUID()
    var key: String = ""
    var name: String = ""
    var sortOrder: Int = 0
    var tintHex: String = CategoryStyle.fallback.tintHex
    var inkHex: String = CategoryStyle.fallback.inkHex
    var symbol: String = CategoryStyle.fallback.symbol

    @Relationship(deleteRule: .nullify, inverse: \ProductModel.category)
    var products: [ProductModel]? = []

    init(key: String, name: String, sortOrder: Int, style: CategoryStyle) {
        self.key = key
        self.name = name
        self.sortOrder = sortOrder
        self.tintHex = style.tintHex
        self.inkHex = style.inkHex
        self.symbol = style.symbol
    }
}

@Model
final class ProductModel {
    var id: UUID = UUID()
    var catalogID: String?
    var name: String = ""
    var synonyms: [String] = []
    var category: CategoryModel?
    var isCustom: Bool = false
    var purchaseCount: Int = 0
    var lastPurchasedAt: Date?
    var lastQuantity: Int = 1
    var lastNote: String = ""

    @Relationship(deleteRule: .cascade, inverse: \ListEntryModel.product)
    var entries: [ListEntryModel]? = []

    init(catalogID: String?, name: String, synonyms: [String], category: CategoryModel?, isCustom: Bool) {
        self.catalogID = catalogID
        self.name = name
        self.synonyms = synonyms
        self.category = category
        self.isCustom = isCustom
    }
}

@Model
final class ListEntryModel {
    var id: UUID = UUID()
    var product: ProductModel?
    var quantity: Int = 1
    var note: String = ""
    var statusRaw: String = EntryStatus.open.rawValue
    var addedAt: Date = Date()
    var checkedAt: Date?

    var status: EntryStatus {
        get { EntryStatus(rawValue: statusRaw) ?? .open }
        set { statusRaw = newValue.rawValue }
    }

    init(id: UUID = UUID(), product: ProductModel, quantity: Int, note: String, status: EntryStatus = .open, addedAt: Date = Date()) {
        self.id = id
        self.product = product
        self.quantity = quantity
        self.note = note
        self.statusRaw = status.rawValue
        self.addedAt = addedAt
    }
}

enum FeedYourselfSchema {
    static let models: [any PersistentModel.Type] = [CategoryModel.self, ProductModel.self, ListEntryModel.self]

    static func makeContainer(inMemory: Bool = false) throws -> ModelContainer {
        let configuration = ModelConfiguration(isStoredInMemoryOnly: inMemory)
        return try ModelContainer(for: Schema(models), configurations: configuration)
    }
}
