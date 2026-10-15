import SwiftUI

struct EntryRow: View {
    let item: ListItem
    let style: CategoryStyle
    let onEdit: () -> Void
    let onIncrement: () -> Void
    let onDecrement: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onEdit) {
                HStack(spacing: 12) {
                    ProductThumb(catalogID: item.product.catalogID, style: style, size: 52)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.product.name)
                            .font(.body.weight(.medium))
                            .foregroundStyle(Theme.text)
                        noteLine
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(accessibilityText)
            .accessibilityHint("Menge und Anmerkung bearbeiten")

            QuantityStepper(
                quantity: item.quantity,
                name: item.product.name,
                onDecrement: onDecrement,
                onIncrement: onIncrement
            )
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var noteLine: some View {
        if item.status == .later {
            Text(item.note.isEmpty ? "Zurückgestellt" : "Zurückgestellt · \(item.note)")
                .font(.footnote)
                .foregroundStyle(Theme.later)
                .lineLimit(1)
        } else if item.note.isEmpty {
            Text("Anmerkung hinzufügen")
                .font(.footnote)
                .italic()
                .foregroundStyle(Theme.placeholder)
        } else {
            Text(item.note)
                .font(.footnote)
                .foregroundStyle(Theme.text2)
                .lineLimit(1)
        }
    }

    private var accessibilityText: String {
        var parts = ["\(item.product.name), \(item.quantity) Stück"]
        if !item.note.isEmpty { parts.append(item.note) }
        if item.status == .later { parts.append("zurückgestellt") }
        return parts.joined(separator: ", ")
    }
}

struct QuantityStepper: View {
    let quantity: Int
    let name: String
    var large = false
    let onDecrement: () -> Void
    let onIncrement: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            stepButton(systemImage: "minus", label: "\(name) weniger", action: onDecrement)
            Text("\(quantity)×")
                .font((large ? Font.title3 : Font.subheadline).weight(.semibold))
                .monospacedDigit()
                .frame(minWidth: large ? 40 : 28)
                .accessibilityHidden(true)
            stepButton(systemImage: "plus", label: "\(name) mehr", action: onIncrement)
        }
        .foregroundStyle(Theme.text)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityValue("\(quantity) Stück")
    }

    private func stepButton(systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: large ? 17 : 14, weight: .bold))
                .frame(width: large ? 44 : 40, height: large ? 44 : 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(label)
    }
}

struct SuggestionRow: View {
    let suggestion: Suggestion
    let onAdd: () -> Void

    var body: some View {
        Button(action: onAdd) {
            HStack(spacing: 12) {
                ProductThumb(catalogID: suggestion.product.catalogID, style: suggestion.style, size: 40)
                VStack(alignment: .leading, spacing: 1) {
                    Text(suggestion.product.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(Theme.text)
                    Text(suggestion.subtitle)
                        .font(.footnote)
                        .foregroundStyle(Theme.text2)
                }
                Spacer(minLength: 0)
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.accentInk)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("\(suggestion.product.name) hinzufügen")
        .accessibilityHint(suggestion.subtitle)
    }
}

struct CreateProductRow: View {
    let name: String
    let onCreate: () -> Void

    var body: some View {
        Button(action: onCreate) {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(Theme.accentInk, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                    .frame(width: 40, height: 40)
                    .overlay(Image(systemName: "plus").font(.system(size: 16, weight: .semibold)))
                Text("„\(name)“ als neues Produkt anlegen")
                    .font(.subheadline.weight(.medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(Theme.accentInk)
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
    }
}
