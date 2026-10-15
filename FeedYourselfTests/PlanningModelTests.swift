import Foundation
import Testing
@testable import FeedYourself

@MainActor
struct PlanningModelTests {
    @Test func enterAddsBestMatchAndClearsSearch() throws {
        let store = try TestStore()
        let model = PlanningModel(repository: store.repository)
        model.query = "oliven"
        model.submitSearch()
        #expect(model.query.isEmpty)
        #expect(model.plannedItems.map(\.product.name) == ["Olivenöl"])
        #expect(model.toast?.canUndo == true)
        #expect(model.addedCount == 1)
    }

    @Test func enterCreatesUnknownProduct() throws {
        let store = try TestStore()
        let model = PlanningModel(repository: store.repository)
        model.query = "zzz drachenfrucht"
        #expect(model.suggestions.isEmpty)
        #expect(model.canCreateFromQuery)
        model.submitSearch()
        #expect(model.plannedItems.first?.product.name == "Zzz drachenfrucht")
        #expect(model.plannedItems.first?.product.isCustom == true)
    }

    @Test func noCreateOptionForExactName() throws {
        let store = try TestStore()
        let model = PlanningModel(repository: store.repository)
        model.query = "milch"
        #expect(!model.canCreateFromQuery)
    }

    @Test func suggestionShowsWhenAlreadyOnList() throws {
        let store = try TestStore()
        let model = PlanningModel(repository: store.repository)
        model.query = "Milch"
        model.submitSearch()
        model.query = "Milch"
        let first = try #require(model.suggestions.first)
        #expect(first.isOnList)
        #expect(first.subtitle.contains("Schon auf der Liste"))
    }

    @Test func decrementAtOneRemovesAndUndoRestores() throws {
        let store = try TestStore()
        let model = PlanningModel(repository: store.repository)
        model.query = "Butter"
        model.submitSearch()
        let item = try #require(model.plannedItems.first)
        model.decrement(item)
        #expect(model.plannedItems.isEmpty)
        model.undo()
        #expect(model.plannedItems.map(\.id) == [item.id])
    }

    @Test func undoAfterAddRemovesAgain() throws {
        let store = try TestStore()
        let model = PlanningModel(repository: store.repository)
        model.query = "Brot"
        model.submitSearch()
        model.undo()
        #expect(model.plannedItems.isEmpty)
    }

    @Test func sectionsFollowStoreOrder() throws {
        let store = try TestStore()
        let model = PlanningModel(repository: store.repository)
        for query in ["Waschmittel", "Milch", "Äpfel"] {
            model.query = query
            model.submitSearch()
        }
        #expect(model.sections.map(\.category.key) == ["obst", "milch", "drogerie"])
    }
}
