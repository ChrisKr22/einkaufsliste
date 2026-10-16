// FeedYourself – App-Icons für die Web-App erzeugen (Tannengrün, weißer Korb mit Salbei-Blatt).
// Aufruf: swiftc tools/web/make-icons.swift -o <bin> && <bin> web/icons

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let outDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "web/icons")
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: sRGB, components: [CGFloat((hex >> 16) & 0xFF) / 255, CGFloat((hex >> 8) & 0xFF) / 255, CGFloat(hex & 0xFF) / 255, alpha])!
}

func icon(size: Int) -> CGImage {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
                        space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let s = CGFloat(size)
    // Koordinaten wie im Entwurf: 1024 × 1024, Ursprung oben links.
    ctx.translateBy(x: 0, y: s)
    ctx.scaleBy(x: s / 1024, y: -s / 1024)

    // Vollflächiger Grund (iOS rundet selbst ab): Tannengrün mit leichtem Verlauf und feinem Glanz.
    let green = CGGradient(colorsSpace: sRGB, colors: [color(0x28704A), color(0x184B2F)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(green, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: 1024), options: [])
    let sheen = CGGradient(colorsSpace: sRGB, colors: [color(0xFFFFFF, alpha: 0.14), color(0xFFFFFF, alpha: 0)] as CFArray, locations: [0, 0.5])!
    ctx.drawLinearGradient(sheen, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 1024, y: 1024), options: [])

    // Motiv leicht verkleinert, damit es auch als „maskable“-Icon (runder Ausschnitt) vollständig bleibt.
    ctx.translateBy(x: 512, y: 512)
    ctx.scaleBy(x: 0.9, y: 0.9)
    ctx.translateBy(x: -512, y: -512)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setStrokeColor(color(0xFFFFFF))

    // Henkel
    let handle = CGMutablePath()
    handle.move(to: CGPoint(x: 352, y: 450))
    handle.addCurve(to: CGPoint(x: 512, y: 282), control1: CGPoint(x: 352, y: 354), control2: CGPoint(x: 424, y: 282))
    handle.addCurve(to: CGPoint(x: 672, y: 450), control1: CGPoint(x: 600, y: 282), control2: CGPoint(x: 672, y: 354))
    ctx.setLineWidth(44)
    ctx.addPath(handle)
    ctx.strokePath()

    // Korb (Umriss mit gerundeten unteren Ecken)
    let basket = CGMutablePath()
    basket.move(to: CGPoint(x: 250, y: 450))
    basket.addLine(to: CGPoint(x: 774, y: 450))
    basket.addLine(to: CGPoint(x: 722, y: 740))
    basket.addQuadCurve(to: CGPoint(x: 682, y: 774), control: CGPoint(x: 716, y: 774))
    basket.addLine(to: CGPoint(x: 342, y: 774))
    basket.addQuadCurve(to: CGPoint(x: 302, y: 740), control: CGPoint(x: 308, y: 774))
    basket.closeSubpath()
    ctx.addPath(basket)
    ctx.strokePath()

    // Flechtstreben
    ctx.setLineWidth(36)
    for x in [420.0, 512.0, 604.0] {
        ctx.move(to: CGPoint(x: x, y: 540))
        ctx.addLine(to: CGPoint(x: x, y: 680))
    }
    ctx.strokePath()

    // Salbei-Blatt, das aus dem Korb wächst
    let leaf = CGMutablePath()
    leaf.move(to: CGPoint(x: 640, y: 430))
    leaf.addCurve(to: CGPoint(x: 850, y: 216), control1: CGPoint(x: 650, y: 310), control2: CGPoint(x: 730, y: 230))
    leaf.addCurve(to: CGPoint(x: 640, y: 430), control1: CGPoint(x: 854, y: 340), control2: CGPoint(x: 778, y: 430))
    ctx.setFillColor(color(0xA7C2A0))
    ctx.addPath(leaf)
    ctx.fillPath()
    // Blattader
    ctx.setStrokeColor(color(0x184B2F, alpha: 0.55))
    ctx.setLineWidth(14)
    ctx.move(to: CGPoint(x: 652, y: 420))
    ctx.addCurve(to: CGPoint(x: 812, y: 256), control1: CGPoint(x: 692, y: 358), control2: CGPoint(x: 748, y: 302))
    ctx.strokePath()
    return ctx.makeImage()!
}

func write(_ image: CGImage, _ name: String) {
    let url = outDir.appendingPathComponent(name)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    precondition(CGImageDestinationFinalize(dest), "Konnte \(name) nicht schreiben")
    print("geschrieben:", url.path)
}

write(icon(size: 512), "icon-512.png")
write(icon(size: 192), "icon-192.png")
write(icon(size: 180), "apple-touch-icon.png")
