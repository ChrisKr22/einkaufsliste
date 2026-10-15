// FeedYourself – App-Icons für die Web-App erzeugen (grüner Grund, weißer Korb).
// Aufruf: swiftc tools/web/make-icons.swift -o <bin> && <bin> web/icons

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let outDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "web/icons")
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: UInt32) -> CGColor {
    CGColor(colorSpace: sRGB, components: [CGFloat((hex >> 16) & 0xFF) / 255, CGFloat((hex >> 8) & 0xFF) / 255, CGFloat(hex & 0xFF) / 255, 1])!
}

func icon(size: Int) -> CGImage {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
                        space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let s = CGFloat(size)
    // Vollflächig: iOS rundet die Ecken selbst ab, „maskable“ braucht Rand ohne Motiv.
    ctx.setFillColor(color(0x1F5C3A))
    ctx.fill(CGRect(x: 0, y: 0, width: s, height: s))

    // Koordinaten von oben links, Motiv innerhalb der sicheren Zone (mittlere 60 %).
    ctx.translateBy(x: 0, y: s)
    ctx.scaleBy(x: s / 100, y: -s / 100)
    ctx.setStrokeColor(color(0xFFFFFF))
    ctx.setFillColor(color(0xFFFFFF))
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)

    // Henkel
    ctx.setLineWidth(5)
    ctx.addArc(center: CGPoint(x: 50, y: 42), radius: 15, startAngle: .pi, endAngle: 0, clockwise: false)
    ctx.strokePath()
    // Korb
    let basket = CGMutablePath()
    basket.move(to: CGPoint(x: 26, y: 42))
    basket.addLine(to: CGPoint(x: 74, y: 42))
    basket.addLine(to: CGPoint(x: 68, y: 72))
    basket.addLine(to: CGPoint(x: 32, y: 72))
    basket.closeSubpath()
    ctx.addPath(basket)
    ctx.fillPath()
    // Flechtlinien
    ctx.setStrokeColor(color(0x1F5C3A))
    ctx.setLineWidth(3)
    for x in [41.0, 50.0, 59.0] {
        ctx.move(to: CGPoint(x: x, y: 49))
        ctx.addLine(to: CGPoint(x: x - (x - 50) * 0.15, y: 65))
    }
    ctx.strokePath()
    // Blatt (Akzent Gelb)
    ctx.setFillColor(color(0xA7C2A0))
    ctx.addEllipse(in: CGRect(x: 62, y: 24, width: 12, height: 12))
    ctx.fillPath()
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
