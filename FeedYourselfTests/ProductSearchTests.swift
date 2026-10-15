import Testing
@testable import FeedYourself

struct ProductSearchTests {
    let products = [
        makeProduct("Olivenöl", synonyms: ["Öl"]),
        makeProduct("Rapsöl", synonyms: ["Sonnenblumenöl", "Öl"]),
        makeProduct("Spaghetti", synonyms: ["Nudeln", "Pasta"]),
        makeProduct("Penne", synonyms: ["Nudeln", "Pasta"]),
        makeProduct("Tomaten", synonyms: ["Tomate"]),
        makeProduct("Gehackte Tomaten", synonyms: ["Dosentomaten"]),
        makeProduct("Karotten", synonyms: ["Möhren"]),
        makeProduct("Brötchen", synonyms: ["Semmeln"]),
    ]

    private func names(_ query: String) -> [String] {
        ProductSearch.search(query, in: products).map(\.name)
    }

    @Test func emptyQueryFindsNothing() {
        #expect(names("").isEmpty)
        #expect(names("   ").isEmpty)
    }

    @Test func prefixOfNameComesFirst() {
        #expect(names("tom").first == "Tomaten")
    }

    @Test func wordInsideNameIsFound() {
        #expect(names("tomaten").contains("Gehackte Tomaten"))
    }

    @Test func synonymsAreFound() {
        #expect(Set(names("nud")) == ["Spaghetti", "Penne"])
        #expect(names("möhre") == ["Karotten"])
    }

    @Test(arguments: ["öl", "Öl", "ol", "oel"])
    func umlautsAreTolerated(_ query: String) {
        #expect(names(query).contains("Olivenöl"))
    }

    @Test func expandedUmlautsInName() {
        #expect(names("broetchen") == ["Brötchen"])
        #expect(names("brotchen") == ["Brötchen"])
    }

    @Test func smallTyposAreTolerated() {
        #expect(names("Tomtaen").contains("Tomaten"))   // vertauscht
        #expect(names("Spagetti").contains("Spaghetti")) // fehlender Buchstabe
    }

    @Test func shortQueriesDoNotMatchByTypo() {
        #expect(names("xyz").isEmpty)
    }

    @Test func frequentlyBoughtWinsTies() {
        let list = [makeProduct("Penne", synonyms: ["Nudeln"]), makeProduct("Fusilli", synonyms: ["Nudeln"], purchaseCount: 5)]
        #expect(ProductSearch.search("nudeln", in: list).first?.name == "Fusilli")
    }

    @Test func limitIsRespected() {
        #expect(ProductSearch.search("e", in: products, limit: 2).count == 2)
    }
}
