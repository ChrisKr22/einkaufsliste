// FeedYourself – Fotos freistellen und auf ein einheitliches Quadrat bringen.
//
// Aufruf:  swift cutout.swift <eingabe-ordner> <ausgabe-ordner> [--size 600] [--margin 0.08] [--keep-background] [--jpeg-quality 0.6]
//
// Für jedes JPG/PNG/HEIC im Eingabe-Ordner:
//   0. Schon freigestellt (PNG mit transparentem Rand, z. B. vom iPhone „Motiv kopieren“)?
//      Dann nur auf das Motiv zuschneiden.
//   1. Motiv mit Apple Vision freistellen (VNGenerateForegroundInstanceMaskRequest,
//      macOS 14+, nur Apple-Silicon-Macs).
//   2. Sonst: heller, einfarbiger Hintergrund wird vom Bildrand her entfernt
//      (funktioniert auch auf Intel-Macs, ideal für „isolated"-Fotos).
//   3. Motiv mittig in ein transparentes Quadrat setzen, mit Rand.
//   4. Klappt das alles nicht: Foto quadratisch zuschneiden (ohne Transparenz) und als JPEG
//      speichern (Qualität 60 %, --jpeg-quality) – auf dem iPhone ohne sichtbaren Unterschied
//      zu 80 %, aber gut ein Drittel kleiner.
// Pro Datei eine JSON-Zeile auf stdout:
//   {"file": "...", "mode": "alpha" | "cutout" | "whitebg" | "fallback" | "error"}
//
// Bewusst nur Core Graphics (kein Core Image): läuft so auch auf Intel-Macs ohne GPU-Kernel.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import VideoToolbox
import Vision

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("Aufruf: swift cutout.swift <eingabe> <ausgabe> [--size 600] [--margin 0.08]\n".data(using: .utf8)!)
    exit(2)
}
let inDir = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
var size = 600
var margin = 0.08
// --keep-background: nicht freistellen, Fotos immer randlos zuschneiden (für Fotos mit Szene/Hintergrund).
let keepBackground = args.contains("--keep-background")
var jpegQuality = 0.6
var i = 3
while i < args.count - 1 {
    if args[i] == "--keep-background" { i += 1; continue }
    if args[i] == "--size", let v = Int(args[i + 1]) { size = v }
    if args[i] == "--margin", let v = Double(args[i + 1]) { margin = v }
    if args[i] == "--jpeg-quality", let v = Double(args[i + 1]) { jpegQuality = v }
    i += 2
}

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
let rgbaInfo = CGImageAlphaInfo.premultipliedLast.rawValue

/// Lädt das Bild richtig gedreht (EXIF) und auf max. 1600 px verkleinert.
func loadImage(_ url: URL) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 1600,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
}

/// Bereits freigestellt? Liefert das auf die sichtbaren Pixel zugeschnittene Bild – oder nil,
/// wenn das Bild keinen nennenswert transparenten Rand hat.
func alreadyCutOut(_ image: CGImage) -> CGImage? {
    switch image.alphaInfo {
    case .none, .noneSkipFirst, .noneSkipLast: return nil
    default: break
    }
    let w = image.width, h = image.height
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                              space: sRGB, bitmapInfo: rgbaInfo),
          let raw = ctx.data else { return nil }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    let px = raw.bindMemory(to: UInt8.self, capacity: w * h * 4)
    var transparentBorder = 0, border = 0
    for x in 0..<w { for y in [0, h - 1] { border += 1; if px[(y * w + x) * 4 + 3] < 10 { transparentBorder += 1 } } }
    for y in 0..<h { for x in [0, w - 1] { border += 1; if px[(y * w + x) * 4 + 3] < 10 { transparentBorder += 1 } } }
    guard Double(transparentBorder) / Double(border) > 0.8 else { return nil }
    var minX = w, minY = h, maxX = -1, maxY = -1
    for y in 0..<h {
        for x in 0..<w where px[(y * w + x) * 4 + 3] > 8 {
            minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
        }
    }
    guard maxX >= minX, maxY >= minY else { return nil }
    return ctx.makeImage()?.cropping(to: CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1))
}

