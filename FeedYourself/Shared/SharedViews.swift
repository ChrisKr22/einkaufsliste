import SwiftData
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Produktbild: Foto aus dem Asset Catalog (Name = Katalog-ID), sonst Kategorie-Fläche mit Symbol.
struct ProductThumb: View {
    let catalogID: String?
    let style: CategoryStyle
    var size: CGFloat = 52

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.23)
                .fill(Color(hex: style.tintHex))
            if let image = bundledImage {
                image
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.06)
            } else {
                Image(systemName: style.symbol)
                    .font(.system(size: size * 0.42, weight: .medium))
                    .foregroundStyle(Color(hex: style.inkHex))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var bundledImage: Image? {
        #if canImport(UIKit)
        guard let catalogID, let uiImage = UIImage(named: catalogID) else { return nil }
        return Image(uiImage: uiImage)
        #else
        return nil
        #endif
    }
}

struct ToastView: View {
    let toast: Toast
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(toast.text)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
            if toast.canUndo {
                Button("Rückgängig", action: onUndo)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.toastAction)
                    .frame(minHeight: 40)
            }
        }
        .foregroundStyle(Theme.toastText)
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .frame(minHeight: 48)
        .background(Theme.toastBackground, in: RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.2), radius: 12, y: 6)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

#if DEBUG
/// Beispieldaten für SwiftUI-Previews (In-Memory-Datenbank mit dem echten Katalog).
@MainActor
enum PreviewSupport {
    private static var containers: [ModelContainer] = []

    static func repository(sample: Bool = true) -> ShoppingRepository {
        let container = try! FeedYourselfSchema.makeContainer(inMemory: true)
        containers.append(container)   // am Leben halten
        CatalogImporter.importBundledCatalogIfNeeded(into: container.mainContext, defaults: UserDefaults(suiteName: "preview.\(UUID())")!)
        let repository = SwiftDataShoppingRepository(context: container.mainContext)
        if sample, let products = try? repository.products() {
            let wanted: [(String, Int, String)] = [
                ("Äpfel", 2, "Elstar"), ("Tomaten", 4, ""), ("Brot", 1, "Dinkelvollkorn"),
                ("Milch", 2, "1,5 %"), ("Spaghetti", 1, "Barilla Nr. 5"), ("Olivenöl", 1, ""),
            ]
            for (name, quantity, note) in wanted {
                if let product = products.first(where: { $0.name == name }) {
                    _ = try? repository.add(productID: product.id, quantity: quantity, note: note)
                }
            }
        }
        return repository
    }
}
#endif
