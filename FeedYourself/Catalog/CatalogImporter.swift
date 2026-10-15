import Foundation
import SwiftData

/// Aufbau von Catalog/catalog.json (wird als Ressource mitgeliefert).
struct CatalogFile: Decodable {
    struct Category: Decodable {
        let id: String
        let name: String
    }

    struct Product: Decodable {
        let id: String
        let name: String
        let category: String
        let synonyms: [String]
    }

    let version: Int
    let categories: [Category]
    let products: [Product]
}

struct CatalogImportSummary: Equatable {
    var categoriesAdded = 0
    var productsAdded = 0
    var productsUpdated = 0
    var skipped = false
}

/// Übernimmt den mitgelieferten Katalog in die Datenbank.
/// - Erster Start: alle Kategorien und Produkte anlegen.
/// - Neuere Katalog-Version: fehlende ergänzen, Synonyme aktualisieren.
///   Namen und Reihenfolge, die der Nutzer geändert haben könnte, bleiben unangetastet.
@MainActor
enum CatalogImporter {
    static let versionKey = "catalog.importedVersion"

    static func importBundledCatalogIfNeeded(into context: ModelContext, bundle: Bundle = .main, defaults: UserDefaults = .standard) {
        guard let url = bundle.url(forResource: "catalog", withExtension: "json") else {
            assertionFailure("catalog.json fehlt im App-Bundle")
            return
        }
        do {
            let catalog = try JSONDecoder().decode(CatalogFile.self, from: Data(contentsOf: url))
            try importCatalog(catalog, into: context, defaults: defaults)
        } catch {
            assertionFailure("Katalog-Import fehlgeschlagen: \(error)")
        }
    }

    @discardableResult
    static func importCatalog(_ catalog: CatalogFile, into context: ModelContext, defaults: UserDefaults) throws -> CatalogImportSummary {
        var summary = CatalogImportSummary()
        let existingCategories = try context.fetch(FetchDescriptor<CategoryModel>())
        let isEmpty = existingCategories.isEmpty
        guard isEmpty || catalog.version > defaults.integer(forKey: versionKey) else {
            summary.skipped = true
            return summary
        }

        var categoriesByKey = Dictionary(existingCategories.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
        var nextSortOrder = (existingCategories.map(\.sortOrder).max() ?? -1) + 1
        for item in catalog.categories where categoriesByKey[item.id] == nil {
            let category = CategoryModel(key: item.id, name: item.name, sortOrder: nextSortOrder, style: .forKey(item.id))
            nextSortOrder += 1
            context.insert(category)
            categoriesByKey[item.id] = category
            summary.categoriesAdded += 1
        }

        let existingProducts = try context.fetch(FetchDescriptor<ProductModel>())
        let productsByCatalogID = Dictionary(
            existingProducts.compactMap { product in product.catalogID.map { ($0, product) } },
            uniquingKeysWith: { first, _ in first }
        )
        for item in catalog.products {
            let category = categoriesByKey[item.category] ?? categoriesByKey[CategoryStyle.fallbackKey]
            if let product = productsByCatalogID[item.id] {
                if product.synonyms != item.synonyms {
                    product.synonyms = item.synonyms
                    summary.productsUpdated += 1
                }
                if product.category == nil { product.category = category }
            } else {
                context.insert(ProductModel(catalogID: item.id, name: item.name, synonyms: item.synonyms, category: category, isCustom: false))
                summary.productsAdded += 1
            }
        }

        try context.save()
        defaults.set(catalog.version, forKey: versionKey)
        return summary
    }
}
