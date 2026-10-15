import SwiftUI

/// Bearbeiten-Sheet: Menge und Anmerkung (Sorte, Marke …), Entfernen.
struct EditEntrySheet: View {
    let item: ListItem
    let style: CategoryStyle
    let categoryName: String
    let model: PlanningModel

    @State private var note: String
    @FocusState private var noteFocused: Bool
    @Environment(\.dismiss) private var dismiss

    init(item: ListItem, style: CategoryStyle, categoryName: String, model: PlanningModel) {
        self.item = item
        self.style = style
        self.categoryName = categoryName
        self.model = model
        _note = State(initialValue: item.note)
    }

    /// Aktueller Stand aus dem Modell (Menge ändert sich, während das Sheet offen ist).
    private var current: ListItem? { model.items.first { $0.id == item.id } }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 14) {
                ProductThumb(catalogID: item.product.catalogID, style: style, size: 72)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.product.name)
                        .font(.title2.weight(.bold))
                    Text(categoryName)
                        .font(.subheadline)
                        .foregroundStyle(Theme.text2)
                }
                Spacer(minLength: 0)
            }

            HStack {
                Text("Menge").font(.headline)
                Spacer()
                QuantityStepper(
                    quantity: current?.quantity ?? item.quantity,
                    name: item.product.name,
                    large: true,
                    onDecrement: {
                        if let current, current.quantity > 1 { model.setQuantity(current.quantity - 1, for: current) }
                    },
                    onIncrement: {
                        if let current { model.setQuantity(current.quantity + 1, for: current) }
                    }
                )
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Anmerkung").font(.headline)
                TextField("z. B. Sorte, Marke, Größe", text: $note, axis: .vertical)
                    .lineLimit(2...4)
                    .focused($noteFocused)
                    .padding(12)
                    .background(Theme.background, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border))
                    .accessibilityLabel("Anmerkung")
            }

            HStack(spacing: 10) {
                Button("Entfernen") {
                    if let current { model.remove(current) }
                    dismiss()
                }
                .buttonStyle(SecondaryButtonStyle())

                Button("Fertig") {
                    saveNote()
                    dismiss()
                }
                .buttonStyle(PrimaryButtonStyle())
            }

            Spacer(minLength: 0)
        }
        .padding(20)
        .foregroundStyle(Theme.text)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.surface)
        .onDisappear(perform: saveNote)
    }

    private func saveNote() {
        guard let current else { return }   // wurde entfernt
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed != current.note { model.setNote(trimmed, for: current) }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.onAccent)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Theme.accentFill, in: RoundedRectangle(cornerRadius: 14))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.text)
            .frame(maxWidth: .infinity, minHeight: 52)
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}
