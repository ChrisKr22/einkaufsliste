import Foundation

/// Zugriff auf Kategorien, Produkte und die Einkaufsliste.
/// Ansichten und ViewModels sprechen nur mit diesem Protokoll, nie direkt mit SwiftData.
@MainActor
protocol ShoppingRepository: AnyObject {
    func categories() throws -> [ShopCategory]
    func products() throws -> [ShopProduct]
    /// Alle Einträge der aktiven Liste (offen, im Wagen, zurückgestellt), älteste zuerst.
    func listItems() throws -> [ListItem]

    /// Legt das Produkt auf die Liste. Steht es schon drauf (nicht im Wagen), wird die Menge um 1 erhöht.
    /// Ohne Angaben werden Menge und Anmerkung vom letzten Einkauf übernommen.
    @discardableResult
    func add(productID: UUID, quantity: Int?, note: String?) throws -> AddResult

    /// Neues eigenes Produkt (z. B. aus der Suche „als neues Produkt anlegen“).
    func createProduct(name: String, categoryID: UUID?) throws -> ShopProduct

    func setQuantity(_ quantity: Int, entryID: UUID) throws
    func setNote(_ note: String, entryID: UUID) throws
    func remove(entryID: UUID) throws

    /// Stellt einen entfernten Eintrag unverändert wieder her (für „Rückgängig“).
    func restore(_ item: ListItem) throws
}