/// Apple Vision: freigestelltes Motiv (mit Alpha, auf das Motiv zugeschnitten) oder nil.
func visionCutout(_ image: CGImage) -> CGImage? {
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()
    do {
        try handler.perform([request])
        guard let observation = request.results?.first, !observation.allInstances.isEmpty else { return nil }
        let buffer = try observation.generateMaskedImage(
            ofInstances: observation.allInstances, from: handler, croppedToInstancesExtent: true)
        var out: CGImage?
        VTCreateCGImageFromCVPixelBuffer(buffer, options: nil, imageOut: &out)
        guard let masked = out else { return nil }
        // Winzige Treffer (Krümel, Logos) nicht als Motiv werten.
        let share = Double(masked.width * masked.height) / Double(image.width * image.height)
        return share > 0.02 ? masked : nil
    } catch {
        return nil  // z. B. Intel-Mac: Anfrage wird nicht unterstützt
    }
}

/// Entfernt hellen, einfarbigen Hintergrund, der mit dem Bildrand verbunden ist (Flood-Fill).
/// Liefert das Motiv mit Alpha, auf das Motiv zugeschnitten – oder nil, wenn der Rand nicht hell ist.
func whiteBackgroundCutout(_ image: CGImage) -> CGImage? {
    let w = image.width, h = image.height, n = w * h
    guard let bitmap = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                 space: sRGB, bitmapInfo: rgbaInfo),
          let raw = bitmap.data else { return nil }
    bitmap.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    let px = raw.bindMemory(to: UInt8.self, capacity: n * 4)

    // 1. Rand prüfen: überwiegend hell und farblos?
    var border: [Int] = []
    for x in 0..<w { border.append(x); border.append((h - 1) * w + x) }
    for y in 0..<h { border.append(y * w); border.append(y * w + w - 1) }
    var light = 0, sr = 0, sg = 0, sb = 0
    for p in border {
        let r = Int(px[p * 4]), g = Int(px[p * 4 + 1]), b = Int(px[p * 4 + 2])
        if min(r, g, b) >= 205 && max(r, g, b) - min(r, g, b) <= 30 { light += 1; sr += r; sg += g; sb += b }
    }
    guard Double(light) / Double(border.count) >= 0.7 else { return nil }
    let br = sr / light, bgc = sg / light, bb = sb / light
    let tolerance = 34
    func isBackground(_ p: Int) -> Bool {
        abs(Int(px[p * 4]) - br) <= tolerance && abs(Int(px[p * 4 + 1]) - bgc) <= tolerance
            && abs(Int(px[p * 4 + 2]) - bb) <= tolerance
    }

    // 2. Flood-Fill vom Rand aus.
    var bg = [Bool](repeating: false, count: n)
    var queue: [Int] = []
    queue.reserveCapacity(n / 2)
    for p in border where !bg[p] && isBackground(p) { bg[p] = true; queue.append(p) }
    var head = 0
    while head < queue.count {
        let p = queue[head]; head += 1
        let x = p % w, y = p / w
        if x > 0, !bg[p - 1], isBackground(p - 1) { bg[p - 1] = true; queue.append(p - 1) }
        if x < w - 1, !bg[p + 1], isBackground(p + 1) { bg[p + 1] = true; queue.append(p + 1) }
        if y > 0, !bg[p - w], isBackground(p - w) { bg[p - w] = true; queue.append(p - w) }
        if y < h - 1, !bg[p + w], isBackground(p + w) { bg[p + w] = true; queue.append(p + w) }
    }

    // 3. Weiche Kante (3×3-Mittel), vormultiplizieren, Begrenzungsrahmen.
    var minX = w, minY = h, maxX = -1, maxY = -1, fg = 0
    var alpha = [UInt8](repeating: 0, count: n)
    for y in 0..<h {
        for x in 0..<w {
            var sum = 0, cnt = 0
            for yy in max(0, y - 1)...min(h - 1, y + 1) {
                for xx in max(0, x - 1)...min(w - 1, x + 1) {
                    sum += bg[yy * w + xx] ? 0 : 255; cnt += 1
                }
            }
            let a = sum / cnt
            alpha[y * w + x] = UInt8(a)
            if a > 8 {
                fg += 1
                minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
            }
        }
    }
    let share = Double(fg) / Double(n)
    guard share > 0.02 && share < 0.95 else { return nil }
    for p in 0..<n {
        let a = Int(alpha[p])
        px[p * 4] = UInt8(Int(px[p * 4]) * a / 255)
        px[p * 4 + 1] = UInt8(Int(px[p * 4 + 1]) * a / 255)
        px[p * 4 + 2] = UInt8(Int(px[p * 4 + 2]) * a / 255)
        px[p * 4 + 3] = UInt8(a)
    }
    // Speicherzeile 0 = obere Bildzeile; CGImage.cropping nutzt dieselbe Ausrichtung.
    return bitmap.makeImage()?.cropping(to: CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1))
}

