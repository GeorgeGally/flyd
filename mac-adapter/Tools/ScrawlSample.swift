// Compile with Sources/Scrawl/{ScrawlBundle,ScrawlOverlay}.swift for a native sample.
// --overlay holds a separate diagnostic app open; it never starts Flyd or its services.
import AppKit

@main
struct ScrawlSample {
    @MainActor static func main() throws {
        let app = NSApplication.shared
        let arguments = CommandLine.arguments
        guard arguments.count >= 2 else { fatalError("Expected output directory") }
        let root = URL(fileURLWithPath: arguments[1], isDirectory: true)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 980, height: 620),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Flyd Scrawl · native capture check"
        window.center()
        let text = NSTextView(frame: NSRect(x: 0, y: 0, width: 980, height: 620))
        text.string = "Flyd's own Scrawl\n\nScreen, voice and ink in one recording.\n\nControl-Option-S starts and stops.\nDraw marks what needs attention.\nClicks stay on the timeline.\n\nThe recording waits in the message box.\nSend files it when you're ready."
        text.font = .systemFont(ofSize: 27)
        text.textColor = .textColor
        text.textContainerInset = NSSize(width: 64, height: 56)
        text.isEditable = false
        window.contentView = text
        window.makeKeyAndOrderFront(nil)
        window.displayIfNeeded()
        guard let bitmap = text.bitmapImageRepForCachingDisplay(in: text.bounds) else { throw CocoaError(.fileWriteUnknown) }
        text.cacheDisplay(in: text.bounds, to: bitmap)
        guard let image = bitmap.cgImage else { throw CocoaError(.fileWriteUnknown) }
        let stroke = ScrawlStroke(t0: 1000, t1: 1800, fw: image.width, fh: image.height,
                                  pts: [700, 4200, 0, 4200, 4200, 400, 7000, 4200, 800])
        let manifest = ScrawlManifest(id: "flyd-native-sample", createdAtMs: 1792660000000, durationMs: 4000,
                                     target: .init(app: "Flyd capture check", bundleId: "local.flyd.scrawl-proof", displayId: CGMainDisplayID(),
                                                   frame: .init(x: 0, y: 0, width: 980, height: 620, scale: 1)),
                                     transcript: .init(text: "Mark this line, then click here.", segments: [.init(t0: 0, t1: 4000, text: "Mark this line, then click here.")]),
                                     strokes: [stroke], marks: [.init(id: "m1", strokes: [0], t0: 1000, t1: 1800, boxNorm: [0.07, 0.42, 0.7, 0.42])],
                                     events: [.init(t: 3000, x: 0.65, y: 0.68, button: "left")], keyframes: [])
        let directory = try ScrawlBundleWriter.write(manifest: manifest, frames: [.init(t: 0, image: image, reason: "initial"), .init(t: 2000, image: image, reason: "mark"), .init(t: 4000, image: image, reason: "click")], to: root)
        print(directory.path)
        if arguments.contains("--overlay"), let screen = window.screen ?? NSScreen.main {
            app.setActivationPolicy(.regular)
            app.activate(ignoringOtherApps: true)
            let overlay = ScrawlOverlay(screen: screen)
            overlay.show()
            overlay.toggleDraw()
            // Drive the same mouse event handlers used during a recording.
            var t = 1000
            overlay.ink.now = { t }
            let y = window.frame.midY
            let points = [NSPoint(x: window.frame.minX + 62, y: y), NSPoint(x: window.frame.midX, y: y), NSPoint(x: window.frame.maxX - 130, y: y)]
            for (i, point) in points.enumerated() {
                let local = NSPoint(x: point.x - screen.frame.minX, y: point.y - screen.frame.minY)
                let type: NSEvent.EventType = i == 0 ? .leftMouseDown : i == points.count - 1 ? .leftMouseUp : .leftMouseDragged
                if let event = NSEvent.mouseEvent(with: type, location: local, modifierFlags: [], timestamp: 0, windowNumber: overlay.ink.window?.windowNumber ?? 0, context: nil, eventNumber: i, clickCount: 1, pressure: 1) {
                    if i == 0 { overlay.ink.mouseDown(with: event) }
                    else if i == points.count - 1 { overlay.ink.mouseUp(with: event) }
                    else { overlay.ink.mouseDragged(with: event) }
                }
                t += 400
            }
            overlay.updateTime(4000)
            let quit: () -> Void = { overlay.close(); app.terminate(nil) }
            overlay.onCancel = quit
            overlay.onStop = quit
            DispatchQueue.main.asyncAfter(deadline: .now() + 45) { quit() }
            app.run()
        }
    }
}
