import AppKit

// Bundle schema and bounded keyframe/mark rules adapted from kitlangton/scrawl.
// See Notices/Scrawl-MIT.txt for the upstream license.
struct ScrawlStroke: Codable {
    var t0: Int
    var t1: Int
    var fw: Int
    var fh: Int
    var pts: [Int]
}

struct ScrawlMark: Codable {
    var id: String
    var strokes: [Int]
    var t0: Int
    var t1: Int
    var boxNorm: [Double]
    var shape = "mark"
    var description = "Drawn mark"
}

struct ScrawlClick: Codable {
    let kind = "click"
    var t: Int
    var x: Double
    var y: Double
    var button: String
    enum CodingKeys: String, CodingKey { case kind, t, x, y, button }
}

struct ScrawlSegment: Codable {
    var t0: Int
    var t1: Int
    var text: String
}

struct ScrawlManifest: Codable {
    struct Target: Codable {
        var mode = "display"
        var app: String
        var bundleId: String
        var displayId: UInt32
        var frame: Frame
    }
    struct Frame: Codable { var x: Double; var y: Double; var width: Double; var height: Double; var scale: Double }
    struct Transcript: Codable {
        var source = "flyd"
        var text: String
        var segments: [ScrawlSegment]
        var estimated = true
        var missing: Missing?
        struct Missing: Codable { var reason: String; var retry = false }
    }
    struct Keyframe: Codable {
        var index: Int
        var t: Int
        var reason: String
        var file: String
        var event: String
        var said: String?
    }
    var version = 1
    var id: String
    var createdAtMs: Int
    var durationMs: Int
    var target: Target
    var transcript: Transcript
    var strokes: [ScrawlStroke]
    var marks: [ScrawlMark]
    var events: [ScrawlClick]
    var keyframes: [Keyframe]
    var contactSheet = "contact-sheet.png"
}

final class ScrawlBundleWriter {
    struct Frame {
        var t: Int
        var image: CGImage
        var reason: String
    }
    static let capturesDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/scrawl/captures", isDirectory: true)

    static func clock(_ ms: Int) -> String { String(format: "%d:%02d", ms / 60_000, ms / 1000 % 60) }

