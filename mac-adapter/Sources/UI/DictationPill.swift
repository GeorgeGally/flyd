import AppKit

/// Dictation status grown out of the MacBook notch: a black island flush with the notch
/// whose wings carry the live dot and level bars, growing out to the right of the notch, at
/// notch height, for messages. Screens without a notch get the same island at the top centre.
/// It never takes focus, so the app George is dictating into stays frontmost and receives the paste.
///
/// The panel is a fixed transparent canvas around the notch; the island itself is a shape
/// path (flared shoulders into the menu bar, continuous corners) that springs between the
/// notch, the compact wings and the message strip.
final class DictationPill: NSObject {
    /// One island for dictation and voice questions, so they never draw over each other.
    static let shared = DictationPill()

    enum Phase: Equatable {
        case listening
        case working
        /// A voice question on its way to Flyd: spinner and the question beside the notch.
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
    static let fallbackHeight: CGFloat = 34
    static let wingWidth: CGFloat = 86
    /// Concave flare where the island meets the menu bar, so it reads as the notch growing.
    static let compactShoulder: CGFloat = 8
    static let compactCornerRadius: CGFloat = 15
    /// The notch's own bottom corners, for the collapsed shape.
    static let notchCornerRadius: CGFloat = 9
    static let opticalLift: CGFloat = 2

    /// Message strip: grows out to the right of the notch at notch height, with type sized to
    /// read at a glance from a normal sitting distance.
    static let stripPadding: CGFloat = 18
    static let maxStripWidth: CGFloat = 640
    static let metaGap: CGFloat = 12
    static let titleBodyGap: CGFloat = 10
    static let metaFont = NSFont.systemFont(ofSize: 14, weight: .semibold)
    static let titleFont = NSFont.systemFont(ofSize: 19, weight: .semibold)
    static let bodyFont = NSFont.systemFont(ofSize: 19, weight: .regular)
    private static let metaDotSize: CGFloat = 9
    private static let metaDotGap: CGFloat = 8

    private static let dotSize: CGFloat = 11
    /// The level bars read low beside the dot, so they sit a little higher than it.
    private static let barLift: CGFloat = 1
    private static let barCount = 7
    private static let barWidth: CGFloat = 4
    private static let barGap: CGFloat = 3.5
    private static let glyphSize: CGFloat = 18
    /// Shadow room inside the canvas, around the island's sides and bottom.
    private static let shadowMargin: CGFloat = 36

    private static let autoHideDelay: TimeInterval = 1.4
    private static let maxHold: TimeInterval = 6
    private static let collapseDuration: TimeInterval = 0.32
    private static let fadeDuration: TimeInterval = 0.18

    private var panel: NSPanel?
    private var island: NSView?
    private var shapeLayers: [CAShapeLayer] = []
    private var dot: FlydStatusDot?
    private var bars: [NSView] = []
    private var spinner: IslandSpinner?
    private var check: IslandCheck?
    private var strip: NSView?
    private var metaDot: FlydStatusDot?
    private var textLabel: NSTextField?
    private var hideWork: DispatchWorkItem?
    /// Bumped on every show, so a collapse that finishes after a newer show never hides it.
    private var generation = 0
    private var wingMidY: CGFloat = fallbackHeight / 2
    private var wingHeight: CGFloat = fallbackHeight
    /// The island's outline in screen coordinates while a status is clickable. The canvas is
    /// mostly transparent, so the panel takes the mouse only while the pointer is over it.
    private var clickArea: NSRect?
    private var mouseMonitors: [Any] = []

    /// What the strip says, on one line: a small meta label, a bold title, and an optional body.
    struct Message: Equatable {
        var meta: String
        var title: String
        var body: String?
    }

    /// The notch in screen coordinates, or nil on screens without one.
    static func notchRect(of screen: NSScreen) -> NSRect? {
        guard #available(macOS 12.0, *), screen.safeAreaInsets.top > 0,
              let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea else { return nil }
        let height = screen.safeAreaInsets.top
        return NSRect(x: left.maxX, y: screen.frame.maxY - height, width: right.minX - left.maxX, height: height)
    }

