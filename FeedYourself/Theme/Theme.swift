import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Farbwelt aus dem Konzept (Kapitel 5): hell frisches Grün, dunkel kräftiges Gelb, neutrale Grautöne.
enum Theme {
    static let background = Color(light: "#F4F5F4", dark: "#151213")
    static let surface = Color(light: "#FFFFFF", dark: "#211C1D")
    static let surface2 = Color(light: "#E2E4E2", dark: "#2C2628")   // Schalter, Mengen-Knöpfe
    static let border = Color(light: "#DADDDA", dark: "#3A3234")
    static let text = Color(light: "#1A1F1B", dark: "#ECECEA")
    static let text2 = Color(light: "#5E665F", dark: "#A9A9A5")
    static let placeholder = Color(light: "#838B84", dark: "#7E7577")

    static let accentFill = Color(light: "#2A7F3F", dark: "#F5C400")  // Knöpfe
    static let accentInk = Color(light: "#237035", dark: "#F5C400")   // Akzent als Text, „Yourself“, Mengen
    static let accentSoft = Color(light: "#E2F0E3", dark: "#3A3110")
    static let onAccent = Color(light: "#FFFFFF", dark: "#1A1606")

    static let later = Color(light: "#3F5F8A", dark: "#9BB8E6")       // zurückgestellt
    static let laterSoft = Color(light: "#E6EDF5", dark: "#1E2632")

    static let toastBackground = Color(light: "#232823", dark: "#ECECEA")
    static let toastText = Color(light: "#FFFFFF", dark: "#1A1F1B")
    static let toastAction = Color(light: "#9FDDAA", dark: "#6B5500")
}

extension Color {
    /// Farbe, die sich automatisch an Hell-/Dunkelmodus anpasst.
    init(light: String, dark: String) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
        #else
        self.init(hex: light)
        #endif
    }

    init(hex: String) {
        let (r, g, b) = RGB.parse(hex)
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }
}

#if canImport(UIKit)
extension UIColor {
    convenience init(hex: String) {
        let (r, g, b) = RGB.parse(hex)
        self.init(red: r, green: g, blue: b, alpha: 1)
    }
}
#endif

enum RGB {
    static func parse(_ hex: String) -> (Double, Double, Double) {
        var value: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&value)
        return (Double((value >> 16) & 0xFF) / 255, Double((value >> 8) & 0xFF) / 255, Double(value & 0xFF) / 255)
    }
}
