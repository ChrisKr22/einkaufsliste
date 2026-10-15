import SwiftUI

enum AppMode: String, CaseIterable, Identifiable {
    case plan = "Planen"
    case shop = "Einkaufen"
    var id: String { rawValue }
}

struct RootView: View {
    @State private var model: PlanningModel
    @State private var mode: AppMode = .plan

    init(repository: ShoppingRepository) {
        _model = State(initialValue: PlanningModel(repository: repository))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            switch mode {
            case .plan:
                PlanningView(model: model)
            case .shop:
                ShoppingPlaceholderView()
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .foregroundStyle(Theme.text)
        .tint(Theme.accentInk)
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                ToastView(toast: toast, onUndo: model.undo)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: model.toast)
        .sensoryFeedback(.success, trigger: model.addedCount)
        .alert("Das hat nicht geklappt", isPresented: errorBinding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private var header: some View {
        VStack(spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Wordmark()
                Spacer()
                Text(countLabel)
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(Theme.text2)
            }
            ModePicker(selection: $mode, shopBadge: model.items.filter { $0.status == .open }.count)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private var countLabel: String {
        let n = model.plannedCount
        return n == 1 ? "1 Produkt" : "\(n) Produkte"
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.clearError() } })
    }
}

/// „Feed“ in Textfarbe, „Yourself“ in Akzentfarbe (Grün hell / Gelb dunkel).
struct Wordmark: View {
    var body: some View {
        (Text("Feed") + Text("Yourself").foregroundStyle(Theme.accentInk))
            .font(.system(size: 28, weight: .semibold, design: .serif))
            .accessibilityLabel("FeedYourself")
            .accessibilityAddTraits(.isHeader)
    }
}

struct ModePicker: View {
    @Binding var selection: AppMode
    let shopBadge: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(AppMode.allCases) { mode in
                let isSelected = selection == mode
                Button {
                    withAnimation(.snappy) { selection = mode }
                } label: {
                    Text(label(for: mode))
                        .font(.subheadline.weight(isSelected ? .semibold : .medium))
                        .foregroundStyle(isSelected ? Theme.text : Theme.text2)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background {
                            if isSelected {
                                RoundedRectangle(cornerRadius: 9)
                                    .fill(Theme.surface)
                                    .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
    }

    private func label(for mode: AppMode) -> String {
        mode == .shop && shopBadge > 0 ? "\(mode.rawValue) · \(shopBadge)" : mode.rawValue
    }
}

struct ShoppingPlaceholderView: View {
    var body: some View {
        ContentUnavailableView {
            Label("Einkaufsmodus", systemImage: "cart")
        } description: {
            Text("Kommt im nächsten Schritt: Kacheln, Liste und Fokus-Ansicht mit Wischgesten.")
        }
        .frame(maxHeight: .infinity)
    }
}

#if DEBUG
#Preview("Planung – hell") {
    RootView(repository: PreviewSupport.repository())
}

#Preview("Planung – dunkel") {
    RootView(repository: PreviewSupport.repository())
        .preferredColorScheme(.dark)
}
#endif
