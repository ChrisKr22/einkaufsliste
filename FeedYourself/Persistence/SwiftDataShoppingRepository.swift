import Foundation
import SwiftData

@MainActor
final class SwiftDataShoppingRepository: ShoppingRepository {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    // MARK: Lesen

    func categories() throws -> [ShopCategory] {
        try fetchCategories().map(Self.map)
    }

    func products() throws -> [ShopProduct] {
        try context.fetch(FetchDescriptor<ProductModel>(sortBy: [SortDescriptor(\.name)])).map(Self.map)
    }

    func listItems() throws -> [ListItem] {
        try fetchEntries().compactMap(Self.map)
    }

    // MARK: Schreiben

    @discardableResult
    func add(productID: UUID, quantity: Int?, note: String?) throws -> AddResult {
        guard let product = try fetchProduct(productID) else { throw RepositoryError.notFound }

        if let existing = try fetchEntries().first(where: { $0.product?.id == productID && $0.status != .inCart }) {
            let previous = existing.quantity
            existing.quantity += 1
            existing.status = .open
            try context.save()
            return .incremented(Self.map(existing)!, previousQuantity: previous)
        }

        let entry = ListEntryModel(
            product: product,
            quantity: max(1, quantity ?? product.lastQuantity),
            note: note ?? product.lastNote
        )
        context.insert(entry)
        try context.save()
        return .added(Self.map(entry)!)
    }

    func createProduct(name: String, categoryID: UUID?) throws -> ShopProduct {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let categories = try fetchCategories()
        let category = categories.first { $0.id == categoryID }
            ?? categories.first { $0.key == CategoryStyle.fallbackKey }
            ?? categories.last
        let product = ProductModel(catalogID: nil, name: trimmed, synonyms: [], category: category, isCustom: true)
        context.insert(product)
        try context.save()
        return Self.map(product)
    }

    func setQuantity(_ quantity: Int, entryID: UUID) throws {
        guard let entry = try fetchEntry(entryID) else { throw RepositoryError.notFound }
        entry.quantity = max(1, quantity)
        try context.save()
    }

    func setNote(_ note: String, entryID: UUID) throws {
        guard let entry = try fetchEntry(entryID) else { throw RepositoryError.notFound }
        entry.note = note
        try context.save()
    }

    func remove(entryID: UUID) throws {
        guard let entry = try fetchEntry(entryID) else { throw RepositoryError.notFound }
        context.delete(entry)
        try context.save()
    }

    func restore(_ item: ListItem) throws {
        guard try fetchEntry(item.id) == nil else { return }
        guard let product = try fetchProduct(item.product.id) else { throw RepositoryError.notFound }
        let entry = ListEntryModel(
            id: item.id, product: product, quantity: item.quantity, note: item.note,
            status: item.status, addedAt: item.addedAt
        )
        context.insert(entry)
        try context.save()
    }

    // MARK: Hilfen

    private func fetchCategories() throws -> [CategoryModel] {
        try context.fetch(FetchDescriptor<CategoryModel>(sortBy: [SortDescriptor(\.sortOrder)]))
    }

    private func fetchEntries() throws -> [ListEntryModel] {
        try context.fetch(FetchDescriptor<ListEntryModel>(sortBy: [SortDescriptor(\.addedAt)]))
    }

    private func fetchProduct(_ id: UUID) throws -> ProductModel? {
        var descriptor = FetchDescriptor<ProductModel>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    private func fetchEntry(_ id: UUID) throws -> ListEntryModel? {
        var descriptor = FetchDescriptor<ListEntryModel>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    static func map(_ model: CategoryModel) -> ShopCategory {
        ShopCategory(
            id: model.id, key: model.key, name: model.name, sortOrder: model.sortOrder,
            style: CategoryStyle(tintHex: model.tintHex, inkHex: model.inkHex, symbol: model.symbol)
        )
    }

    static func map(_ model: ProductModel) -> ShopProduct {
        ShopProduct(
            id: model.id, catalogID: model.catalogID, name: model.name, synonyms: model.synonyms,
            categoryID: model.category?.id, isCustom: model.isCustom, purchaseCount: model.purchaseCount,
            lastPurchasedAt: model.lastPurchasedAt, lastQuantity: model.lastQuantity, lastNote: model.lastNote
        )
    }

    static func map(_ model: ListEntryModel) -> ListItem? {
        guard let product = model.product else { return nil }
        return ListItem(
            id: model.id, product: map(product), quantity: model.quantity, note: model.note,
            status: model.status, addedAt: model.addedAt
        )
    }
}
