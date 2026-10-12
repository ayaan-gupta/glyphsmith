// Asks macOS itself whether a font is usable: loads the file through
// CoreText (the engine behind Font Book and every native text view), checks
// that all 90 characters map to real glyphs with ink in them, and renders a
// specimen to a PNG.
//
//   swift scripts/coretext-check.swift Font.ttf out.png

import AppKit
import CoreText
import Foundation

let args = CommandLine.arguments
guard args.count >= 2 else { print("{\"ok\":false,\"error\":\"usage\"}"); exit(2) }
let url = URL(fileURLWithPath: args[1])

guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
      let descriptor = descriptors.first else {
    print("{\"ok\":false,\"error\":\"CoreText could not read the file\"}")
    exit(1)
}
let font = CTFontCreateWithFontDescriptor(descriptor, 96, nil)

let upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
let charset = upper + upper.lowercased() + "0123456789" + ".,;:!?'\"-()[]{}/\\&@#$%*+=<>_"
var missing: [String] = []
var inkless: [String] = []
for ch in charset {
    var units = Array(String(ch).utf16)
    var glyphs = [CGGlyph](repeating: 0, count: units.count)
    let found = CTFontGetGlyphsForCharacters(font, &units, &glyphs, units.count)
    if !found || glyphs[0] == 0 { missing.append(String(ch)); continue }
    var rect = CGRect.zero
    CTFontGetBoundingRectsForGlyphs(font, .default, &glyphs, &rect, 1)
    if rect.width <= 0 || rect.height <= 0 { inkless.append(String(ch)) }
}

let family = CTFontCopyFamilyName(font) as String
var rendered = false
if args.count >= 3 {
    let lines = [
        "The quick brown fox jumps",
        "over the lazy dog. 0123456789",
        "ABCDEFGHIJKLM NOPQRSTUVWXYZ",
        "(hello) [world] {ok} @ # $ % & * + = < > ? !",
    ]
    let size = CGSize(width: 1500, height: 560)
    let image = NSImage(size: size)
    image.lockFocus()
    NSColor(calibratedRed: 0.98, green: 0.96, blue: 0.91, alpha: 1).setFill()
    NSRect(origin: .zero, size: size).fill()
    let ink = NSColor(calibratedRed: 0.10, green: 0.20, blue: 0.45, alpha: 1)
    for (i, text) in lines.enumerated() {
        let pointSize: CGFloat = i == 3 ? 56 : 84
        let attributed = NSAttributedString(string: text, attributes: [
            .font: CTFontCreateCopyWithAttributes(font, pointSize, nil, nil) as NSFont,
            .foregroundColor: ink,
        ])
        attributed.draw(at: NSPoint(x: 60, y: size.height - 150 - CGFloat(i) * 122))
    }
    image.unlockFocus()
    if let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
       let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: args[2]))
        rendered = true
    }
}

let ok = missing.isEmpty && inkless.isEmpty
let report: [String: Any] = [
    "ok": ok,
    "family": family,
    "checked": charset.count,
    "missing": missing.joined(),
    "inkless": inkless.joined(),
    "glyphCount": CTFontGetGlyphCount(font),
    "rendered": rendered,
]
let data = try! JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
exit(ok ? 0 : 1)
