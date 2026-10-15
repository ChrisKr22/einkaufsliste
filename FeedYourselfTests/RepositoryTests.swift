import Foundation
import SwiftData
import Testing
@testable import FeedYourself

@MainActor
struct RepositoryTests {
    @Test func addPutsProductOnList() throws {
        let store = try TestStore()
        let apples = try store.product(named: "Äpfel")
        let result = try store.repository.add(productID: apples.id, quantity: 2, note: "Elstar")
        guard case .added(let item) = result else { Issue.record("erwartet: .added"); return }
        #expect(item.quantity == 2)
        #expect(item.note == "Elstar")
        #expect(item.status == .open)
        #expect(try store.repository.listItems().count == 1)
    }

    @Test func addingTwiceIncrementsInsteadOfDuplicating() throws {
        let store = try TestStore()
        let milk = try store.product(named: "Milch")
        try store.repository.add(productID: milk.id, quantity: nil, note: nil)
        let result = try store.repository.add(productID: milk.id, quantity: nil, note: nil)
        guard case .incremented(let item, let previous) = result else { Issue.record("erwartet: .incremented"); return }
        #expect(previous == 1)
        #expect(item.quantity == 2)
        #expect(try store.repository.listItems().count == 1)
    }

    @Test func usesLastQuantityAndNoteByDefault() throws {
        let store = try TestStore()
        let model = try #require(try store.context.fetch(FetchDescriptor<ProductModel>()).first { $0.name == "Eier" })
        model.lastQuantity = 2
        model.lastNote = "Freiland"
        try store.context.save()
        let item = try store.repository.add(productID: model.id, quantity: nil, note: nil).item
        #expect(item.quantity == 2)
        #expect(item.note == "Freiland")
    }

    @Test func quantityNeverDropsBelowOne() throws {
        let store = try TestStore()
        let item = try store.repository.add(productID: store.product(named: "Butter").id, quantity: 1, note: "").item
        try store.repository.setQuantity(0, entryID: item.id)
        #expect(try store.repository.listItems().first?.quantity == 1)
    }

    @Test func removeAndRestore() throws {
        let store = try TestStore()
        let item = try store.repository.add(productID: store.product(named: "Brot").id, quantity: 1, note: "Dinkel").item
        try store.repository.remove(entryID: item.id)
        #expect(try store.repository.listItems().isEmpty)
        try store.repository.restore(item)
        let restored = try #require(try store.repository.listItems().first)
        #expect(restored.id == item.id)
        #expect(restored.note == "Dinkel")
    }

    @Test func customProductsGoToMiscellaneous() throws {
        let store = try TestStore()
        let product = try store.repository.createProduct(name: "  Kokosmilch light ", categoryID: nil)
        #expect(product.name == "Kokosmilch light")
        #expect(product.isCustom)
        let misc = try store.repository.categories().first { $0.key == "sonst" }
        #expect(product.categoryID == misc?.id)
    }

    @Test func noteAndQuantityAreSaved() throws {
        let store = try TestStore()
        let item = try store.repository.add(productID: store.product(named: "Spaghetti").id, quantity: 1, note: "").item
        try store.repository.setNote("Barilla Nr. 5", entryID: item.id)
        try store.repository.setQuantity(3, entryID: item.id)
        let saved = try #require(try store.repository.listItems().first)
        #expect(saved.note == "Barilla Nr. 5")
        #expect(saved.quantity == 3)
    }
}
