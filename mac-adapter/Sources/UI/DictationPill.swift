import AppKit

/// Dictation status grown out of the MacBook notch: a black island flush with the notch
/// whose wings carry the live dot and level bars. For a message it grows out to the right of
/// the notch and hangs below the menu bar there, so the message can be set large.
/// Screens without a notch get the same island at the top centre.
/// It never takes focus, so the app George is dictating into stays frontmost and receives the paste.
///
/// The panel is a fixed transparent canvas around the notch; the island itself is a shape
/// path (flared shoulders into the menu bar, continuous corners) that springs between the
/// notch, the compact wings and the message strip beside the notch.
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
        /// What is happening to his message now ("Passing this to firstmate"): spinner, briefly.
        case progress

        var holdSeconds: TimeInterval? {
            switch self {
            case .working: return nil
            case .reply: return 6
            case .decision: return 10
            case .sent: return 2
            case .progress: return 3.5
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

    /// Message strip: grows out to the right of the notch and hangs below the menu bar, a
    /// small state label over the message set large in Flyd's display face, so it reads at a
    /// glance from a normal sitting distance. Every message gets the same strip and the same
    /// type size; a longer one truncates rather than resizing either.
    static let stripInset: CGFloat = 26
    static let stripTopPadding: CGFloat = 18
    /// A little more than the top: the last line's descenders leave room the eye counts as space.
    static let stripBottomPadding: CGFloat = 20
    static let stripCornerRadius: CGFloat = 22
    /// Wider than this and a line gets too long to take in at once.
    static let stripWidth: CGFloat = 620
    /// The strip never runs into the screen's edge.
    static let screenMargin: CGFloat = 16
    static let labelRowHeight: CGFloat = 16
    /// Tight: the label belongs to the message under it.
    static let labelGap: CGFloat = 2
    static let bodyGap: CGFloat = 6
    /// The state label: monospaced caps, tracked out, like the rest of Flyd's state readouts.
    static let labelFont = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .semibold)
    /// The message, on up to two lines; with a body under it, the title takes one and the body the other.
    static let titleFont = displayFont(28)
    static let bodyFont = NSFont(name: "HelveticaNeue", size: 18) ?? .systemFont(ofSize: 18)
    static let titleLines = 2
    private static let metaDotSize: CGFloat = 8
    private static let metaDotGap: CGFloat = 9

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
    private var metaLabel: IslandText?
    private var titleText: IslandText?
    private var bodyText: IslandText?
    private var stripLayout: StripLayout?
    private var hideWork: DispatchWorkItem?
    /// Bumped on every show, so a collapse that finishes after a newer show never hides it.
    private var generation = 0
    private var wingMidY: CGFloat = fallbackHeight / 2
    private var wingHeight: CGFloat = fallbackHeight
    /// The island's outline in screen coordinates while a status is clickable. The canvas is
    /// mostly transparent, so the panel takes the mouse only while the pointer is over it.
    private var clickArea: [NSRect] = []
    private var mouseMonitors: [Any] = []

    /// What the strip says: a small meta label, the message's title, and an optional body under it.
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

    /// Flush with the top edge. Compact: centred on the notch at notch height, wings either
    /// side. With a message: anchored at the notch's left edge, growing out to the right by the
    /// strip's width and down to its height (padding included); the part over the notch stays
    /// notch height (see `islandPath`). The frame includes the shoulders.
    static func islandFrame(screen: NSRect, notch: NSRect?, strip: NSSize?) -> NSRect {
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
        let width = min(notchFrame.maxX + strip.width + shoulder, screen.maxX) - x
        let stripHeight = max(height, strip.height)
        return NSRect(x: x, y: screen.maxY - stripHeight, width: width, height: stripHeight)
    }

    /// Collapsed into the notch itself: where the island grows from and shrinks back to.
    static func collapsedFrame(screen: NSRect, notch: NSRect?) -> NSRect {
        let height = notch?.height ?? fallbackHeight
        let width = notch?.width ?? 2 * compactCornerRadius
        let midX = notch?.midX ?? screen.midX
        return NSRect(x: (midX - width / 2).rounded(), y: screen.maxY - height, width: width, height: height)
    }

    /// The transparent panel the island draws in: room for the compact wings and the message
    /// strip plus its shadow, so the island can change shape without the window moving under it.
    static func canvasFrame(screen: NSRect, notch: NSRect?) -> NSRect {
        let compact = islandFrame(screen: screen, notch: notch, strip: nil)
        let strip = islandFrame(screen: screen, notch: notch, strip: NSSize(width: stripWidth, height: stripHeight))
        let minX = max(min(compact.minX, strip.minX) - shadowMargin, screen.minX)
        let maxX = min(max(compact.maxX, strip.maxX) + shadowMargin, screen.maxX)
        let height = max(compact.height, strip.height) + shadowMargin
        return NSRect(x: minX, y: screen.maxY - height, width: maxX - minX, height: height)
    }

    /// How a message sits in the fixed strip: the title's and body's boxes, the height of the
    /// label and text together (centred in the strip), and the strip's size with its padding.
    struct StripLayout: Equatable {
        var title: Block
        var body: Block?
        var content: CGFloat
        var size: NSSize
    }

    /// Text cut to fit its lines, and the box it sets in.
    struct Block: Equatable {
        var text: NSAttributedString
        var size: NSSize
    }

    /// The strip's one height: the label over two lines of the message, in padding.
    static var stripHeight: CGFloat {
        ceil(stripTopPadding + labelRowHeight + labelGap + CGFloat(titleLines) * lineHeight(titleFont) + stripBottomPadding)
    }

    /// Lays out a message in the strip, which is `stripWidth` wide unless the screen has less
    /// room than that. The title truncates past two lines at a word and breaks into even
    /// lines, so a second line never holds a single word; a body takes the title's second line.
    static func stripLayout(for message: Message, maxWidth: CGFloat) -> StripLayout {
        let width = max(0, min(maxWidth, stripWidth))
        let textWidth = max(0, width - 2 * stripInset)
        let title = block(title(message.title), width: textWidth, maxLines: message.body == nil ? titleLines : 1)
        let body = message.body.map { block(Self.body($0), width: textWidth, maxLines: 1) }
        var content = labelRowHeight + labelGap + title.size.height
        if let body { content += bodyGap + body.size.height }
        return StripLayout(title: title, body: body, content: content, size: NSSize(width: width, height: stripHeight))
    }

    /// `text` set in at most `maxLines` at `width`: cut at a word with an ellipsis when it runs
    /// longer, then balanced so every line is about as long as the longest.
    static func block(_ text: NSAttributedString, width: CGFloat, maxLines: Int) -> Block {
        let lineHeight = (text.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?.maximumLineHeight ?? 0
        func measure(_ text: NSAttributedString, _ width: CGFloat) -> NSRect {
            text.boundingRect(with: NSSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin])
        }
        func lines(_ text: NSAttributedString, _ width: CGFloat) -> Int {
            max(1, Int((measure(text, width).height / max(lineHeight, 1)).rounded()))
        }
        let fitted = lines(text, width) > maxLines ? cut(text, toFit: { lines($0, width) <= maxLines }) : text
        let count = min(lines(fitted, width), maxLines)
        guard count > 1 else {
            return Block(text: fitted, size: NSSize(width: min(width, ceil(measure(fitted, width).width) + 1), height: lineHeight))
        }
        // The narrowest width that still sets it in as many lines.
        var low = width / CGFloat(count), high = width
        while high - low > 1 {
            let mid = (low + high) / 2
            if lines(fitted, mid) <= count { high = mid } else { low = mid }
        }
        return Block(text: fitted, size: NSSize(width: ceil(high), height: lineHeight * CGFloat(count)))
    }

    /// The most of `text`, cut after a whole word, that fits with an ellipsis; `text` itself if
    /// not even its first word does, so the drawing truncates it instead.
    static func cut(_ text: NSAttributedString, toFit fits: (NSAttributedString) -> Bool) -> NSAttributedString {
        let string = text.string as NSString
        var ends: [Int] = []
        string.enumerateSubstrings(in: NSRange(location: 0, length: string.length), options: .byWords) { _, range, _, _ in
            ends.append(range.location + range.length)
        }
        func candidate(_ end: Int) -> NSAttributedString {
            let cut = NSMutableAttributedString(attributedString: text.attributedSubstring(from: NSRange(location: 0, length: end)))
            cut.append(NSAttributedString(string: "…", attributes: text.attributes(at: max(0, end - 1), effectiveRange: nil)))
            return cut
        }
        var best: NSAttributedString?
        var low = 0, high = ends.count - 1
        while low <= high {
            let mid = (low + high) / 2
            let attempt = candidate(ends[mid])
            if fits(attempt) { best = attempt; low = mid + 1 } else { high = mid - 1 }
        }
        return best ?? text
    }

    static func displayFont(_ size: CGFloat) -> NSFont {
        NSFont(name: "HelveticaNeue-Medium", size: size) ?? .systemFont(ofSize: size, weight: .medium)
    }

    /// Fixed line heights, so measured and drawn text agree and lines sit on an even rhythm.
    static func lineHeight(_ font: NSFont) -> CGFloat {
        font.pointSize >= 20 ? (font.pointSize * 1.22).rounded() : (font.pointSize * 1.28).rounded()
    }

    private static func paragraph(_ font: NSFont) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = lineHeight(font)
        style.maximumLineHeight = lineHeight(font)
        style.lineBreakMode = .byWordWrapping
        return style
    }

    /// The state label, in tracked-out caps.
    static func label(_ text: String, color: NSColor) -> NSAttributedString {
        NSAttributedString(string: text.uppercased(), attributes: [
            .font: labelFont, .foregroundColor: color, .kern: 1.6, .paragraphStyle: paragraph(labelFont)
        ])
    }

    /// The message, tracked in a touch as display type wants at this size.
    static func title(_ text: String) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [
            .font: titleFont, .foregroundColor: FlydPalette.paper, .kern: -0.018 * titleFont.pointSize, .paragraphStyle: paragraph(titleFont)
        ])
    }

    static func body(_ text: String) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [
            .font: bodyFont, .foregroundColor: FlydPalette.paper.withAlphaComponent(0.66), .kern: -0.1, .paragraphStyle: paragraph(bodyFont)
        ])
    }

    /// What the strip says for a phase, or nil when the island stays compact. A message with a
    /// line break shows its first line as the title and the rest as the body.
    static func message(for phase: Phase) -> Message? {
        switch phase {
        case .listening, .working, .inserted, .status(_, .working), .status(_, .sent):
            return nil
        case .thinking(let question):
            return Message(meta: "You asked", title: quoted(question), body: nil)
        case .status(let text, .progress):
            let title = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return title.isEmpty ? nil : Message(meta: "Flyd", title: quoted(title, limit: statusLimit), body: nil)
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
    /// `step` is where the part over the notch meets the strip beside it: left of `step.x` the
    /// island ends at `step.y` (notch height), right of it the strip hangs down to `rect.minY`,
    /// joined by a rounded inner corner. When `step.y` is at the bottom the island is one height
    /// and the step folds flat into the bottom edge at `step.x`, so every outline has the same
    /// elements and one springs smoothly into another, the strip unfolding from that point.
    static func islandPath(in rect: NSRect, shoulder: CGFloat, cornerRadius: CGFloat, step: CGPoint? = nil, closed: Bool = true) -> CGPath {
        let s = max(0, min(shoulder, rect.width / 4, rect.height / 2))
        let left = rect.minX + s, right = rect.maxX - s
        let top = rect.maxY, bottom = rect.minY
        // A squircle-ish corner: the curve starts earlier and eases in, like a continuous corner.
        func reach(_ radius: CGFloat, width: CGFloat, height: CGFloat) -> CGFloat {
            max(0, min(radius * 1.28, width / 2, height))
        }
        let ease: CGFloat = 0.36
        let path = CGMutablePath()
        /// A continuous corner from `start` round the corner point to `end`.
        func corner(to end: CGPoint, from start: CGPoint, horizontalFirst: Bool) {
            let vertex = horizontalFirst ? CGPoint(x: end.x, y: start.y) : CGPoint(x: start.x, y: end.y)
            path.addCurve(to: end,
                          control1: CGPoint(x: vertex.x + (start.x - vertex.x) * ease, y: vertex.y + (start.y - vertex.y) * ease),
                          control2: CGPoint(x: vertex.x + (end.x - vertex.x) * ease, y: vertex.y + (end.y - vertex.y) * ease))
        }

        path.move(to: CGPoint(x: rect.minX, y: top))
        path.addQuadCurve(to: CGPoint(x: left, y: top - s), control: CGPoint(x: left, y: top))
        if let step, step.y > bottom + 1, step.x > left, step.x < right {
            let ledge = min(step.y, top - s)
            let inner = max(0, min(10, (ledge - bottom) / 2, (right - step.x) / 2))
            let a = reach(min(cornerRadius, compactCornerRadius), width: step.x - inner - left, height: top - s - ledge)
            let b = reach(cornerRadius, width: (right - step.x) / 2, height: ledge - inner - bottom)
            let r = reach(cornerRadius, width: (right - step.x) / 2, height: top - s - bottom)
            path.addLine(to: CGPoint(x: left, y: ledge + a))
            corner(to: CGPoint(x: left + a, y: ledge), from: CGPoint(x: left, y: ledge + a), horizontalFirst: false)
            path.addLine(to: CGPoint(x: step.x - inner, y: ledge))
            path.addQuadCurve(to: CGPoint(x: step.x, y: ledge - inner), control: CGPoint(x: step.x, y: ledge))
            path.addLine(to: CGPoint(x: step.x, y: bottom + b))
            corner(to: CGPoint(x: step.x + b, y: bottom), from: CGPoint(x: step.x, y: bottom + b), horizontalFirst: false)
            path.addLine(to: CGPoint(x: right - r, y: bottom))
            corner(to: CGPoint(x: right, y: bottom + r), from: CGPoint(x: right - r, y: bottom), horizontalFirst: true)
        } else {
            let r = reach(cornerRadius, width: right - left, height: top - s - bottom)
            let fold = CGPoint(x: min(max(step?.x ?? (left + right) / 2, left + r), right - r), y: bottom)
            path.addLine(to: CGPoint(x: left, y: bottom + r))
            corner(to: CGPoint(x: left + r, y: bottom), from: CGPoint(x: left, y: bottom + r), horizontalFirst: false)
            path.addLine(to: fold)
            path.addQuadCurve(to: fold, control: fold)
            path.addLine(to: fold)
            path.addCurve(to: fold, control1: fold, control2: fold)
            path.addLine(to: CGPoint(x: right - r, y: bottom))
            corner(to: CGPoint(x: right, y: bottom + r), from: CGPoint(x: right - r, y: bottom), horizontalFirst: true)
        }
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

        let notchFrame = Self.collapsedFrame(screen: screen.frame, notch: notch)
        let room = screen.frame.maxX - notchFrame.maxX - Self.compactShoulder - Self.screenMargin
        let stripSize = configure(for: phase, maxWidth: room)
        let target = Self.islandFrame(screen: screen.frame, notch: notch, strip: stripSize)
        let local = target.offsetBy(dx: -canvas.minX, dy: -canvas.minY)
        let collapsed = notchFrame.offsetBy(dx: -canvas.minX, dy: -canvas.minY)
        let step = CGPoint(x: collapsed.maxX, y: collapsed.minY)
        let shoulder = Self.compactShoulder
        let radius = stripSize == nil ? Self.compactCornerRadius : Self.stripCornerRadius
        layoutContent(in: local, notch: notch)

        if growing {
            panel.setFrame(canvas, display: false)
            setShape(in: collapsed, shoulder: 0, radius: Self.notchCornerRadius, step: step, animated: false)
            panel.orderFrontRegardless()
        }
        // A reduced-motion hide may be mid-fade; a new phase always shows in full.
        island?.alphaValue = 1

        if FlydPalette.reduceMotion {
            setShape(in: local, shoulder: shoulder, radius: radius, step: step, animated: false)
            if growing {
                island?.alphaValue = 0
                fade(island, to: 1)
            }
            self.strip?.alphaValue = 1
        } else {
            setShape(in: local, shoulder: shoulder, radius: radius, step: step, animated: true)
            if stripSize != nil { revealStrip() }
        }
        if phase == .inserted || Self.isSent(phase) {
            check?.draw(animated: !FlydPalette.reduceMotion)
        }
        if case .status = phase {
            // The island's own outline: the notch part and the strip beside it, not the empty corner under the notch.
            let notchPart = NSRect(x: target.minX, y: notchFrame.minY, width: notchFrame.maxX - target.minX, height: notchFrame.height)
            let stripPart = NSRect(x: notchFrame.maxX, y: target.minY, width: target.maxX - notchFrame.maxX, height: target.height)
            setClickArea(stripSize == nil ? [target] : [notchPart, stripPart])
        } else {
            setClickArea([])
        }

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
        setClickArea([])
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
        setShape(in: collapsed, shoulder: 0, radius: Self.notchCornerRadius, step: CGPoint(x: collapsed.maxX, y: collapsed.minY),
                 animated: true, collapsing: true)
        CATransaction.commit()
    }

    private func hideContent(keepStrip: Bool = false) {
        dot?.isHidden = true
        bars.forEach { $0.isHidden = true }
        spinner?.stop()
        check?.isHidden = true
        if !keepStrip { strip?.isHidden = true }
    }

    /// Shows the views this phase needs; returns the strip's size, if the phase has a message.
    private func configure(for phase: Phase, maxWidth: CGFloat) -> NSSize? {
        let spinning: Bool
        switch phase {
        case .working, .thinking, .status(_, .working), .status(_, .progress): spinning = true
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
        let quiet = FlydPalette.paper.withAlphaComponent(0.5)
        let layout = Self.stripLayout(for: message, maxWidth: maxWidth)
        switch phase {
        case .failed: return setMessage(message, layout, dot: FlydPalette.signalRust, meta: FlydPalette.signalRust)
        case .notice: return setMessage(message, layout, dot: FlydPalette.brassGlow, meta: quiet)
        case .status(_, .decision): return setMessage(message, layout, dot: FlydPalette.brassGlow, meta: FlydPalette.brassGlow, pulsing: true)
        // The spinner already says it is under way.
        case .status(_, .progress): return setMessage(message, layout, dot: nil, meta: quiet)
        case .status: return setMessage(message, layout, dot: FlydPalette.signalGreen, meta: FlydPalette.signalGreen)
        // A voice question keeps its spinner where the dot would be.
        default: return setMessage(message, layout, dot: nil, meta: quiet)
        }
    }

    private static func isSent(_ phase: Phase) -> Bool {
        if case .status(_, .sent) = phase { return true }
        return false
    }

    private func setMessage(_ message: Message, _ layout: StripLayout, dot: NSColor?, meta: NSColor, pulsing: Bool = false) -> NSSize? {
        guard let strip, let metaDot, let metaLabel, let titleText, let bodyText else { return nil }
        strip.isHidden = false
        metaDot.isHidden = dot == nil
        if let dot { metaDot.set(color: dot, pulsing: pulsing) }
        metaLabel.text = Self.label(message.meta, color: meta)
        titleText.text = layout.title.text
        bodyText.text = layout.body?.text
        bodyText.isHidden = message.body == nil
        stripLayout = layout
        return layout.size
    }

    /// The message slides out of the notch as the island opens, label first, then the message.
    private func revealStrip() {
        guard let strip else { return }
        strip.alphaValue = 1
        let parts = [metaDot, metaLabel, titleText, bodyText].compactMap { $0 }.filter { !$0.isHidden }
        let start = CACurrentMediaTime() + 0.05
        for (index, part) in parts.enumerated() {
            guard let layer = part.layer else { continue }
            let begin = start + 0.04 * Double(index)
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 0
            fade.toValue = 1
            fade.duration = 0.26
            fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
            let slide = CASpringAnimation(keyPath: "transform.translation.x")
            slide.fromValue = -18
            slide.toValue = 0
            slide.stiffness = 260
            slide.damping = 26
            slide.duration = slide.settlingDuration
            for animation in [fade, slide] as [CABasicAnimation] {
                animation.beginTime = begin
                animation.fillMode = .backwards
                layer.add(animation, forKey: animation.keyPath)
            }
        }
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

        guard let strip, !strip.isHidden, let layout = stripLayout,
              let metaDot, let metaLabel, let titleText, let bodyText else { return }
        // The strip starts where the notch ends: the left of the island is the notch itself.
        let stripX = rect.minX + shoulder + (notch?.width ?? 2 * Self.compactCornerRadius)
        strip.frame = NSRect(x: stripX, y: rect.minY, width: max(0, rect.maxX - shoulder - stripX), height: rect.height)
        let inset = Self.stripInset
        // Laid out from the top down, the label and message centred between the paddings.
        let room = strip.frame.height - Self.stripTopPadding - Self.stripBottomPadding
        var top = strip.frame.height - Self.stripTopPadding - max(0, (room - layout.content) / 2).rounded()
        let rowMidY = top - Self.labelRowHeight / 2
        // A voice question's spinner moves out of the (now hidden) left wing into the dot's place.
        let slot = metaDot.isHidden ? Self.glyphSize : Self.metaDotSize
        metaDot.frame.origin = NSPoint(x: inset, y: (rowMidY - Self.metaDotSize / 2).rounded())
        if metaDot.isHidden {
            spinner?.frame.origin = NSPoint(x: stripX + inset, y: (rect.minY + rowMidY - Self.glyphSize / 2).rounded())
        }
        let labelHeight = Self.lineHeight(Self.labelFont)
        let labelX = inset + slot + Self.metaDotGap
        metaLabel.frame = NSRect(x: labelX, y: (rowMidY - labelHeight / 2).rounded(),
                                 width: max(0, strip.frame.width - labelX - inset), height: labelHeight)
        top -= Self.labelRowHeight + Self.labelGap
        let title = layout.title.size
        titleText.frame = NSRect(x: inset, y: top - title.height, width: title.width, height: title.height)
        top -= title.height
        if let body = layout.body?.size {
            top -= Self.bodyGap
            bodyText.frame = NSRect(x: inset, y: top - body.height, width: body.width, height: body.height)
        }
    }

    /// Moves every layer that traces the island to a new outline, springing there unless told not to.
    private func setShape(in rect: NSRect, shoulder: CGFloat, radius: CGFloat, step: CGPoint, animated: Bool, collapsing: Bool = false) {
        let filled = Self.islandPath(in: rect, shoulder: shoulder, cornerRadius: radius, step: step)
        let outline = Self.islandPath(in: rect, shoulder: shoulder, cornerRadius: radius, step: step, closed: false)
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
        strip.wantsLayer = true
        strip.isHidden = true
        island.addSubview(strip)

        let metaDot = FlydStatusDot(frame: .zero, diameter: Self.metaDotSize)
        strip.addSubview(metaDot)
        let metaLabel = IslandText()
        let titleText = IslandText()
        let bodyText = IslandText()
        [metaLabel, titleText, bodyText].forEach(strip.addSubview)

        self.panel = panel
        self.island = island
        self.dot = dot
        self.spinner = spinner
        self.check = check
        self.strip = strip
        self.metaDot = metaDot
        self.metaLabel = metaLabel
        self.titleText = titleText
        self.bodyText = bodyText
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
    /// pointer passes through to whatever is under it. No area makes the panel ignore the mouse.
    private func setClickArea(_ area: [NSRect]) {
        clickArea = area
        guard !area.isEmpty else {
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
        let over = clickArea.contains { NSMouseInRect(NSEvent.mouseLocation, $0, false) }
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

/// Draws a block of text exactly as `DictationPill.block(_:width:maxLines:)` measured it: wrapped to the view's
/// width from its top edge, the last line that fits truncating.
private final class IslandText: NSView {
    var text: NSAttributedString? {
        didSet { needsDisplay = true }
    }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        text?.draw(with: bounds, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
    }
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
