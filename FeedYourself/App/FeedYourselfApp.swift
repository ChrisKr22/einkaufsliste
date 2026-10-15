import SwiftData
import SwiftUI

@main
struct FeedYourselfApp: App {
    private let container: ModelContainer
    private let repository: SwiftDataShoppingRepository

    init() {
        do {
            container = try FeedYourselfSchema.makeContainer()
        } catch {
            fatalError("Die Datenbank konnte nicht geöffnet werden: \(error)")
        }
        CatalogImporter.importBundledCatalogIfNeeded(into: container.mainContext)
        repository = SwiftDataShoppingRepository(context: container.mainContext)
    }

    var body: some Scene {
        WindowGroup {
            RootView(repository: repository)
        }
        .modelContainer(container)
    }
}
