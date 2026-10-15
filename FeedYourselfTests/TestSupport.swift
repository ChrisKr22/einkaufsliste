import Foundation
import SwiftData
@testable import FeedYourself

@MainActor
struct TestStore {
    let container: ModelContainer
    let repository: SwiftDataShoppingRepository
    let defaults: UserDefaults

    var context: ModelContext { container.mainContext }

    /// Frische In-Memory-Datenbank mit dem mitgelieferten Katalog.
    init(importCatalog: Bool = true) throws {
        container = try FeedYourselfSchema.makeContainer(inMemory: true)
        defaults = UserDefaults(suiteName: "tests.\(UUID().uuidString)")!
        if importCatalog {
            CatalogImporter.importBundledCatalogIfNeeded(into: container.mainContext, defaults: defaults)
        }
        repository = SwiftDataShoppingRepository(context: container.mainContext)
    }

    func product(named name: String) throws -> ShopProduct {
        guard let product = try repository.products().first(where: { $0.name == name }) else {
            throw RepositoryError.notFound
        }
        return product
    }
}

func makeProduct(_ name: String, synonyms: [String] = [], purchaseCount: Int = 0) -> ShopProduct {
    ShopProduct(
        id: UUID(), catalogID: nil, name: name, synonyms: synonyms, categoryID: nil, isCustom: false,
        purchaseCount: purchaseCount, lastPurchasedAt: nil, lastQuantity: 1, lastNote: ""
    )
}
