import AppKit

/// Dictation status grown out of the MacBook notch: a black island flush with the notch
/// whose wings carry the live dot and level bars, dropping a strip below the notch for
/// messages. Screens without a notch get the same island at the top centre. It never
/// takes focus, so the app George is dictating into stays frontmost and receives the paste.
final class DictationPill: NSObject {
    /// One island for dictation and voice questions, so they never draw over each other.
    static let shared = DictationPill()

    enum Phase: Equatable {
        case listening
        case working
        /// A voice question on its way to Flyd: spinner in the wing, the question below the notch.
        case thinking(String)
        case inserted
        case notice(String)
        case failed(String)
        /// The firstmate conversation at a glance (ConversationStatus). Clickable.
        case status(String, StatusTone)
    }

    enum StatusTone: Equatable {
        /// The assistant is mid-turn: spinner, stays up while it lasts.
        case working
        /// A new reply: green dot, a few seconds.
        case reply
        /// The reply asks for the captain's decision: pulsing brass dot, a little longer.
        case decision
        /// A message went out: check mark, briefly.
        case sent

        var holdSeconds: TimeInterval? {
            switch self {
            case .working: return nil
            case .reply: return 6
            case .decision: return 10
            case .sent: return 2
            }
        }
    }

    /// What the island shows now, or nil when hidden.
    private(set) var currentPhase: Phase?
    /// Clicking a conversation status opens the Conversation window.
    var onStatusClick: (() -> Void)?

    /// Dictation or a voice question is using the island; conversation status waits.
    var isBusyWithVoice: Bool {
        guard let currentPhase, panel?.isVisible == true else { return false }
        if case .status = currentPhase { return false }
        return true
    }

    /// Height of the island on screens without a notch.
    static let fallbackHeight: CGFloat = 32
    static let wingWidth: CGFloat = 58
    static let messageStripHeight: CGFloat = 30
    static let cornerRadius: CGFloat = 14
    static let opticalLift: CGFloat = 2.5
    /// The level bars read low beside the dot, so they sit a little higher than it.
    private static let barLift: CGFloat = 2
    private static let barCount = 7
    private static let barWidth: CGFloat = 3
    private static let barGap: CGFloat = 3
    private static let autoHideDelay: TimeInterval = 1.4
    private static let animationDuration: TimeInterval = 0.28

    private var panel: NSPanel?
    private var island: NSView?
    private var dot: FlydStatusDot?
    private var bars: [NSView] = []
    private var spinner: NSProgressIndicator?
    private var check: NSTextField?
    private var label: NSTextField?
    private var hideWork: DispatchWorkItem?
    /// Bumped on every show, so a collapse that finishes after a newer show never hides it.
    private var generation = 0
    private var wingMidY: CGFloat = fallbackHeight / 2
    private var wingHeight: CGFloat = fallbackHeight

    /// The notch in screen coordinates, or nil on screens without one.
    static func notchRect(of screen: NSScreen) -> NSRect? {
        guard #available(macOS 12.0, *), screen.safeAreaInsets.top > 0,
              let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea else { return nil }
        let height = screen.safeAreaInsets.top
        return NSRect(x: left.maxX, y: screen.frame.maxY - height, width: right.minX - left.maxX, height: height)
    }

    /// Flush with the top edge, centred on the notch; wings either side, plus a strip
    /// below the notch when there is a message.
    static func islandFrame(screen: NSRect, notch: NSRect?, messageWidth: CGFloat?) -> NSRect {
        let notchWidth = notch?.width ?? 0
        let midX = notch?.midX ?? screen.midX
        var width = notchWidth + 2 * wingWidth
        var height = notch?.height ?? fallbackHeight
        if let messageWidth {
            width = max(width, messageWidth + 2 * cornerRadius)
            height += messageStripHeight
        }
        width = min(width, screen.width)
        let x = min(max(midX - width / 2, screen.minX), screen.maxX - width)
        return NSRect(x: x.rounded(), y: screen.maxY - height, width: width, height: height)
    }

    /// Collapsed into the notch itself: where the island grows from and shrinks back to.
    static func collapsedFrame(screen: NSRect, notch: NSRect?) -> NSRect {
        let height = notch?.height ?? fallbackHeight
        let width = notch?.width ?? 2 * cornerRadius
        let midX = notch?.midX ?? screen.midX
        return NSRect(x: (midX - width / 2).rounded(), y: screen.maxY - height, width: width, height: height)
    }

