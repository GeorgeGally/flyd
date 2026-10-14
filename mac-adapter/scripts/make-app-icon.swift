// Draws Flyd's app icon and writes Resources/AppIcon.icns.
//
// The icon keeps the look Flyd always had in the Dock — a white frame around a
// pale blue-grey construction grid — and adds one flat green LED at its centre.
//
//   swift scripts/make-app-icon.swift [output.icns] [--png <dir>]
//
// --png also writes 1024px and 32px PNGs for review.
import AppKit

let canvas: CGFloat = 1024

func drawIcon(in ctx: CGContext, size: CGFloat) {
    ctx.scaleBy(x: size / canvas, y: size / canvas)

    // White frame with a soft drop shadow.
    let frame = CGRect(x: 100, y: 100, width: 824, height: 824)
    let framePath = CGPath(roundedRect: frame, cornerWidth: 185, cornerHeight: 185, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 28, color: NSColor.black.withAlphaComponent(0.22).cgColor)
    ctx.addPath(framePath)
    ctx.setFillColor(NSColor.white.cgColor)
    ctx.fillPath()
    ctx.restoreGState()

    // Pale blue-grey field.
    let field = frame.insetBy(dx: 55, dy: 55)
    let fieldPath = CGPath(roundedRect: field, cornerWidth: 130, cornerHeight: 130, transform: nil)
    ctx.addPath(fieldPath)
    ctx.setFillColor(NSColor(srgbRed: 0.827, green: 0.875, blue: 0.898, alpha: 1).cgColor)
    ctx.fillPath()

    // Construction grid: thirds, diagonals and three rings.
    ctx.saveGState()
    ctx.addPath(fieldPath)
    ctx.clip()
    ctx.setStrokeColor(NSColor(srgbRed: 0.918, green: 0.937, blue: 0.949, alpha: 1).cgColor)
    ctx.setLineWidth(2.2)
    let c = CGPoint(x: canvas / 2, y: canvas / 2)
    for x in [358.0, 512.0, 665.0] {
        ctx.move(to: CGPoint(x: x, y: field.minY)); ctx.addLine(to: CGPoint(x: x, y: field.maxY))
        ctx.move(to: CGPoint(x: field.minX, y: x)); ctx.addLine(to: CGPoint(x: field.maxX, y: x))
    }
    ctx.move(to: CGPoint(x: field.minX, y: field.minY)); ctx.addLine(to: CGPoint(x: field.maxX, y: field.maxY))
    ctx.move(to: CGPoint(x: field.minX, y: field.maxY)); ctx.addLine(to: CGPoint(x: field.maxX, y: field.minY))
    for r in [356.0, 217.0, 153.0] {
        ctx.addEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
    }
    ctx.strokePath()
    ctx.restoreGState()

    // The LED: a flat green disc with a tiny shadow and a small highlight.
    let led = CGRect(x: c.x - 112, y: c.y - 112, width: 224, height: 224)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 12, color: NSColor.black.withAlphaComponent(0.2).cgColor)
    ctx.addEllipse(in: led)
    ctx.setFillColor(NSColor(srgbRed: 0.204, green: 0.769, blue: 0.369, alpha: 1).cgColor)
    ctx.fillPath()
    ctx.restoreGState()

    ctx.saveGState()
    ctx.addEllipse(in: led)
    ctx.clip()
    let glint = CGPoint(x: c.x - 40, y: c.y + 48)
    let colors = [NSColor.white.withAlphaComponent(0.34).cgColor, NSColor.white.withAlphaComponent(0).cgColor] as CFArray
    let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0, 1])!
    ctx.drawRadialGradient(gradient, startCenter: glint, startRadius: 0, endCenter: glint, endRadius: 56, options: [])
    ctx.restoreGState()
}

func png(pixels: Int) -> Data {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!.cgContext
    drawIcon(in: ctx, size: CGFloat(pixels))
    return rep.representation(using: .png, properties: [:])!
}

var args = Array(CommandLine.arguments.dropFirst())
var reviewDir: String?
if let i = args.firstIndex(of: "--png"), i + 1 < args.count {
    reviewDir = args[i + 1]
    args.removeSubrange(i...(i + 1))
}
let output = args.first ?? "Resources/AppIcon.icns"

let fm = FileManager.default
let iconset = fm.temporaryDirectory.appendingPathComponent("AppIcon-\(getpid()).iconset")
try fm.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: iconset) }
for points in [16, 32, 128, 256, 512] {
    try png(pixels: points).write(to: iconset.appendingPathComponent("icon_\(points)x\(points).png"))
    try png(pixels: points * 2).write(to: iconset.appendingPathComponent("icon_\(points)x\(points)@2x.png"))
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", output]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else { exit(iconutil.terminationStatus) }
print("wrote \(output)")

if let dir = reviewDir {
    try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
    for pixels in [1024, 32] {
        try png(pixels: pixels).write(to: URL(fileURLWithPath: dir).appendingPathComponent("flyd-icon-\(pixels).png"))
    }
}