    static func write(manifest: ScrawlManifest, frames: [Frame], to root: URL = capturesDirectory) throws -> URL {
        guard !frames.isEmpty else { throw CocoaError(.fileReadUnknown) }
        let fm = FileManager.default
        try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let destination = root.appendingPathComponent("\(manifest.id).scrawl", isDirectory: true)
        let staging = root.appendingPathComponent(".\(manifest.id).partial", isDirectory: true)
        try fm.createDirectory(at: staging.appendingPathComponent("frames"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        do {
            var bundle = manifest
            bundle.keyframes = []
            var annotated: [CGImage] = []
            for (offset, frame) in frames.enumerated() {
                let lower = offset == 0 ? 0 : frames[offset - 1].t
                let shown = bundle.marks.filter { $0.t0 <= frame.t && $0.t1 >= lower }
                let indices = Set(shown.flatMap(\.strokes))
                let strokes = bundle.strokes.enumerated().filter { indices.contains($0.offset) }.map(\.element)
                let clicks = bundle.events.filter { $0.t >= lower && $0.t <= frame.t }
                let rendered = try annotate(frame.image, strokes: strokes, clicks: clicks, number: offset + 1)
                let file = String(format: "frames/frame-%02d.png", offset + 1)
                try png(rendered).write(to: staging.appendingPathComponent(file))
                annotated.append(rendered)
                let said = bundle.transcript.segments.filter { $0.t0 <= frame.t && $0.t1 >= lower }.map(\.text).joined(separator: " ")
                bundle.keyframes.append(.init(index: offset + 1, t: frame.t, reason: frame.reason, file: file,
                                              event: "\(shown.count) marks, \(clicks.count) clicks", said: said.isEmpty ? nil : said))
            }
            try png(contactSheet(annotated, frames: frames)).write(to: staging.appendingPathComponent(bundle.contactSheet))
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(bundle).write(to: staging.appendingPathComponent("scrawl.json"))
            var lines = ["# Flyd recording · \(clock(bundle.durationMs)) · \(bundle.target.app)", "", "Transcript timing is estimated from 15-second audio segments."]
            if let missing = bundle.transcript.missing { lines += ["", "Transcription: \(missing.reason)"] }
            lines += ["", "## Transcript"]
            lines += bundle.transcript.segments.map { "[\(clock($0.t0))–\(clock($0.t1))] \($0.text)" }
            lines += ["", "## Keyframes"]
            lines += bundle.keyframes.map { "#\($0.index) (\(clock($0.t))) [\($0.file)] \($0.event)\($0.said.map { " · \($0)" } ?? "")" }
            lines += ["", "## Click and mark timeline"]
            let timeline = bundle.events.map { ($0.t, "[\(clock($0.t))] \($0.button) click at \(Int($0.x * 100))%, \(Int($0.y * 100))%") }
                + bundle.marks.map { ($0.t0, "[\(clock($0.t0))–\(clock($0.t1))] Mark \($0.id): \($0.strokes.count) stroke(s)") }
            lines += timeline.sorted { $0.0 < $1.0 }.map(\.1)
            try (lines.joined(separator: "\n") + "\n").write(to: staging.appendingPathComponent("summary.md"), atomically: true, encoding: .utf8)
            try fm.moveItem(at: staging, to: destination)
            return destination
        } catch {
            try? fm.removeItem(at: staging)
            throw error
        }
    }

    static func png(_ image: CGImage) throws -> Data {
        guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
        return data
    }

    private static func canvas(width: Int, height: Int) throws -> CGContext {
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw CocoaError(.fileWriteUnknown) }
        return context
    }

    static func drawInk(_ context: CGContext, strokes: [ScrawlStroke], size: CGSize) {
        context.setStrokeColor(NSColor.systemRed.cgColor)
        context.setLineWidth(max(3, size.width / 400))
        context.setLineCap(.round)
        context.setLineJoin(.round)
        for stroke in strokes {
            context.beginPath()
            for offset in stride(from: 0, to: stroke.pts.count - 2, by: 3) {
                let point = CGPoint(x: CGFloat(stroke.pts[offset]) / 10_000 * size.width,
                                    y: size.height * (1 - CGFloat(stroke.pts[offset + 1]) / 10_000))
                if offset == 0 { context.move(to: point) } else { context.addLine(to: point) }
            }
            context.strokePath()
        }
    }

    static func annotate(_ image: CGImage, strokes: [ScrawlStroke], clicks: [ScrawlClick], number: Int) throws -> CGImage {
        let context = try canvas(width: image.width, height: image.height)
        let size = CGSize(width: image.width, height: image.height)
        context.draw(image, in: CGRect(origin: .zero, size: size))
        drawInk(context, strokes: strokes, size: size)
        context.setStrokeColor(NSColor.systemYellow.cgColor)
        context.setLineWidth(3)
        for click in clicks {
            context.strokeEllipse(in: CGRect(x: CGFloat(click.x) * size.width - 12, y: CGFloat(1 - click.y) * size.height - 12, width: 24, height: 24))
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        let badge = NSRect(x: 12, y: size.height - 48, width: 36, height: 36)
        NSColor.black.withAlphaComponent(0.8).setFill()
        NSBezierPath(roundedRect: badge, xRadius: 10, yRadius: 10).fill()
        ("\(number)" as NSString).draw(at: NSPoint(x: 23, y: size.height - 41), withAttributes: [.font: NSFont.boldSystemFont(ofSize: 20), .foregroundColor: NSColor.white])
        NSGraphicsContext.restoreGraphicsState()
        guard let rendered = context.makeImage() else { throw CocoaError(.fileWriteUnknown) }
        return rendered
    }

    static func contactSheet(_ images: [CGImage], frames: [Frame]) throws -> CGImage {
        let columns = min(2, images.count)
        let cellWidth = 640
        let cellHeight = Int(Double(cellWidth) * Double(images[0].height) / Double(images[0].width))
        let rowHeight = cellHeight + 32
        let rows = (images.count + columns - 1) / columns
        let height = rows * rowHeight
        let context = try canvas(width: columns * cellWidth, height: height)
        context.setFillColor(NSColor(calibratedWhite: 0.08, alpha: 1).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: columns * cellWidth, height: height))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        for (i, image) in images.enumerated() {
            let x = i % columns * cellWidth
            let y = height - (i / columns + 1) * rowHeight
            context.draw(image, in: CGRect(x: x, y: y + 32, width: cellWidth, height: cellHeight))
            ("#\(i + 1)  \(clock(frames[i].t))  ·  \(frames[i].reason)" as NSString).draw(at: NSPoint(x: x + 12, y: y + 8), withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: 13, weight: .medium), .foregroundColor: NSColor.white])
        }
        NSGraphicsContext.restoreGraphicsState()
        guard let sheet = context.makeImage() else { throw CocoaError(.fileWriteUnknown) }
        return sheet
    }

    // Upstream's 64×36 luma grid avoids retaining full candidate recordings.
    static func thumbnail(_ image: CGImage) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: 64 * 36)
        bytes.withUnsafeMutableBytes { buffer in
            if let context = CGContext(data: buffer.baseAddress, width: 64, height: 36, bitsPerComponent: 8, bytesPerRow: 64,
                                       space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0) {
                context.draw(image, in: CGRect(x: 0, y: 0, width: 64, height: 36))
            }
        }
        return bytes
    }

    static func sceneDifference(_ a: [UInt8], _ b: [UInt8]) -> Double {
        guard a.count == 2304, b.count == a.count else { return 1 }
        var blocks = [Double](repeating: 0, count: 48)
        var total = 0.0
        for i in a.indices {
            let diff = Double(abs(Int(a[i]) - Int(b[i]))) / 255
            total += diff
            blocks[(i / 64 / 6) * 8 + (i % 64 / 8)] += diff / 48
        }
        return max(total / 2304, blocks.sorted(by: >)[3] * 1.4)
    }
}
