import Foundation
import Observation

struct PlanningSection: Identifiable, Equatable {
    let category: ShopCategory
    let items: [ListItem]
    var id: UUID { category.id }
}

struct Suggestion: Identifiable, Equatable {
    let product: ShopProduct
    let style: CategoryStyle
    let subtitle: String
    let isOnList: Bool
    var id: UUID { product.id }
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let canUndo: Bool
}

/// Zustand und Aktionen des Planungsmodus.
@MainActor
@Observable
final class PlanningModel {
    private let repository: ShoppingRepository

    private(set) var categories: [ShopCategory] = []
    private(set) var products: [ShopProduct] = []
    private(set) var items: [ListItem] = []
    private(set) var toast: Toast?
    private(set) var errorMessage: String?
    /// Zählt Hinzufügungen hoch – Auslöser für haptisches Feedback.
    private(set) var addedCount = 0

    var query = ""
    var editingItemID: UUID?

    @ObservationIgnored private var undoAction: (() throws -> Void)?
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    init(repository: ShoppingRepository) {
        self.repository = repository
        reload()
    }

    // MARK: Abgeleitete Werte

    /// Einträge auf der Liste (ohne die bereits im Wagen liegenden).
    var plannedItems: [ListItem] { items.filter { $0.status != .inCart } }

    var plannedCount: Int { plannedItems.count }

    var sections: [PlanningSection] {
        let byCategory = Dictionary(grouping: plannedItems) { $0.product.categoryID }
        let fallback = categories.first { $0.key == CategoryStyle.fallbackKey }
        var result: [PlanningSection] = categories.compactMap { category in
            var entries = byCategory[category.id] ?? []
            if category.id == fallback?.id {
                // Produkte ohne (gültige) Kategorie landen unter „Sonstiges“.
                let known = Set(categories.map(\.id))
                entries += plannedItems.filter { $0.product.categoryID == nil || !known.contains($0.product.categoryID!) }
            }
            return entries.isEmpty ? nil : PlanningSection(category: category, items: entries)
        }
        result.sort { $0.category.sortOrder < $1.category.sortOrder }
        return result
    }

    var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var suggestions: [Suggestion] {
        ProductSearch.search(trimmedQuery, in: products).map(makeSuggestion)
    }

    /// „„xyz“ als neues Produkt anlegen“ nur, wenn es kein Produkt mit genau diesem Namen gibt.
    var canCreateFromQuery: Bool {
        let q = TextNormalizer.fold(trimmedQuery)
        return !q.isEmpty && !products.contains { TextNormalizer.fold($0.name) == q }
    }

    func style(for item: ListItem) -> CategoryStyle {
        category(for: item.product)?.style ?? .fallback
    }

    func category(for product: ShopProduct) -> ShopCategory? {
        categories.first { $0.id == product.categoryID }
    }

    var editingItem: ListItem? {
        guard let editingItemID else { return nil }
        return items.first { $0.id == editingItemID }
    }

    // MARK: Aktionen

    func reload() {
        do {
            categories = try repository.categories()
            products = try repository.products()
            items = try repository.listItems()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func add(_ suggestion: Suggestion) {
        add(productID: suggestion.product.id)
    }

    /// Enter im Suchfeld: besten Treffer übernehmen, sonst neues Produkt anlegen.
    func submitSearch() {
        if let first = suggestions.first {
            add(first)
        } else if canCreateFromQuery {
            createProductFromQuery()
        }
    }

    func createProductFromQuery() {
        let name = trimmedQuery
        guard !name.isEmpty else { return }
        perform {
            let capitalized = name.prefix(1).uppercased() + name.dropFirst()
            let product = try repository.createProduct(name: capitalized, categoryID: nil)
            let result = try repository.add(productID: product.id, quantity: 1, note: "")
            undoAction = { [repository] in try repository.remove(entryID: result.item.id) }
            finishAdd(text: "\(product.name) angelegt und hinzugefügt")
        }
    }

    func increment(_ item: ListItem) {
        perform { try repository.setQuantity(item.quantity + 1, entryID: item.id) }
    }

    /// Bei Menge 1 wird der Eintrag entfernt (mit Rückgängig).
    func decrement(_ item: ListItem) {
        if item.quantity > 1 {
            perform { try repository.setQuantity(item.quantity - 1, entryID: item.id) }
        } else {
            remove(item)
        }
    }

    func setQuantity(_ quantity: Int, for item: ListItem) {
        perform { try repository.setQuantity(quantity, entryID: item.id) }
    }

    func setNote(_ note: String, for item: ListItem) {
        perform { try repository.setNote(note, entryID: item.id) }
    }

    func remove(_ item: ListItem) {
        perform {
            try repository.remove(entryID: item.id)
            if editingItemID == item.id { editingItemID = nil }
            undoAction = { [repository] in try repository.restore(item) }
            showToast("\(item.product.name) entfernt", canUndo: true)
        }
    }

    func undo() {
        guard let action = undoAction else { return }
        undoAction = nil
        perform {
            try action()
            dismissToast()
        }
    }

    func dismissToast() {
        toastTask?.cancel()
        toast = nil
    }

    func clearError() { errorMessage = nil }

    // MARK: Intern

    private func add(productID: UUID) {
        perform {
            let result = try repository.add(productID: productID, quantity: nil, note: nil)
            switch result {
            case .added(let item):
                undoAction = { [repository] in try repository.remove(entryID: item.id) }
                finishAdd(text: "\(item.product.name) hinzugefügt")
            case .incremented(let item, let previous):
                undoAction = { [repository] in try repository.setQuantity(previous, entryID: item.id) }
                finishAdd(text: "\(item.product.name): jetzt \(item.quantity)×")
            }
        }
    }

    private func finishAdd(text: String) {
        query = ""
        addedCount += 1
        showToast(text, canUndo: true)
    }

    private func makeSuggestion(_ product: ShopProduct) -> Suggestion {
        let onList = plannedItems.first { $0.product.id == product.id }
        let categoryName = category(for: product)?.name ?? "Sonstiges"
        let subtitle: String
        if let onList {
            subtitle = "Schon auf der Liste · \(onList.quantity)× → +1"
        } else if product.purchaseCount > 0 {
            subtitle = "Zuletzt: \(product.lastQuantity)×" + (product.lastNote.isEmpty ? "" : " · \(product.lastNote)")
        } else {
            subtitle = categoryName
        }
        return Suggestion(product: product, style: category(for: product)?.style ?? .fallback, subtitle: subtitle, isOnList: onList != nil)
    }

    private func perform(_ work: () throws -> Void) {
        do {
            try work()
        } catch {
            errorMessage = error.localizedDescription
        }
        reload()
    }

    private func showToast(_ text: String, canUndo: Bool) {
        toastTask?.cancel()
        toast = Toast(text: text, canUndo: canUndo)
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3.5))
            guard !Task.isCancelled else { return }
            self?.toast = nil
            self?.undoAction = nil
        }
    }
}
