import AppKit

/// The small capsule that shows dictation is live. It never takes focus, so the app
/// George is dictating into stays frontmost and receives the paste.
final class DictationPill {
    enum Phase: Equatable {
        case listening
        case working
        case inserted
        case copied(String)
        case failed(String)
    }

    static let height: CGFloat = 34
    static let bottomMargin: CGFloat = 28
    private static let barCount = 9
    private static let barWidth: CGFloat = 3
    private static let barGap: CGFloat = 3
    private static let autoHideDelay: TimeInterval = 1.2

    private var panel: NSPanel?
    private var capsule: NSView?
    private var dot: FlydStatusDot?
    private var bars: [NSView] = []
    private var spinner: NSProgressIndicator?
    private var label: NSTextField?
    private var hideWork: DispatchWorkItem?

    /// Bottom-centre of `visibleFrame`, clamped so the pill never leaves the screen.
    static func frame(width: CGFloat, in visibleFrame: NSRect) -> NSRect {
        let clampedWidth = min(width, visibleFrame.width - 2 * bottomMargin)
        let x = visibleFrame.midX - clampedWidth / 2
        let y = visibleFrame.minY + bottomMargin
        return NSRect(x: x.rounded(), y: y, width: clampedWidth, height: height)
    }

    func show(_ phase: Phase) {
        hideWork?.cancel()
        hideWork = nil
        let panel = panel ?? makePanel()

        let width = layout(for: phase)
        panel.setFrame(Self.frame(width: width, in: Self.screenUnderMouse().visibleFrame), display: true)
        capsule?.frame = NSRect(x: 0, y: 0, width: panel.frame.width, height: Self.height)
        panel.orderFrontRegardless()

        switch phase {
        case .listening, .working:
            break
        case .inserted, .copied, .failed:
            let work = DispatchWorkItem { [weak self] in self?.hide() }
            hideWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.autoHideDelay, execute: work)
        }
    }

    func updateSpectrum(_ bands: [Float]) {
        guard !bars.isEmpty, bars.first?.isHidden == false else { return }
        for (index, bar) in bars.enumerated() {
            let value: CGFloat
            if bands.isEmpty {
                value = 0
            } else {
                let source = min(bands.count - 1, index * bands.count / bars.count)
                value = CGFloat(max(0, min(1, bands[source])))
            }
            let barHeight = 3 + value * 16
            bar.frame.size.height = barHeight
            bar.frame.origin.y = (Self.height - barHeight) / 2
        }
    }

    func hide() {
        hideWork?.cancel()
        hideWork = nil
        spinner?.stopAnimation(nil)
        panel?.orderOut(nil)
    }

    private func layout(for phase: Phase) -> CGFloat {
        let leading: CGFloat = 14
        let barsWidth = CGFloat(Self.barCount) * Self.barWidth + CGFloat(Self.barCount - 1) * Self.barGap
        let showBars = phase == .listening
        bars.forEach { $0.isHidden = !showBars }
        dot?.isHidden = !showBars
        spinner?.isHidden = phase != .working
        if phase == .working { spinner?.startAnimation(nil) } else { spinner?.stopAnimation(nil) }

        switch phase {
        case .listening:
            dot?.frame.origin = NSPoint(x: leading, y: (Self.height - 7) / 2)
            dot?.set(color: FlydPalette.listenBlue, pulsing: true)
            for (index, bar) in bars.enumerated() {
                bar.frame = NSRect(
                    x: leading + 7 + 10 + CGFloat(index) * (Self.barWidth + Self.barGap),
                    y: (Self.height - 3) / 2,
                    width: Self.barWidth,
                    height: 3
                )
            }
            label?.isHidden = true
            return leading + 7 + 10 + barsWidth + leading
        case .working:
            spinner?.frame = NSRect(x: leading, y: (Self.height - 16) / 2, width: 16, height: 16)
            return setLabel("Writing", color: FlydPalette.paper.withAlphaComponent(0.72), after: leading + 16 + 8)
        case .inserted:
            return setLabel("✓", color: FlydPalette.signalGreen, after: leading)
        case .copied(let message):
            return setLabel(message, color: FlydPalette.brassGlow, after: leading)
        case .failed(let message):
            return setLabel(message, color: FlydPalette.signalRust, after: leading)
        }
    }

    private func setLabel(_ text: String, color: NSColor, after x: CGFloat) -> CGFloat {
        guard let label else { return x }
        label.isHidden = false
        label.stringValue = text
        label.textColor = color
        let size = label.attributedStringValue.size()
        label.frame = NSRect(x: x, y: (Self.height - size.height) / 2, width: ceil(size.width) + 2, height: ceil(size.height))
        return x + label.frame.width + 14
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 120, height: Self.height),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle, .stationary]
        panel.ignoresMouseEvents = true
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false

        let capsule = NSView(frame: NSRect(x: 0, y: 0, width: 120, height: Self.height))
        capsule.wantsLayer = true
        capsule.layer?.backgroundColor = FlydPalette.ink.withAlphaComponent(0.94).cgColor
        capsule.layer?.cornerRadius = Self.height / 2
        capsule.layer?.borderWidth = 1
        capsule.layer?.borderColor = FlydPalette.line.cgColor
        panel.contentView?.addSubview(capsule)

        let dot = FlydStatusDot(frame: .zero)
        capsule.addSubview(dot)

        bars = (0..<Self.barCount).map { _ in
            let bar = NSView()
            bar.wantsLayer = true
            bar.layer?.backgroundColor = FlydPalette.listenBlue.withAlphaComponent(0.85).cgColor
            bar.layer?.cornerRadius = Self.barWidth / 2
            capsule.addSubview(bar)
            return bar
        }

        let spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.appearance = NSAppearance(named: .darkAqua)
        spinner.isDisplayedWhenStopped = false
        capsule.addSubview(spinner)

        let label = NSTextField(labelWithString: "")
        label.font = FlydPalette.monospace(12)
        capsule.addSubview(label)

        self.panel = panel
        self.capsule = capsule
        self.dot = dot
        self.spinner = spinner
        self.label = label
        return panel
    }

    private static func screenUnderMouse() -> NSScreen {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) }
            ?? NSScreen.main
            ?? NSScreen.screens[0]
    }
}
