import AppKit

/// Dictation status grown out of the MacBook notch: a black island flush with the notch
/// whose wings carry the live dot and level bars, opening into a card below the notch for
/// messages. Screens without a notch get the same island at the top centre. It never
/// takes focus, so the app George is dictating into stays frontmost and receives the paste.
///
/// The panel is a fixed transparent canvas around the notch; the island itself is a shape
/// path (flared shoulders into the menu bar, continuous corners) that springs between the
/// notch, the compact wings and the message card.
final class DictationPill {
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
    }

    /// Height of the island on screens without a notch.
    static let fallbackHeight: CGFloat = 34
    static let wingWidth: CGFloat = 86
    /// Concave flare where the island meets the menu bar, so it reads as the notch growing.
    static let compactShoulder: CGFloat = 8
    static let cardShoulder: CGFloat = 12
    static let compactCornerRadius: CGFloat = 15
    static let cardCornerRadius: CGFloat = 30
    /// The notch's own bottom corners, for the collapsed shape.
    static let notchCornerRadius: CGFloat = 9
    static let opticalLift: CGFloat = 2

    /// Message card: sized to read at a glance from a normal sitting distance.
    static let cardPadding: CGFloat = 28
    static let cardTopGap: CGFloat = 6
    static let cardBottomPadding: CGFloat = 24
    static let metaGap: CGFloat = 8
    static let titleBodyGap: CGFloat = 4
    static let maxCardWidth: CGFloat = 620
    static let maxTitleLines = 3
    static let maxTitleLinesWithBody = 2
    static let maxBodyLines = 3
    static let metaFont = NSFont.systemFont(ofSize: 14, weight: .semibold)
    static let titleFont = NSFont.systemFont(ofSize: 23, weight: .semibold)
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
    private var card: NSView?
    private var metaDot: FlydStatusDot?
    private var metaLabel: NSTextField?
    private var titleLabel: NSTextField?
    private var bodyLabel: NSTextField?
    private var hideWork: DispatchWorkItem?
    /// Bumped on every show, so a collapse that finishes after a newer show never hides it.
    private var generation = 0
    private var wingMidY: CGFloat = fallbackHeight / 2
    private var wingHeight: CGFloat = fallbackHeight

    /// What the card says: a small meta line, a bold title, and an optional body.
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

    /// Flush with the top edge, centred on the notch: wings either side, opening into a card
    /// below the notch when there is a message. `card` is the card's size below the notch,
    /// padding included. The frame includes the shoulders.
    static func islandFrame(screen: NSRect, notch: NSRect?, card: NSSize?) -> NSRect {
        let midX = notch?.midX ?? screen.midX
        var bodyWidth = compactBodyWidth(notch: notch)
        var height = notch?.height ?? fallbackHeight
        var shoulder = compactShoulder
        if let card {
            bodyWidth = max(bodyWidth, min(card.width, maxCardWidth))
            height += card.height
            shoulder = cardShoulder
        }
        let width = min(bodyWidth + 2 * shoulder, screen.width)
        let x = min(max(midX - width / 2, screen.minX), screen.maxX - width)
        return NSRect(x: x.rounded(), y: screen.maxY - height, width: width, height: height)
    }

    /// Collapsed into the notch itself: where the island grows from and shrinks back to.
    static func collapsedFrame(screen: NSRect, notch: NSRect?) -> NSRect {
        let height = notch?.height ?? fallbackHeight
        let width = notch?.width ?? 2 * compactCornerRadius
        let midX = notch?.midX ?? screen.midX
        return NSRect(x: (midX - width / 2).rounded(), y: screen.maxY - height, width: width, height: height)
    }

    /// The transparent panel the island draws in: room for the widest, tallest card plus its
    /// shadow, so the island can change shape without the window moving under it.
    static func canvasFrame(screen: NSRect, notch: NSRect?) -> NSRect {
        let midX = notch?.midX ?? screen.midX
        let islandWidth = max(compactBodyWidth(notch: notch) + 2 * compactShoulder, maxCardWidth + 2 * cardShoulder)
        let width = min(islandWidth + 2 * shadowMargin, screen.width)
        let height = (notch?.height ?? fallbackHeight) + maxCardHeight + shadowMargin
        let x = min(max(midX - width / 2, screen.minX), screen.maxX - width)
        return NSRect(x: x.rounded(), y: screen.maxY - height, width: width, height: height)
    }

    /// The card's size for text blocks of the given sizes, padding included.
    static func cardSize(meta: NSSize, title: NSSize, body: NSSize?) -> NSSize {
        let metaWidth = metaDotSize + metaDotGap + meta.width
        let textWidth = max(metaWidth, title.width, body?.width ?? 0)
        var height = cardTopGap + max(meta.height, metaDotSize) + metaGap + title.height + cardBottomPadding
        if let body { height += titleBodyGap + body.height }
        return NSSize(width: ceil(textWidth + 2 * cardPadding), height: ceil(height))
    }

    static var maxTextWidth: CGFloat { maxCardWidth - 2 * cardPadding }

    /// The tallest card any message can make: two title lines and a full body.
    static var maxCardHeight: CGFloat {
        let tallestWithBody = cardSize(
            meta: NSSize(width: 0, height: lineHeight(metaFont)),
            title: NSSize(width: 0, height: CGFloat(maxTitleLinesWithBody) * lineHeight(titleFont)),
            body: NSSize(width: 0, height: CGFloat(maxBodyLines) * lineHeight(bodyFont))
        ).height
        let tallestTitle = cardSize(
            meta: NSSize(width: 0, height: lineHeight(metaFont)),
            title: NSSize(width: 0, height: CGFloat(maxTitleLines) * lineHeight(titleFont)),
            body: nil
        ).height
        return max(tallestWithBody, tallestTitle)
    }

    static func lineHeight(_ font: NSFont) -> CGFloat {
        ceil(NSLayoutManager().defaultLineHeight(for: font))
    }

    /// What the card says for a phase, or nil when the island stays compact. A message with a
    /// line break shows its first line as the title and the rest as the body.
    static func message(for phase: Phase) -> Message? {
        switch phase {
        case .listening, .working, .inserted:
            return nil
        case .thinking(let question):
            return Message(meta: "You asked", title: quoted(question), body: nil)
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
        let panel = panel ?? makePanel()
        let screen = Self.screenUnderMouse()
        let notch = Self.notchRect(of: screen)
        let canvas = Self.canvasFrame(screen: screen.frame, notch: notch)
        // Same screen and already up: change shape in place; otherwise grow out of the notch.
        let growing = !(panel.isVisible && panel.frame == canvas)

        let card = configure(for: phase)
        let target = Self.islandFrame(screen: screen.frame, notch: notch, card: card)
        let local = target.offsetBy(dx: -canvas.minX, dy: -canvas.minY)
        let shoulder = card == nil ? Self.compactShoulder : Self.cardShoulder
        let radius = card == nil ? Self.compactCornerRadius : Self.cardCornerRadius
        layoutContent(in: local, shoulder: shoulder, notch: notch)

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
            self.card?.alphaValue = 1
        } else {
            setShape(in: local, shoulder: shoulder, radius: radius, animated: true)
            if let cardView = self.card, card != nil {
                cardView.alphaValue = 0
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self, generation] in
                    guard let self, self.generation == generation else { return }
                    self.fade(cardView, to: 1, duration: 0.24)
                }
            }
        }
        if phase == .inserted { check?.draw(animated: !FlydPalette.reduceMotion) }

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
        let screen = Self.screenUnderMouse()
        let collapsed = Self.collapsedFrame(screen: screen.frame, notch: Self.notchRect(of: screen))
            .offsetBy(dx: -panel.frame.minX, dy: -panel.frame.minY)
        fade(card, to: 0, duration: 0.12)
        hideContent(keepCard: true)
        CATransaction.begin()
        CATransaction.setCompletionBlock(finish)
        setShape(in: collapsed, shoulder: 0, radius: Self.notchCornerRadius, animated: true, collapsing: true)
        CATransaction.commit()
    }

    private func hideContent(keepCard: Bool = false) {
        dot?.isHidden = true
        bars.forEach { $0.isHidden = true }
        spinner?.stop()
        check?.isHidden = true
        if !keepCard { card?.isHidden = true }
    }

    /// Shows the views this phase needs; returns the card's size, if the phase has a message.
    private func configure(for phase: Phase) -> NSSize? {
        let spinning: Bool
        switch phase {
        case .working, .thinking: spinning = true
        default: spinning = false
        }
        bars.forEach { $0.isHidden = phase != .listening }
        if spinning { spinner?.start() } else { spinner?.stop() }
        check?.isHidden = phase != .inserted
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
            card?.isHidden = true
            return nil
        }
        let quiet = FlydPalette.paper.withAlphaComponent(0.55)
        switch phase {
        case .failed: return setMessage(message, dot: FlydPalette.signalRust, meta: FlydPalette.signalRust)
        case .notice: return setMessage(message, dot: FlydPalette.brassGlow, meta: quiet)
        default: return setMessage(message, dot: quiet, meta: quiet)
        }
    }

    private func setMessage(_ message: Message, dot: NSColor, meta: NSColor) -> NSSize? {
        guard let card, let metaLabel, let titleLabel, let bodyLabel, let metaDot else { return nil }
        card.isHidden = false
        metaDot.set(color: dot, pulsing: false)
        metaLabel.attributedStringValue = FlydPalette.tracked(message.meta, font: Self.metaFont, color: meta, tracking: 0.3)
        titleLabel.stringValue = message.title
        titleLabel.maximumNumberOfLines = message.body == nil ? Self.maxTitleLines : Self.maxTitleLinesWithBody
        bodyLabel.stringValue = message.body ?? ""
        bodyLabel.isHidden = message.body == nil

        let meta = Self.measure(metaLabel.attributedStringValue, maxLines: 1)
        let title = Self.measure(titleLabel.attributedStringValue, maxLines: titleLabel.maximumNumberOfLines)
        let body = message.body.map { _ in Self.measure(bodyLabel.attributedStringValue, maxLines: Self.maxBodyLines) }
        return Self.cardSize(meta: meta, title: title, body: body)
    }

    /// Text size wrapped to the card's width, capped at `maxLines` lines.
    private static func measure(_ text: NSAttributedString, maxLines: Int) -> NSSize {
        guard text.length > 0 else { return .zero }
        let font = text.attribute(.font, at: 0, effectiveRange: nil) as? NSFont ?? bodyFont
        let bounds = text.boundingRect(
            with: NSSize(width: maxTextWidth, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading]
        )
        let height = min(ceil(bounds.height), CGFloat(maxLines) * lineHeight(font))
        return NSSize(width: min(ceil(bounds.width), maxTextWidth), height: height)
    }

    /// Positions content for the island's final outline, in canvas (bottom-left origin) coordinates.
    private func layoutContent(in rect: NSRect, shoulder: CGFloat, notch: NSRect?) {
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

        guard let card, !card.isHidden, let metaLabel, let titleLabel, let bodyLabel, let metaDot else { return }
        let cardTop = rect.maxY - topHeight
        card.frame = NSRect(x: rect.minX + shoulder, y: rect.minY, width: rect.width - 2 * shoulder, height: cardTop - rect.minY)
        // Text fields inset their text by 2pt; pull them out so the text sits on the padding,
        // and give them slack below so the last line never drops to a truncated one.
        let x = Self.cardPadding - 2
        let slack: CGFloat = 4
        var top = card.frame.height - Self.cardTopGap

        let meta = Self.measure(metaLabel.attributedStringValue, maxLines: 1)
        let metaRow = max(meta.height, Self.metaDotSize)
        metaDot.frame.origin = NSPoint(x: Self.cardPadding, y: (top - metaRow / 2 - Self.metaDotSize / 2).rounded())
        metaLabel.frame = NSRect(x: x + Self.metaDotSize + Self.metaDotGap, y: top - metaRow / 2 - meta.height / 2,
                                 width: meta.width + 4, height: meta.height)
        top -= metaRow + Self.metaGap

        let title = Self.measure(titleLabel.attributedStringValue, maxLines: titleLabel.maximumNumberOfLines)
        titleLabel.frame = NSRect(x: x, y: top - title.height - slack, width: Self.maxTextWidth + 4, height: title.height + slack)
        top -= title.height + Self.titleBodyGap

        if !bodyLabel.isHidden {
            let body = Self.measure(bodyLabel.attributedStringValue, maxLines: Self.maxBodyLines)
            bodyLabel.frame = NSRect(x: x, y: top - body.height - slack, width: Self.maxTextWidth + 4, height: body.height + slack)
        }
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

    /// The question as George said it, cut on a word boundary so it fits the card's title.
    static func quoted(_ question: String) -> String {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count > questionLimit else { return text }
        let cut = text.prefix(questionLimit)
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

        // A soft shadow under the card, drawn by its own layer so the island can stay masked.
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
        // as the notch itself growing, a little depth lower down where the card opens.
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

        let card = NSView()
        card.isHidden = true
        island.addSubview(card)

        let metaDot = FlydStatusDot(frame: .zero, diameter: Self.metaDotSize)
        card.addSubview(metaDot)

        let metaLabel = NSTextField(labelWithString: "")
        metaLabel.font = Self.metaFont
        card.addSubview(metaLabel)

        let titleLabel = Self.wrappingLabel(font: Self.titleFont, color: FlydPalette.paper)
        card.addSubview(titleLabel)

        let bodyLabel = Self.wrappingLabel(font: Self.bodyFont, color: FlydPalette.paper.withAlphaComponent(0.74))
        bodyLabel.maximumNumberOfLines = Self.maxBodyLines
        card.addSubview(bodyLabel)

        self.panel = panel
        self.island = island
        self.dot = dot
        self.spinner = spinner
        self.check = check
        self.card = card
        self.metaDot = metaDot
        self.metaLabel = metaLabel
        self.titleLabel = titleLabel
        self.bodyLabel = bodyLabel
        hideContent()
        return panel
    }

    private static func wrappingLabel(font: NSFont, color: NSColor) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: "")
        label.font = font
        label.textColor = color
        label.lineBreakMode = .byWordWrapping
        label.cell?.truncatesLastVisibleLine = true
        return label
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

/// A thin rotating arc: Flyd working, in the island's own hand rather than the system spinner.
private final class IslandSpinner: NSView {
    private let arc = CAShapeLayer()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        let inset: CGFloat = 2
        arc.frame = bounds
        arc.path = CGPath(ellipseIn: bounds.insetBy(dx: inset, dy: inset), transform: nil)
        arc.fillColor = nil
        arc.strokeColor = FlydPalette.paper.withAlphaComponent(0.85).cgColor
        arc.lineWidth = 2.4
        arc.lineCap = .round
        arc.strokeStart = 0
        arc.strokeEnd = 0.72
        layer?.addSublayer(arc)
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func start() {
        isHidden = false
        arc.frame = bounds
        guard arc.animation(forKey: "spin") == nil, !FlydPalette.reduceMotion else { return }
        arc.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        arc.position = CGPoint(x: bounds.midX, y: bounds.midY)
        let spin = CABasicAnimation(keyPath: "transform.rotation.z")
        spin.fromValue = 0
        spin.toValue = -2 * CGFloat.pi
        spin.duration = 0.9
        spin.repeatCount = .infinity
        arc.add(spin, forKey: "spin")
    }

    func stop() {
        isHidden = true
        arc.removeAnimation(forKey: "spin")
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
