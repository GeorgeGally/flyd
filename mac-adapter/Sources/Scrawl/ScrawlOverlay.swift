import AppKit

final class ScrawlInkView: NSView {
    var strokes: [ScrawlStroke] = []
    var now: () -> Int = { 0 }
    var onStroke: ((ScrawlStroke) -> Void)?
    private var current: ScrawlStroke?

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        ScrawlBundleWriter.drawInk(context, strokes: strokes + (current.map { [$0] } ?? []), size: bounds.size)
    }

    override func mouseDown(with event: NSEvent) {
        let t = now()
        current = ScrawlStroke(t0: t, t1: t, fw: Int(bounds.width), fh: Int(bounds.height), pts: [])
        append(event)
    }
    override func mouseDragged(with event: NSEvent) { append(event) }
    override func mouseUp(with event: NSEvent) {
        append(event)
        finishStroke()
    }
    func finishStroke() {
        guard let stroke = current else { return }
        current = nil
        strokes.append(stroke)
        onStroke?(stroke)
        needsDisplay = true
    }
    private func append(_ event: NSEvent) {
        guard current != nil else { return }
        let p = convert(event.locationInWindow, from: nil)
        current?.t1 = now()
        let dt = now() - (current?.t0 ?? 0)
        current?.pts += [Int(max(0, min(1, p.x / bounds.width)) * 10_000),
                         Int(max(0, min(1, 1 - p.y / bounds.height)) * 10_000),
                         dt]
        needsDisplay = true
    }
}

/// A click-through canvas until Draw is enabled. Its toolbar never captures keystrokes.
@MainActor
final class ScrawlOverlay {
    private let panel: NSPanel
    private let toolbar: NSPanel
    let ink: ScrawlInkView
    private var drawing = false
    private let drawButton: NSButton
    private let timeLabel = NSTextField(labelWithString: "●  Recording  0:00")
    var onStop: (() -> Void)?
    var onCancel: (() -> Void)?

    init(screen: NSScreen) {
        panel = NSPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .screenSaver
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        ink = ScrawlInkView(frame: NSRect(origin: .zero, size: screen.frame.size))
        panel.contentView = ink
        toolbar = NSPanel(contentRect: NSRect(x: screen.visibleFrame.midX - 225, y: screen.visibleFrame.maxY - 64, width: 450, height: 48),
                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        toolbar.isOpaque = false
        toolbar.backgroundColor = .clear
        toolbar.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
        toolbar.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let material = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 450, height: 48))
        material.material = .hudWindow
        material.state = .active
        material.wantsLayer = true
        material.layer?.cornerRadius = 14
        material.layer?.masksToBounds = true
        toolbar.contentView = material
        timeLabel.textColor = .systemRed
        timeLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        drawButton = NSButton(title: "Draw", target: nil, action: nil)
        let stop = NSButton(title: "Stop ⌃⌥S", target: nil, action: nil)
        let cancel = NSButton(title: "Cancel", target: nil, action: nil)
        let stack = NSStackView(views: [timeLabel, drawButton, stop, cancel])
        stack.spacing = 16
        stack.alignment = .centerY
        stack.frame = NSRect(x: 16, y: 8, width: 418, height: 32)
        material.addSubview(stack)
        drawButton.target = self
        drawButton.action = #selector(toggleDraw)
        stop.target = self
        stop.action = #selector(stopPressed)
        cancel.target = self
        cancel.action = #selector(cancelPressed)
    }
    func show() { panel.orderFrontRegardless(); toolbar.orderFrontRegardless() }
    func close() { ink.finishStroke(); panel.orderOut(nil); toolbar.orderOut(nil) }
    func updateTime(_ ms: Int) { timeLabel.stringValue = "●  Recording  \(ScrawlBundleWriter.clock(ms))" }
    @objc func toggleDraw() {
        ink.finishStroke()
        drawing.toggle()
        panel.ignoresMouseEvents = !drawing
        drawButton.title = drawing ? "Done drawing" : "Draw"
    }
    @objc private func stopPressed() { ink.finishStroke(); onStop?() }
    @objc private func cancelPressed() { onCancel?() }
}