    /// Width of the island's body (between the shoulders) with only the wings showing.
    static func compactBodyWidth(notch: NSRect?) -> CGFloat {
        (notch?.width ?? 0) + 2 * wingWidth
    }

    /// Flush with the top edge at notch height. Compact: centred on the notch, wings either
    /// side. With a message: anchored at the notch's left edge, growing out to the right by
    /// `strip` (the strip's width, padding included). The frame includes the shoulders.
    static func islandFrame(screen: NSRect, notch: NSRect?, strip: CGFloat?) -> NSRect {
        let height = notch?.height ?? fallbackHeight
        let shoulder = compactShoulder
        guard let strip else {
            let midX = notch?.midX ?? screen.midX
            let width = min(compactBodyWidth(notch: notch) + 2 * shoulder, screen.width)
            let x = min(max(midX - width / 2, screen.minX), screen.maxX - width)
            return NSRect(x: x.rounded(), y: screen.maxY - height, width: width, height: height)
        }
        let notchFrame = collapsedFrame(screen: screen, notch: notch)
        let x = max(notchFrame.minX - shoulder, screen.minX)
        let width = min(notchFrame.maxX + min(strip, maxStripWidth) + shoulder, screen.maxX) - x
        return NSRect(x: x, y: screen.maxY - height, width: width, height: height)
    }

    /// Collapsed into the notch itself: where the island grows from and shrinks back to.
    static func collapsedFrame(screen: NSRect, notch: NSRect?) -> NSRect {
        let height = notch?.height ?? fallbackHeight
        let width = notch?.width ?? 2 * compactCornerRadius
        let midX = notch?.midX ?? screen.midX
        return NSRect(x: (midX - width / 2).rounded(), y: screen.maxY - height, width: width, height: height)
    }

    /// The transparent panel the island draws in: room for the compact wings and the widest
    /// strip plus its shadow, so the island can change shape without the window moving under it.
    static func canvasFrame(screen: NSRect, notch: NSRect?) -> NSRect {
        let compact = islandFrame(screen: screen, notch: notch, strip: nil)
        let widest = islandFrame(screen: screen, notch: notch, strip: maxStripWidth)
        let minX = max(min(compact.minX, widest.minX) - shadowMargin, screen.minX)
        let maxX = min(max(compact.maxX, widest.maxX) + shadowMargin, screen.maxX)
        let height = (notch?.height ?? fallbackHeight) + shadowMargin
        return NSRect(x: minX, y: screen.maxY - height, width: maxX - minX, height: height)
    }

    /// The widest the strip's line of text can be before it truncates.
    static var maxTextWidth: CGFloat { maxStripWidth - 2 * stripPadding - metaDotSize - metaDotGap }

    /// The strip's width for a line of text this wide, padding and meta dot included.
    static func stripWidth(text: CGFloat) -> CGFloat {
        ceil(2 * stripPadding + metaDotSize + metaDotGap + min(text, maxTextWidth))
    }

