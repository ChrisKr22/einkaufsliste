import Foundation
import SwiftData
import Testing
@testable import FeedYourself

@MainActor
struct CatalogImporterTests {
    private func bundledCatalog() throws -> CatalogFile {
        let url = try #require(Bundle.main.url(forResource: "catalog", withExtension: "json"))
        return try JSONDecoder().decode(CatalogFile.self, from: Data(contentsOf: url))
    }

    @Test func firstLaunchImportsEverything() throws {
        let store = try TestStore()
        let catalog = try bundledCatalog()
        let categories = try store.repository.categories()
        #expect(categories.count == catalog.categories.count)
        #expect(try store.repository.products().count == catalog.products.count)
        #expect(categories.map(\.key) == catalog.categories.map(\.id), "Reihenfolge wie in catalog.json")
        #expect(store.defaults.integer(forKey: CatalogImporter.versionKey) == catalog.version)
    }

    @Test func everyProductHasACategory() throws {
        let store = try TestStore()
        #expect(try store.repository.products().allSatisfy { $0.categoryID != nil })
    }

    @Test func sameVersionIsNotImportedTwice() throws {
        let store = try TestStore()
        let summary = try CatalogImporter.importCatalog(bundledCatalog(), into: store.context, defaults: store.defaults)
        #expect(summary.skipped)
        #expect(try store.repository.products().count == bundledCatalog().products.count)
    }

    @Test func newerVersionAddsMissingAndKeepsUserChanges() throws {
        let store = try TestStore(importCatalog: false)
        let v1 = CatalogFile(
            version: 1,
            categories: [.init(id: "obst", name: "Obst"), .init(id: "sonst", name: "Sonstiges")],
            products: [.init(id: "aepfel", name: "Äpfel", category: "obst", synonyms: ["Apfel"])]
        )
        try CatalogImporter.importCatalog(v1, into: store.context, defaults: store.defaults)

        // Nutzer benennt eine Kategorie um.
        let obst = try #require(try store.context.fetch(FetchDescriptor<CategoryModel>()).first { $0.key == "obst" })
        obst.name = "Früchte"

        let v2 = CatalogFile(
            version: 2,
            categories: v1.categories + [.init(id: "gemuese", name: "Gemüse")],
            products: [
                .init(id: "aepfel", name: "Äpfel", category: "obst", synonyms: ["Apfel", "Äppel"]),
                .init(id: "tomaten", name: "Tomaten", category: "gemuese", synonyms: []),
            ]
        )
        let summary = try CatalogImporter.importCatalog(v2, into: store.context, defaults: store.defaults)

        #expect(summary.categoriesAdded == 1)
        #expect(summary.productsAdded == 1)
        #expect(summary.productsUpdated == 1)
        let categories = try store.repository.categories()
        #expect(categories.first { $0.key == "obst" }?.name == "Früchte")
        #expect(categories.last?.key == "gemuese", "neue Kategorien kommen ans Ende des Laufwegs")
        #expect(try store.product(named: "Äpfel").synonyms == ["Apfel", "Äppel"])
    }
}