/// Bild mittig ins Quadrat setzen: `fill` = randlos zuschneiden, sonst einpassen mit Rand.
func place(_ image: CGImage, fill: Bool) -> CGImage? {
    guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
                              space: sRGB, bitmapInfo: rgbaInfo) else { return nil }
    ctx.interpolationQuality = .high
    let s = Double(size), iw = Double(image.width), ih = Double(image.height)
    let inner = s * (1 - 2 * margin)
    let factor = fill ? max(s / iw, s / ih) : min(inner / iw, inner / ih)
    let dw = iw * factor, dh = ih * factor
    ctx.draw(image, in: CGRect(x: (s - dw) / 2, y: (s - dh) / 2, width: dw, height: dh))
    return ctx.makeImage()
}

func writeImage(_ image: CGImage, to url: URL, jpeg: Bool) -> Bool {
    let type = jpeg ? UTType.jpeg : UTType.png
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil)
    else { return false }
    let options = jpeg ? [kCGImageDestinationLossyCompressionQuality: jpegQuality] as CFDictionary : nil
    CGImageDestinationAddImage(dest, image, options)
    return CGImageDestinationFinalize(dest)
}

func report(_ file: String, _ mode: String) {
    let data = try! JSONSerialization.data(withJSONObject: ["file": file, "mode": mode], options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}

try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let extensions: Set<String> = ["jpg", "jpeg", "png", "heic", "webp"]
let files = (try FileManager.default.contentsOfDirectory(at: inDir, includingPropertiesForKeys: nil))
    .filter { extensions.contains($0.pathExtension.lowercased()) }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }

for file in files {
    let base = outDir.appendingPathComponent(file.deletingPathExtension().lastPathComponent)
    guard let image = loadImage(file) else { report(file.lastPathComponent, "error"); continue }
    var mode = "fallback"
    var result: CGImage?
    if keepBackground {
        result = place(image, fill: true)
    } else if let subject = alreadyCutOut(image) {
        mode = "alpha"; result = place(subject, fill: false)
    } else if let subject = visionCutout(image) {
        mode = "cutout"; result = place(subject, fill: false)
    } else if let subject = whiteBackgroundCutout(image) {
        mode = "whitebg"; result = place(subject, fill: false)
    } else {
        result = place(image, fill: true)
    }
    let jpeg = mode == "fallback"
    let out = base.appendingPathExtension(jpeg ? "jpg" : "png")
    // Eine ältere Fassung im jeweils anderen Format entfernen, damit nur ein Bild je Produkt bleibt.
    try? FileManager.default.removeItem(at: base.appendingPathExtension(jpeg ? "png" : "jpg"))
    if let result, writeImage(result, to: out, jpeg: jpeg) {
        report(file.lastPathComponent, mode)
    } else {
        report(file.lastPathComponent, "error")
    }
}