    func show(_ phase: Phase) {
        hideWork?.cancel()
        hideWork = nil
        generation += 1
        currentPhase = phase
        let wasVisible = panel?.isVisible == true
        let panel = panel ?? makePanel()
        let screen = Self.screenUnderMouse()
        let notch = Self.notchRect(of: screen)

        let messageWidth = configure(for: phase)
        let target = Self.islandFrame(screen: screen.frame, notch: notch, messageWidth: messageWidth)
        layoutContent(in: target.size, notch: notch)

        if !wasVisible {
            panel.setFrame(Self.collapsedFrame(screen: screen.frame, notch: notch), display: false)
            panel.orderFrontRegardless()
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Self.animationDuration
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
            panel.animator().setFrame(target, display: true)
        }

        var clickable = false
        var hold: TimeInterval?
        switch phase {
        case .listening, .working, .thinking:
            break
        case .inserted, .notice, .failed:
            hold = Self.autoHideDelay
        case .status(_, let tone):
            clickable = true
            hold = tone.holdSeconds
        }
        panel.ignoresMouseEvents = !clickable
        if let hold {
            let work = DispatchWorkItem { [weak self] in self?.hide() }
            hideWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + hold, execute: work)
        }
    }

    func updateSpectrum(_ bands: [Float]) {
        guard !bars.isEmpty, bars.first?.isHidden == false else { return }
        let maxHeight = max(6, wingHeight - 14)
        for (index, bar) in bars.enumerated() {
            let value: CGFloat
            if bands.isEmpty {
                value = 0
            } else {
                let source = min(bands.count - 1, index * bands.count / bars.count)
                value = CGFloat(max(0, min(1, bands[source])))
            }
            let barHeight = 3 + value * (maxHeight - 3)
            bar.frame.size.height = barHeight
            bar.frame.origin.y = wingMidY + Self.barLift - barHeight / 2
        }
    }

    func hide() {
        hideWork?.cancel()
        hideWork = nil
        currentPhase = nil
        panel?.ignoresMouseEvents = true
        guard let panel, panel.isVisible else { return }
        let hiding = generation
        let screen = Self.screenUnderMouse()
        let collapsed = Self.collapsedFrame(screen: screen.frame, notch: Self.notchRect(of: screen))
        [dot, check, label].forEach { $0?.isHidden = true }
        bars.forEach { $0.isHidden = true }
        spinner?.stopAnimation(nil)
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = Self.animationDuration
            panel.animator().setFrame(collapsed, display: true)
        }, completionHandler: { [weak self] in
            guard let self, self.generation == hiding else { return }
            panel.orderOut(nil)
        })
    }

    /// Shows the views this phase needs; returns the width of the message strip, if any.
    private func configure(for phase: Phase) -> CGFloat? {
        let spinning: Bool
        switch phase {
        case .working, .thinking, .status(_, .working): spinning = true
        default: spinning = false
        }
        bars.forEach { $0.isHidden = phase != .listening }
        spinner?.isHidden = !spinning
        if spinning { spinner?.startAnimation(nil) } else { spinner?.stopAnimation(nil) }
        check?.isHidden = phase != .inserted && !Self.isSent(phase)
        label?.isHidden = true
        dot?.isHidden = true

        switch phase {
        case .listening:
            dot?.isHidden = false
            dot?.set(color: FlydPalette.signalGreen, pulsing: true)
            return nil
        case .working:
            return nil
        case .thinking(let question):
            return setLabel(Self.quoted(question), color: FlydPalette.paper.withAlphaComponent(0.78))
        case .inserted:
            dot?.isHidden = false
            dot?.set(color: FlydPalette.signalGreen, pulsing: false)
            return nil
        case .notice(let message):
            return setLabel(message, color: FlydPalette.brassGlow)
        case .failed(let message):
            return setLabel(message, color: FlydPalette.signalRust)
        case .status(let text, let tone):
            switch tone {
            case .reply:
                dot?.isHidden = false
                dot?.set(color: FlydPalette.signalGreen, pulsing: false)
            case .decision:
                dot?.isHidden = false
                dot?.set(color: FlydPalette.brassGlow, pulsing: true)
            case .working, .sent:
                break
            }
            // Working is just the small spinning glyph in the wing: no words.
            guard tone != .working, !text.isEmpty else { return nil }
            let color = tone == .decision ? FlydPalette.brassGlow : FlydPalette.paper.withAlphaComponent(0.82)
            return setLabel(Self.quoted(text, limit: Self.statusLimit), color: color)
        }
    }

    private static func isSent(_ phase: Phase) -> Bool {
        if case .status(_, .sent) = phase { return true }
        return false
    }

    /// Positions content for the island's final size, in its own (bottom-left origin) coordinates.
    private func layoutContent(in size: NSSize, notch: NSRect?) {
        let topHeight = notch?.height ?? Self.fallbackHeight
        let notchWidth = notch?.width ?? 0
        let wingsStart = (size.width - notchWidth) / 2 - Self.wingWidth
        let leftWingMidX = wingsStart + Self.wingWidth / 2 + 4
        let rightWingMinX = wingsStart + Self.wingWidth + notchWidth
        // The rounded bottom corners pull the island's visual centre up; centring on the
        // geometry reads as sitting low.
        let midY = size.height - topHeight / 2 + Self.opticalLift
        wingMidY = midY
        wingHeight = topHeight

        dot?.frame.origin = NSPoint(x: (leftWingMidX - 3.5).rounded(), y: (midY - 3.5).rounded())
        spinner?.frame = NSRect(x: (leftWingMidX - 8).rounded(), y: (midY - 8).rounded(), width: 16, height: 16)

        let barsWidth = CGFloat(Self.barCount) * Self.barWidth + CGFloat(Self.barCount - 1) * Self.barGap
        let barsStart = rightWingMinX + (Self.wingWidth - barsWidth) / 2 - 4
        for (index, bar) in bars.enumerated() {
            bar.frame = NSRect(
                x: barsStart + CGFloat(index) * (Self.barWidth + Self.barGap),
                y: midY + Self.barLift - 1.5,
                width: Self.barWidth,
                height: 3
            )
        }

        if let check {
            let checkSize = check.attributedStringValue.size()
            check.frame = NSRect(
                x: (rightWingMinX + (Self.wingWidth - checkSize.width) / 2 - 4).rounded(),
                y: (midY - checkSize.height / 2).rounded(),
                width: ceil(checkSize.width) + 2,
                height: ceil(checkSize.height)
            )
        }

        if let label, !label.isHidden {
            let labelSize = label.attributedStringValue.size()
            label.frame = NSRect(
                x: ((size.width - labelSize.width) / 2).rounded(),
                y: ((Self.messageStripHeight - labelSize.height) / 2 + 2).rounded(),
                width: ceil(labelSize.width) + 2,
                height: ceil(labelSize.height)
            )
        }
    }

    static let questionLimit = 64
    /// Conversation status stays glanceable.
    static let statusLimit = 48

    /// The question as George said it, cut on a word boundary so the strip stays one line.
    static func quoted(_ question: String, limit: Int = questionLimit) -> String {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count > limit else { return text }
        let cut = text.prefix(limit)
        let words = cut.split(separator: " ").dropLast()
        return (words.isEmpty ? String(cut) : words.joined(separator: " ")) + "…"
    }

    private func setLabel(_ text: String, color: NSColor) -> CGFloat {
        guard let label else { return 0 }
        label.isHidden = false
        label.stringValue = text
        label.textColor = color
        return ceil(label.attributedStringValue.size().width) + 8
    }

    private func makePanel() -> NSPanel {
        let panel = NotchPanel(
            contentRect: NSRect(x: 0, y: 0, width: 120, height: Self.fallbackHeight),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        // Above the menu bar, so the island can sit on the notch.
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.mainMenuWindow)) + 2)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle, .stationary]
        panel.ignoresMouseEvents = true
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false

        let island = NSView(frame: panel.contentView?.bounds ?? .zero)
        island.autoresizingMask = [.width, .height]
        island.wantsLayer = true
        // Pure black so the island reads as the notch itself growing.
        island.layer?.backgroundColor = NSColor.black.cgColor
        island.layer?.cornerRadius = Self.cornerRadius
        island.layer?.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        panel.contentView?.addSubview(island)

        let dot = FlydStatusDot(frame: .zero)
        island.addSubview(dot)

        bars = (0..<Self.barCount).map { _ in
            let bar = NSView()
            bar.wantsLayer = true
            bar.layer?.backgroundColor = FlydPalette.signalGreen.withAlphaComponent(0.9).cgColor
            bar.layer?.cornerRadius = Self.barWidth / 2
            island.addSubview(bar)
            return bar
        }

        let spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.appearance = NSAppearance(named: .darkAqua)
        spinner.isDisplayedWhenStopped = false
        island.addSubview(spinner)

        let check = NSTextField(labelWithString: "✓")
        check.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        check.textColor = FlydPalette.signalGreen
        island.addSubview(check)

        let label = NSTextField(labelWithString: "")
        label.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        island.addSubview(label)

        island.addGestureRecognizer(NSClickGestureRecognizer(target: self, action: #selector(islandClicked)))

        self.panel = panel
        self.island = island
        self.dot = dot
        self.spinner = spinner
        self.check = check
        self.label = label
        return panel
    }

    @objc private func islandClicked() {
        guard case .status = currentPhase else { return }
        hide()
        onStatusClick?()
    }

    private static func screenUnderMouse() -> NSScreen {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) }
            ?? NSScreen.main
            ?? NSScreen.screens[0]
    }
}

/// AppKit pushes windows below the menu bar; the island has to overlap it to reach the notch.
private final class NotchPanel: NSPanel {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}