    /// The strip's line: meta label, then title, then the body in a quieter weight.
    static func line(for message: Message, meta: NSColor) -> NSAttributedString {
        let line = NSMutableAttributedString(attributedString: FlydPalette.tracked(message.meta, font: metaFont, color: meta, tracking: 0.3))
        line.append(NSAttributedString(string: " ", attributes: [.font: metaFont, .kern: metaGap - 4]))
        line.append(NSAttributedString(string: message.title, attributes: [.font: titleFont, .foregroundColor: FlydPalette.paper]))
        if let body = message.body {
            line.append(NSAttributedString(string: " ", attributes: [.font: bodyFont, .kern: titleBodyGap - 5]))
            line.append(NSAttributedString(string: body, attributes: [.font: bodyFont, .foregroundColor: FlydPalette.paper.withAlphaComponent(0.7)]))
        }
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byTruncatingTail
        line.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: line.length))
        return line
    }

    static func lineHeight(_ font: NSFont) -> CGFloat {
        ceil(NSLayoutManager().defaultLineHeight(for: font))
    }

    /// What the strip says for a phase, or nil when the island stays compact. A message with a
    /// line break shows its first line as the title and the rest as the body.
    static func message(for phase: Phase) -> Message? {
        switch phase {
        case .listening, .working, .inserted, .status(_, .working), .status(_, .sent):
            return nil
        case .thinking(let question):
            return Message(meta: "You asked", title: quoted(question), body: nil)
        case .status(let text, let tone):
            var title = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if tone == .decision, title.hasPrefix(decisionPrefix) {
                title = String(title.dropFirst(decisionPrefix.count)).trimmingCharacters(in: .whitespaces)
            }
            guard !title.isEmpty else { return nil }
            return Message(meta: tone == .decision ? "Needs you" : "Reply", title: quoted(title, limit: statusLimit), body: nil)
        case .notice(let text), .failed(let text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let parts = trimmed.split(separator: "\n", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            let body = parts.count > 1 && !parts[1].isEmpty ? parts[1] : nil
            return Message(meta: "Flyd", title: parts.first ?? trimmed, body: body)
        }
    }

    /// How long a finished phase stays up: long enough to read, never parked over the menu bar.
    static func holdDuration(for phase: Phase) -> TimeInterval? {
        switch phase {
        case .listening, .working, .thinking:
            return nil
        case .inserted:
            return autoHideDelay
        case .notice(let text), .failed(let text):
            let words = text.split(whereSeparator: \.isWhitespace).count
            return min(maxHold, max(autoHideDelay, 0.6 + 0.24 * Double(words)))
        case .status(_, let tone):
            return tone.holdSeconds
        }
    }

    /// The island's outline in a bottom-left-origin space whose top edge is `rect.maxY` (the
    /// screen's top). Shoulders flare out into the menu bar; bottom corners are continuous.
    /// Every outline has the same elements, so one springs smoothly into another.
    static func islandPath(in rect: NSRect, shoulder: CGFloat, cornerRadius: CGFloat, closed: Bool = true) -> CGPath {
        let s = max(0, min(shoulder, rect.width / 4, rect.height / 2))
        let r = max(0, min(cornerRadius, (rect.width - 2 * s) / 2, rect.height - s))
        // A squircle-ish corner: the curve starts earlier and eases in, like a continuous corner.
        let reach = min(r * 1.28, (rect.width - 2 * s) / 2, rect.height - s)
        let ease: CGFloat = 0.36
        let left = rect.minX + s, right = rect.maxX - s
        let top = rect.maxY, bottom = rect.minY

        let path = CGMutablePath()
        path.move(to: CGPoint(x: rect.minX, y: top))
        path.addQuadCurve(to: CGPoint(x: left, y: top - s), control: CGPoint(x: left, y: top))
        path.addLine(to: CGPoint(x: left, y: bottom + reach))
        path.addCurve(to: CGPoint(x: left + reach, y: bottom),
                      control1: CGPoint(x: left, y: bottom + reach * ease),
                      control2: CGPoint(x: left + reach * ease, y: bottom))
        path.addLine(to: CGPoint(x: right - reach, y: bottom))
        path.addCurve(to: CGPoint(x: right, y: bottom + reach),
                      control1: CGPoint(x: right - reach * ease, y: bottom),
                      control2: CGPoint(x: right, y: bottom + reach * ease))
        path.addLine(to: CGPoint(x: right, y: top - s))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: top), control: CGPoint(x: right, y: top))
        if closed { path.closeSubpath() }
        return path
    }

    func show(_ phase: Phase) {
        hideWork?.cancel()
        hideWork = nil
        generation += 1
        currentPhase = phase
        let panel = panel ?? makePanel()
        let screen = Self.screenUnderMouse()
        let notch = Self.notchRect(of: screen)
        let canvas = Self.canvasFrame(screen: screen.frame, notch: notch)
        // Same screen and already up: change shape in place; otherwise grow out of the notch.
        let growing = !(panel.isVisible && panel.frame == canvas)

        let stripWidth = configure(for: phase)
        let target = Self.islandFrame(screen: screen.frame, notch: notch, strip: stripWidth)
        let local = target.offsetBy(dx: -canvas.minX, dy: -canvas.minY)
        let shoulder = Self.compactShoulder
        let radius = Self.compactCornerRadius
        layoutContent(in: local, notch: notch)

        if growing {
            panel.setFrame(canvas, display: false)
            let collapsed = Self.collapsedFrame(screen: screen.frame, notch: notch)
                .offsetBy(dx: -canvas.minX, dy: -canvas.minY)
            setShape(in: collapsed, shoulder: 0, radius: Self.notchCornerRadius, animated: false)
            panel.orderFrontRegardless()
        }
        // A reduced-motion hide may be mid-fade; a new phase always shows in full.
        island?.alphaValue = 1

        if FlydPalette.reduceMotion {
            setShape(in: local, shoulder: shoulder, radius: radius, animated: false)
            if growing {
                island?.alphaValue = 0
                fade(island, to: 1)
            }
            self.strip?.alphaValue = 1
        } else {
            setShape(in: local, shoulder: shoulder, radius: radius, animated: true)
            if let stripView = self.strip, stripWidth != nil {
                stripView.alphaValue = 0
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self, generation] in
                    guard let self, self.generation == generation else { return }
                    self.fade(stripView, to: 1, duration: 0.24)
                }
            }
        }
        if phase == .inserted || Self.isSent(phase) {
            check?.draw(animated: !FlydPalette.reduceMotion)
        }
        if case .status = phase { setClickArea(target) } else { setClickArea(nil) }

        if let hold = Self.holdDuration(for: phase) {
            let work = DispatchWorkItem { [weak self] in self?.hide() }
            hideWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + hold, execute: work)
        }
    }

    func updateSpectrum(_ bands: [Float]) {
        guard !bars.isEmpty, bars.first?.isHidden == false else { return }
        let maxHeight = max(8, wingHeight - 10)
        for (index, bar) in bars.enumerated() {
            let value: CGFloat
            if bands.isEmpty {
                value = 0
            } else {
                let source = min(bands.count - 1, index * bands.count / bars.count)
                value = CGFloat(max(0, min(1, bands[source])))
            }
            let barHeight = Self.barWidth + value * (maxHeight - Self.barWidth)
            bar.frame.size.height = barHeight
            bar.frame.origin.y = wingMidY + Self.barLift - barHeight / 2
        }
    }

    func hide() {
        hideWork?.cancel()
        hideWork = nil
        currentPhase = nil
        setClickArea(nil)
        guard let panel, panel.isVisible else { return }
        let hiding = generation
        let finish = { [weak self] in
            guard let self, self.generation == hiding else { return }
            panel.orderOut(nil)
            self.island?.alphaValue = 1
            self.hideContent()
        }

        if FlydPalette.reduceMotion {
            fade(island, to: 0, completion: finish)
            return
        }
        // Collapse into the notch the island grew from, even if the pointer has moved to another display.
        let screen = panel.screen ?? Self.screenUnderMouse()
        let collapsed = Self.collapsedFrame(screen: screen.frame, notch: Self.notchRect(of: screen))
            .offsetBy(dx: -panel.frame.minX, dy: -panel.frame.minY)
        fade(strip, to: 0, duration: 0.12)
        hideContent(keepStrip: true)
        CATransaction.begin()
        CATransaction.setCompletionBlock(finish)
        setShape(in: collapsed, shoulder: 0, radius: Self.notchCornerRadius, animated: true, collapsing: true)
        CATransaction.commit()
    }

    private func hideContent(keepStrip: Bool = false) {
        dot?.isHidden = true
        bars.forEach { $0.isHidden = true }
        spinner?.stop()
        check?.isHidden = true
        if !keepStrip { strip?.isHidden = true }
    }

    /// Shows the views this phase needs; returns the strip's width, if the phase has a message.
    private func configure(for phase: Phase) -> CGFloat? {
        let spinning: Bool
        switch phase {
        case .working, .thinking, .status(_, .working): spinning = true
        default: spinning = false
        }
        bars.forEach { $0.isHidden = phase != .listening }
        if spinning { spinner?.start() } else { spinner?.stop() }
        check?.isHidden = phase != .inserted && !Self.isSent(phase)
        dot?.isHidden = true

        switch phase {
        case .listening:
            dot?.isHidden = false
            dot?.set(color: FlydPalette.signalGreen, pulsing: true)
        case .inserted:
            dot?.isHidden = false
            dot?.set(color: FlydPalette.signalGreen, pulsing: false)
        default:
            break
        }

        guard let message = Self.message(for: phase) else {
            strip?.isHidden = true
            return nil
        }
        let quiet = FlydPalette.paper.withAlphaComponent(0.55)
        switch phase {
        case .failed: return setMessage(message, dot: FlydPalette.signalRust, meta: FlydPalette.signalRust)
        case .notice: return setMessage(message, dot: FlydPalette.brassGlow, meta: quiet)
        case .status(_, .decision): return setMessage(message, dot: FlydPalette.brassGlow, meta: FlydPalette.brassGlow, pulsing: true)
        case .status: return setMessage(message, dot: FlydPalette.signalGreen, meta: quiet)
        // A voice question keeps its spinner where the dot would be.
        default: return setMessage(message, dot: nil, meta: quiet)
        }
    }

    private static func isSent(_ phase: Phase) -> Bool {
        if case .status(_, .sent) = phase { return true }
        return false
    }

    private func setMessage(_ message: Message, dot: NSColor?, meta: NSColor, pulsing: Bool = false) -> CGFloat? {
        guard let strip, let textLabel, let metaDot else { return nil }
        strip.isHidden = false
        metaDot.isHidden = dot == nil
        if let dot { metaDot.set(color: dot, pulsing: pulsing) }
        textLabel.attributedStringValue = Self.line(for: message, meta: meta)
        return Self.stripWidth(text: ceil(textLabel.attributedStringValue.size().width))
    }

    /// Positions content for the island's final outline, in canvas (bottom-left origin) coordinates.
    private func layoutContent(in rect: NSRect, notch: NSRect?) {
        let shoulder = Self.compactShoulder
        let topHeight = notch?.height ?? Self.fallbackHeight
        let notchWidth = notch?.width ?? 0
        // The rounded bottom corners pull the island's visual centre up; centring on the
        // geometry reads as sitting low.
        let midY = rect.maxY - topHeight / 2 + Self.opticalLift
        wingMidY = midY
        wingHeight = topHeight
        let leftWingMidX = rect.midX - notchWidth / 2 - Self.wingWidth / 2 + 6
        let rightWingMidX = rect.midX + notchWidth / 2 + Self.wingWidth / 2 - 6

        dot?.frame.origin = NSPoint(x: (leftWingMidX - Self.dotSize / 2).rounded(), y: (midY - Self.dotSize / 2).rounded())
        spinner?.frame = NSRect(x: (leftWingMidX - Self.glyphSize / 2).rounded(), y: (midY - Self.glyphSize / 2).rounded(),
                                width: Self.glyphSize, height: Self.glyphSize)
        check?.frame = NSRect(x: (rightWingMidX - Self.glyphSize / 2).rounded(), y: (midY - Self.glyphSize / 2).rounded(),
                              width: Self.glyphSize, height: Self.glyphSize)

        let barsWidth = CGFloat(Self.barCount) * Self.barWidth + CGFloat(Self.barCount - 1) * Self.barGap
        let barsStart = rightWingMidX - barsWidth / 2
        for (index, bar) in bars.enumerated() {
            bar.frame = NSRect(
                x: barsStart + CGFloat(index) * (Self.barWidth + Self.barGap),
                y: midY + Self.barLift - Self.barWidth / 2,
                width: Self.barWidth,
                height: Self.barWidth
            )
        }

        guard let strip, !strip.isHidden, let textLabel, let metaDot else { return }
        // The strip starts where the notch ends: the left of the island is the notch itself.
        let stripX = rect.minX + shoulder + (notch?.width ?? 2 * Self.compactCornerRadius)
        strip.frame = NSRect(x: stripX, y: rect.minY, width: max(0, rect.maxX - shoulder - stripX), height: rect.height)
        let stripMidY = midY - rect.minY
        let slotMidX = Self.stripPadding + Self.metaDotSize / 2
        metaDot.frame.origin = NSPoint(x: (slotMidX - Self.metaDotSize / 2).rounded(), y: (stripMidY - Self.metaDotSize / 2).rounded())
        // A voice question's spinner moves out of the (now hidden) left wing into the dot's place.
        if metaDot.isHidden {
            spinner?.frame.origin = NSPoint(x: (stripX + slotMidX - Self.glyphSize / 2).rounded(),
                                            y: (midY - Self.glyphSize / 2).rounded())
        }
        // Text fields inset their text by 2pt; pull the field out so the text sits on the padding.
        let textX = Self.stripPadding + Self.metaDotSize + Self.metaDotGap - 2
        let textHeight = Self.lineHeight(Self.titleFont)
        textLabel.frame = NSRect(x: textX, y: (stripMidY - textHeight / 2).rounded(),
                                 width: max(0, strip.frame.width - textX - Self.stripPadding + 4), height: textHeight)
    }

    /// Moves every layer that traces the island to a new outline, springing there unless told not to.
    private func setShape(in rect: NSRect, shoulder: CGFloat, radius: CGFloat, animated: Bool, collapsing: Bool = false) {
        let filled = Self.islandPath(in: rect, shoulder: shoulder, cornerRadius: radius)
        let outline = Self.islandPath(in: rect, shoulder: shoulder, cornerRadius: radius, closed: false)
        for layer in shapeLayers {
            let path = layer.fillColor == nil ? outline : filled
            if animated {
                let animation: CABasicAnimation
                if collapsing {
                    animation = CABasicAnimation(keyPath: "path")
                    animation.duration = Self.collapseDuration
                    animation.timingFunction = CAMediaTimingFunction(controlPoints: 0.4, 0, 0.2, 1)
                } else {
                    let spring = CASpringAnimation(keyPath: "path")
                    spring.mass = 1
                    spring.stiffness = 280
                    spring.damping = 24
                    spring.duration = spring.settlingDuration
                    animation = spring
                }
                animation.fromValue = layer.presentation()?.path ?? layer.path
                animation.toValue = path
                animation.fillMode = .backwards
                layer.add(animation, forKey: "path")
                if layer.shadowOpacity > 0 {
                    let shadow = animation.copy() as! CABasicAnimation
                    shadow.keyPath = "shadowPath"
                    shadow.fromValue = layer.presentation()?.shadowPath ?? layer.shadowPath
                    layer.add(shadow, forKey: "shadowPath")
                }
            } else {
                layer.removeAllAnimations()
            }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.path = path
            if layer.shadowOpacity > 0 { layer.shadowPath = path }
            CATransaction.commit()
        }
    }

    private func fade(_ view: NSView?, to alpha: CGFloat, duration: TimeInterval = fadeDuration, completion: (() -> Void)? = nil) {
        guard let view else { completion?(); return }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = duration
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            view.animator().alphaValue = alpha
        }, completionHandler: completion)
    }

    static let questionLimit = 140
    /// Conversation status stays glanceable: a headline, not the reply.
    static let statusLimit = 100
    /// How ConversationStatus marks a reply that asks for a decision; the strip says it in its meta label.
    static let decisionPrefix = "Needs you:"

    /// The question as George said it, cut on a word boundary so it fits the strip.
    static func quoted(_ question: String, limit: Int = questionLimit) -> String {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count > limit else { return text }
        let cut = text.prefix(limit)
        let words = cut.split(separator: " ").dropLast()
        return (words.isEmpty ? String(cut) : words.joined(separator: " ")) + "…"
    }

    private func makePanel() -> NSPanel {
        let panel = NotchPanel(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 200),
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

        guard let content = panel.contentView else { return panel }
        content.wantsLayer = true

        // A soft shadow under the island, drawn by its own layer so the island can stay masked.
        let shadow = CAShapeLayer()
        shadow.fillColor = NSColor.clear.cgColor
        shadow.shadowColor = NSColor.black.cgColor
        shadow.shadowOpacity = 0.5
        shadow.shadowRadius = 18
        shadow.shadowOffset = CGSize(width: 0, height: -8)
        let shadowView = NSView(frame: content.bounds)
        shadowView.autoresizingMask = [.width, .height]
        shadowView.wantsLayer = true
        shadowView.layer?.addSublayer(shadow)
        content.addSubview(shadowView)

        let island = NSView(frame: content.bounds)
        island.autoresizingMask = [.width, .height]
        island.wantsLayer = true
        content.addSubview(island)

        // Dark material under a black-to-ink wash: pure black at the top so the island reads
        // as the notch itself growing, a little depth lower down.
        let material = NSVisualEffectView(frame: island.bounds)
        material.autoresizingMask = [.width, .height]
        material.appearance = NSAppearance(named: .darkAqua)
        material.material = .hudWindow
        material.blendingMode = .behindWindow
        material.state = .active
        island.addSubview(material)

        let wash = GradientView(frame: island.bounds)
        wash.autoresizingMask = [.width, .height]
        wash.gradient.colors = [NSColor.black.cgColor, FlydPalette.inkDeep.withAlphaComponent(0.9).cgColor]
        wash.gradient.locations = [0.15, 1]
        wash.gradient.startPoint = CGPoint(x: 0.5, y: 1)
        wash.gradient.endPoint = CGPoint(x: 0.5, y: 0)
        island.addSubview(wash)

        let mask = CAShapeLayer()
        mask.fillColor = NSColor.black.cgColor
        island.layer?.mask = mask

        // A hairline along the island's sides and bottom, never across the screen's top edge.
        let edge = CAShapeLayer()
        edge.fillColor = nil
        edge.strokeColor = FlydPalette.paper.withAlphaComponent(0.1).cgColor
        edge.lineWidth = 1
        wash.layer?.addSublayer(edge)
        shapeLayers = [shadow, mask, edge]

        let dot = FlydStatusDot(frame: .zero, diameter: Self.dotSize)
        island.addSubview(dot)

        bars = (0..<Self.barCount).map { _ in
            let bar = NSView()
            bar.wantsLayer = true
            bar.layer?.backgroundColor = FlydPalette.signalGreen.withAlphaComponent(0.92).cgColor
            bar.layer?.cornerRadius = Self.barWidth / 2
            island.addSubview(bar)
            return bar
        }

        let spinner = IslandSpinner(frame: NSRect(x: 0, y: 0, width: Self.glyphSize, height: Self.glyphSize))
        island.addSubview(spinner)

        let check = IslandCheck(frame: NSRect(x: 0, y: 0, width: Self.glyphSize, height: Self.glyphSize))
        island.addSubview(check)

        let strip = NSView()
        strip.isHidden = true
        island.addSubview(strip)

        let metaDot = FlydStatusDot(frame: .zero, diameter: Self.metaDotSize)
        strip.addSubview(metaDot)

        let textLabel = NSTextField(labelWithString: "")
        textLabel.maximumNumberOfLines = 1
        textLabel.lineBreakMode = .byTruncatingTail
        textLabel.cell?.truncatesLastVisibleLine = true
        strip.addSubview(textLabel)

        self.panel = panel
        self.island = island
        self.dot = dot
        self.spinner = spinner
        self.check = check
        self.strip = strip
        self.metaDot = metaDot
        self.textLabel = textLabel
        island.addGestureRecognizer(NSClickGestureRecognizer(target: self, action: #selector(islandClicked)))
        hideContent()
        return panel
    }

    @objc private func islandClicked() {
        guard case .status = currentPhase else { return }
        hide()
        onStatusClick?()
    }

    /// Lets a status take clicks on the island only; everywhere else on the canvas the
    /// pointer passes through to whatever is under it. nil makes the panel ignore the mouse.
    private func setClickArea(_ area: NSRect?) {
        clickArea = area
        guard area != nil else {
            mouseMonitors.forEach(NSEvent.removeMonitor)
            mouseMonitors = []
            panel?.ignoresMouseEvents = true
            return
        }
        if mouseMonitors.isEmpty {
            let moves: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged]
            if let global = NSEvent.addGlobalMonitorForEvents(matching: moves, handler: { [weak self] _ in self?.trackPointer() }) {
                mouseMonitors.append(global)
            }
            if let local = NSEvent.addLocalMonitorForEvents(matching: moves, handler: { [weak self] event in
                self?.trackPointer()
                return event
            }) {
                mouseMonitors.append(local)
            }
        }
        panel?.acceptsMouseMovedEvents = true
        trackPointer()
    }

    private func trackPointer() {
        let over = clickArea.map { NSMouseInRect(NSEvent.mouseLocation, $0, false) } ?? false
        if panel?.ignoresMouseEvents == over { panel?.ignoresMouseEvents = !over }
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

private final class GradientView: NSView {
    let gradient = CAGradientLayer()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
    }

    override func makeBackingLayer() -> CALayer { gradient }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

/// Bright orange spokes stepping round: Flyd working, readable at a glance on the black island.
/// The leading spoke is at full opacity and the trail fades behind it.
private final class IslandSpinner: NSView {
    private static let spokeCount = 8
    /// How much each trailing spoke fades; the last one keeps about a third of the lead.
    private static let trailFade: Float = 0.085
    private let spokes = CAReplicatorLayer()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        spokes.frame = bounds
        spokes.instanceCount = Self.spokeCount
        // Each copy one step anticlockwise and dimmer, so the brightest spoke leads clockwise.
        spokes.instanceTransform = CATransform3DMakeRotation(2 * .pi / CGFloat(Self.spokeCount), 0, 0, 1)
        spokes.instanceAlphaOffset = -Self.trailFade

        let spoke = CAShapeLayer()
        spoke.frame = bounds
        let path = CGMutablePath()
        path.move(to: CGPoint(x: bounds.midX, y: bounds.maxY - 1.5))
        path.addLine(to: CGPoint(x: bounds.midX, y: bounds.maxY - bounds.height * 0.36))
        spoke.path = path
        spoke.strokeColor = FlydPalette.workingOrange.cgColor
        spoke.lineWidth = 2.4
        spoke.lineCap = .round
        spokes.addSublayer(spoke)
        layer?.addSublayer(spokes)
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func start() {
        isHidden = false
        spokes.frame = bounds
        guard spokes.animation(forKey: "spin") == nil, !FlydPalette.reduceMotion else { return }
        // Step a spoke at a time, like the system spinner, rather than smearing round.
        let step = 2 * CGFloat.pi / CGFloat(Self.spokeCount)
        let spin = CAKeyframeAnimation(keyPath: "transform.rotation.z")
        spin.values = (0..<Self.spokeCount).map { -CGFloat($0) * step }
        spin.calculationMode = .discrete
        spin.duration = 0.8
        spin.repeatCount = .infinity
        spokes.add(spin, forKey: "spin")
    }

    func stop() {
        isHidden = true
        spokes.removeAnimation(forKey: "spin")
    }
}

/// A check mark that draws itself on when the dictation lands.
private final class IslandCheck: NSView {
    private let mark = CAShapeLayer()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        let path = CGMutablePath()
        path.move(to: CGPoint(x: bounds.width * 0.18, y: bounds.height * 0.5))
        path.addLine(to: CGPoint(x: bounds.width * 0.42, y: bounds.height * 0.26))
        path.addLine(to: CGPoint(x: bounds.width * 0.84, y: bounds.height * 0.74))
        mark.path = path
        mark.fillColor = nil
        mark.strokeColor = FlydPalette.signalGreen.cgColor
        mark.lineWidth = 2.6
        mark.lineCap = .round
        mark.lineJoin = .round
        layer?.addSublayer(mark)
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func draw(animated: Bool) {
        isHidden = false
        mark.removeAnimation(forKey: "draw")
        guard animated else { return }
        let draw = CABasicAnimation(keyPath: "strokeEnd")
        draw.fromValue = 0
        draw.toValue = 1
        draw.duration = 0.32
        draw.beginTime = CACurrentMediaTime() + 0.1
        draw.fillMode = .backwards
        draw.timingFunction = CAMediaTimingFunction(name: .easeOut)
        mark.add(draw, forKey: "draw")
    }
}
