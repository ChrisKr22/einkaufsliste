import SwiftUI

struct PlanningView: View {
    @Bindable var model: PlanningModel
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SearchField(text: $model.query, isFocused: $searchFocused, onSubmit: model.submitSearch)
                .padding(.horizontal, 16)
                .padding(.bottom, 4)

            List {
                if !model.trimmedQuery.isEmpty {
                    suggestionsSection
                } else if model.sections.isEmpty {
                    emptyState
                }

                ForEach(model.sections) { section in
                    Section {
                        ForEach(section.items) { item in
                            EntryRow(
                                item: item,
                                style: section.category.style,
                                onEdit: { model.editingItemID = item.id },
                                onIncrement: { model.increment(item) },
                                onDecrement: { model.decrement(item) }
                            )
                            .listRowBackground(Theme.surface)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button {
                                    model.remove(item)
                                } label: {
                                    Label("Entfernen", systemImage: "trash")
                                }
                                .tint(Theme.text2)
                            }
                        }
                    } header: {
                        SectionHeader(title: section.category.name, count: section.items.count)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .contentMargins(.bottom, 72, for: .scrollContent)
            .animation(.snappy, value: model.items)
        }
        .sheet(item: editingBinding) { item in
            EditEntrySheet(
                item: item,
                style: model.style(for: item),
                categoryName: model.category(for: item.product)?.name ?? "Sonstiges",
                model: model
            )
        }
    }

    private var suggestionsSection: some View {
        Section {
            ForEach(model.suggestions) { suggestion in
                SuggestionRow(suggestion: suggestion) {
                    model.add(suggestion)
                    searchFocused = true
                }
                .listRowBackground(Theme.surface)
            }
            if model.canCreateFromQuery {
                CreateProductRow(name: model.trimmedQuery) {
                    model.createProductFromQuery()
                    searchFocused = true
                }
                .listRowBackground(Theme.surface)
            }
        } header: {
            SectionHeader(title: "Vorschläge", count: nil)
        }
    }

    private var emptyState: some View {
        Section {
            VStack(spacing: 8) {
                Image(systemName: "basket")
                    .font(.system(size: 40, weight: .light))
                    .foregroundStyle(Theme.text2)
                Text("Noch nichts geplant")
                    .font(.headline)
                Text("Tippe oben ein, was du brauchst – mit Enter landet es auf der Liste.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.text2)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 32)
            .listRowBackground(Color.clear)
        }
    }

    private var editingBinding: Binding<ListItem?> {
        Binding(get: { model.editingItem }, set: { model.editingItemID = $0?.id })
    }
}

struct SectionHeader: View {
    let title: String
    let count: Int?

    var body: some View {
        HStack(spacing: 4) {
            Text(title.uppercased())
                .fontWeight(.semibold)
            if let count {
                Text("· \(count)")
            }
        }
        .font(.footnote)
        .tracking(0.6)
        .foregroundStyle(Theme.text2)
        .textCase(nil)
    }
}

struct SearchField: View {
    @Binding var text: String
    var isFocused: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.text2)
                .accessibilityHidden(true)
            TextField("Was brauchst du?", text: $text)
                .font(.body)
                .focused(isFocused)
                .submitLabel(.done)
                .autocorrectionDisabled()
                .onSubmit {
                    onSubmit()
                    isFocused.wrappedValue = true   // Tastatur offen lassen für das nächste Produkt
                }
                .accessibilityLabel("Produkt suchen")
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.text2)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Suche leeren")
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border))
    }
}

#if DEBUG
#Preview {
    PlanningView(model: PlanningModel(repository: PreviewSupport.repository()))
        .background(Theme.background)
}
#endif
