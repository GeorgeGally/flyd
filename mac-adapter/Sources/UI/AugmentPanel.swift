import AppKit

final class AugmentPanel {
    enum FeedbackKind {
        case intervention
        case actionProposal
    }

    private var panel: NSPanel?
    private var contentLabel: NSTextField?
    private var optionButtons: [NSButton] = []
    private var feedbackButtons: [NSButton] = []
    private var autoDismissTimer: Timer?
    private var localEventMonitor: Any?
    private var clickMonitor: Any?
    private var feedbackStack: NSStackView?
    private var correctField: NSTextField?
    private var followUpField: NSTextField?

    var onOptionSelected: ((Int, String) -> Void)?
    var onAccept: (() -> Void)?
    var onReject: (() -> Void)?
    var onCorrect: ((String) -> Void)?
    var onFollowUp: ((String) -> Void)?
    var onApproveAction: (() -> Void)?
    var onCommandApprove: ((String, Int) -> Void)?
    var onCommandReject: ((String, Int) -> Void)?

    static let panelWidth: CGFloat = 400
    static let panelCornerRadius: CGFloat = 16
    static let borderInset: CGFloat = 1.5
    static let maximumVisibleContentHeight: CGFloat = 300
    private static let contentInset: CGFloat = 24
    private static let topPadding: CGFloat = 36
    private static let bottomPadding: CGFloat = 20

    struct ContentLayout {
        let naturalHeight: CGFloat
        let visibleHeight: CGFloat
        let isScrollable: Bool
    }

    static func contentLayout(content: String) -> ContentLayout {
        let naturalHeight = naturalContentHeight(content, width: panelWidth - contentInset * 2)
        let visibleHeight = min(naturalHeight, maximumVisibleContentHeight)
        return ContentLayout(
            naturalHeight: naturalHeight,
            visibleHeight: visibleHeight,
            isScrollable: naturalHeight > visibleHeight
        )
    }

    /// Pure layout measurement — no NSScreen/NSEvent calls — so show() and stackedFrames()
    /// share one source of truth and both can be exercised in tests.
    static func measure(content: String, options: [String]?) -> NSSize {
        let hasOptions = (options?.count ?? 0) > 0
        let layout = contentLayout(content: content)
        let optionHeight: CGFloat = hasOptions ? CGFloat(options!.count) * 34 + 8 : 0
        let panelHeight = layout.visibleHeight + optionHeight + topPadding + bottomPadding
        return NSSize(width: panelWidth, height: panelHeight)
    }

    /// Lays out N pre-measured panels in a vertical cascade from a single anchor point,
    /// each clamped independently to the screen's visible frame. Pure function — testable
    /// without a real NSScreen.
    static func stackedFrames(sizes: [NSSize], anchorRect: NSRect, screenVisibleFrame: NSRect, gap: CGFloat = 12) -> [NSRect] {
        var frames: [NSRect] = []
        var nextTop: CGFloat = anchorRect.midY + (sizes.first?.height ?? 0) / 2

        for size in sizes {
            var frame = NSRect(
                x: anchorRect.maxX + 12,
                y: nextTop - size.height,
                width: size.width,
                height: size.height
            )
            frame.origin.x = max(screenVisibleFrame.minX + 8, min(frame.origin.x, screenVisibleFrame.maxX - size.width - 8))
            frame.origin.y = max(screenVisibleFrame.minY + 8, min(frame.origin.y, screenVisibleFrame.maxY - size.height - 8))
            frames.append(frame)
            nextTop = frame.origin.y - gap
        }

        return frames
    }

    static func cardIsInteractive(kind: String, hasOptions: Bool) -> Bool {
        return kind == "control" || hasOptions
    }

    func show(
        content: String,
        options: [String]?,
        kind: String,
        frame panelFrame: NSRect
    ) {
        dismiss()

        let hasOptions = (options?.count ?? 0) > 0
        let panelWidth = Self.panelWidth
        let contentInset = Self.contentInset
        let textWidth = panelWidth - contentInset * 2
        let contentLayout = Self.contentLayout(content: content)
        let isInteractive = Self.cardIsInteractive(kind: kind, hasOptions: hasOptions)
            || contentLayout.isScrollable
        let optionHeight: CGFloat = hasOptions ? CGFloat(options!.count) * 34 + 8 : 0
        let panelHeight = panelFrame.height
        let bottomPadding = Self.bottomPadding

        let panel = NSPanel(
            contentRect: panelFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .ignoresCycle]
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isOpaque = false
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = isInteractive
        panel.ignoresMouseEvents = !isInteractive
        panel.alphaValue = 0

        let contentView = panel.contentView!
        contentView.wantsLayer = true
        contentView.layer?.cornerRadius = 16
        contentView.layer?.cornerCurve = .continuous
        contentView.layer?.backgroundColor = NSColor.clear.cgColor
        contentView.layer?.masksToBounds = false

        contentView.layer?.shadowColor = FlydPalette.brassGlow.withAlphaComponent(0.18).cgColor
        contentView.layer?.shadowOpacity = 1
        contentView.layer?.shadowRadius = 32
        contentView.layer?.shadowOffset = NSSize(width: 0, height: 0)

        let clipView = NSView(frame: contentView.bounds)
        clipView.wantsLayer = true
        clipView.layer?.cornerRadius = Self.panelCornerRadius
        clipView.layer?.cornerCurve = .continuous
        clipView.layer?.masksToBounds = true
        contentView.addSubview(clipView)

        let blur = NSVisualEffectView(frame: clipView.bounds)
        blur.autoresizingMask = [.width, .height]
        blur.material = .hudWindow
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.wantsLayer = true
        blur.layer?.masksToBounds = true
        clipView.addSubview(blur)

        let gradient = CAGradientLayer()
        gradient.frame = clipView.bounds
        gradient.colors = [
            FlydPalette.inkDeep.withAlphaComponent(0.82).cgColor,
            FlydPalette.ink.withAlphaComponent(0.78).cgColor,
        ]
        gradient.locations = [0, 1]
        gradient.cornerRadius = Self.panelCornerRadius
        gradient.cornerCurve = .continuous
        clipView.layer?.addSublayer(gradient)

        let border = CAGradientLayer()
        border.frame = clipView.bounds.insetBy(dx: -1, dy: -1)
        border.cornerRadius = Self.panelCornerRadius
        border.cornerCurve = .continuous
        border.colors = [
            FlydPalette.brassGlow.withAlphaComponent(0.5).cgColor,
            FlydPalette.brass.withAlphaComponent(0.15).cgColor,
        ]
        border.locations = [0, 0.6]
        border.startPoint = CGPoint(x: 0.5, y: 1)
        border.endPoint = CGPoint(x: 0.5, y: 0)

        let borderMask = CAShapeLayer()
        let borderPath = CGMutablePath()
        borderPath.addRect(border.bounds)
        let innerPath = CGMutablePath()
        innerPath.addRoundedRect(in: border.bounds.insetBy(dx: Self.borderInset, dy: Self.borderInset), cornerWidth: Self.panelCornerRadius - Self.borderInset, cornerHeight: Self.panelCornerRadius - Self.borderInset)
        borderPath.addPath(innerPath)
        borderMask.path = borderPath
        borderMask.fillRule = .evenOdd
        border.mask = borderMask
        clipView.layer?.addSublayer(border)

        let headerY = panelHeight - 26

        let eyebrow = NSTextField(labelWithString: "")
        eyebrow.attributedStringValue = FlydPalette.tracked(
            "FLYD",
            font: FlydPalette.monospace(10),
            color: FlydPalette.brass,
            tracking: 1.6
        )
        eyebrow.frame = NSRect(x: contentInset, y: headerY, width: 100, height: 14)
        clipView.addSubview(eyebrow)

        if isInteractive {
            let closeButton = NSButton(frame: NSRect(x: panelWidth - 28, y: headerY, width: 14, height: 14))
            closeButton.title = ""
            closeButton.bezelStyle = .circular
            closeButton.isBordered = false
            closeButton.wantsLayer = true
            closeButton.layer?.cornerRadius = 7
            closeButton.layer?.backgroundColor = FlydPalette.paper.withAlphaComponent(0.10).cgColor
            let closeAttr: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 9, weight: .bold),
                .foregroundColor: FlydPalette.paper.withAlphaComponent(0.6)
            ]
            closeButton.attributedTitle = NSAttributedString(string: "✕", attributes: closeAttr)
            closeButton.target = self
            closeButton.action = #selector(closeClicked)
            clipView.addSubview(closeButton)
        }

        let label = NSTextField(wrappingLabelWithString: "")
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = 4
        label.attributedStringValue = NSAttributedString(
            string: content,
            attributes: [
                .font: NSFont.systemFont(ofSize: 14),
                .foregroundColor: FlydPalette.paper.withAlphaComponent(0.88),
                .paragraphStyle: paragraphStyle,
            ]
        )
        label.backgroundColor = .clear
        label.isBordered = false
        label.frame = NSRect(x: 0, y: 0, width: textWidth, height: contentLayout.naturalHeight)
        if contentLayout.isScrollable {
            let scrollView = NSScrollView(
                frame: NSRect(
                    x: contentInset,
                    y: bottomPadding + optionHeight,
                    width: textWidth,
                    height: contentLayout.visibleHeight
                )
            )
            scrollView.drawsBackground = false
            scrollView.borderType = .noBorder
            scrollView.hasVerticalScroller = true
            scrollView.autohidesScrollers = true
            scrollView.scrollerStyle = .overlay

            let documentView = FlippedDocumentView(
                frame: NSRect(x: 0, y: 0, width: textWidth, height: contentLayout.naturalHeight)
            )
            documentView.addSubview(label)
            scrollView.documentView = documentView
            clipView.addSubview(scrollView)
        } else {
            label.frame.origin = NSPoint(x: contentInset, y: bottomPadding + optionHeight)
            clipView.addSubview(label)
        }
        contentLabel = label

        if let options {
            for (index, option) in options.enumerated() {
                let y = optionHeight - 4 - CGFloat(index) * 34
                let button = FlydOptionButton(frame: NSRect(x: contentInset, y: y, width: textWidth, height: 24))
                button.setTitle(option)
                button.target = self
                button.action = #selector(optionClicked(_:))
                button.tag = index
                clipView.addSubview(button)
                optionButtons.append(button)
            }
        }

        localEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 {
                self?.dismiss()
                return nil
            }
            return event
        }

        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] _ in
            self?.dismiss()
        }

        autoDismissTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
            self?.dismiss()
        }

        panel.orderFront(nil)
        self.panel = panel

        if !FlydPalette.reduceMotion {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.35
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().alphaValue = 1

                let scale = CATransform3DMakeScale(1.02, 1.02, 1)
                clipView.layer?.transform = scale
                clipView.layer?.animate(key: "transform", to: CATransform3DIdentity, duration: 0.35)
            }
        } else {
            panel.alphaValue = 1
        }
    }

    func showWorkIntervention(
        content: String,
        diagnosis: String,
        strongerAlternative: String?,
        options: [String]?,
        feedbackKind: FeedbackKind,
        frame panelFrame: NSRect
    ) {
        var fullContent = content
        if let alternative = strongerAlternative, !alternative.isEmpty {
            fullContent += "\n\nAlternative: \(alternative)"
        }

        var interventionOptions = options
        switch feedbackKind {
        case .intervention:
            interventionOptions = (options ?? []) + ["Correct", "Follow-up"]
        case .actionProposal:
            interventionOptions = (options ?? []) + ["Approve Action"]
        }

        show(
            content: fullContent,
            options: interventionOptions,
            kind: "control",
            frame: panelFrame
        )
    }

    func dismiss() {
        autoDismissTimer?.invalidate()
        autoDismissTimer = nil
        if let monitor = localEventMonitor {
            NSEvent.removeMonitor(monitor)
            localEventMonitor = nil
        }
        if clickMonitor != nil {
            NSEvent.removeMonitor(clickMonitor! as Any)
            clickMonitor = nil
        }
        panel?.orderOut(nil)
        panel = nil
        contentLabel = nil
        optionButtons.removeAll()
        feedbackButtons.removeAll()
        feedbackStack = nil
        correctField = nil
        followUpField = nil
    }

    func showExecutionCard(
        diagnosis: String,
        intervention: String,
        commands: [(id: String, command: String, workingDirectory: String, explanation: String, isDestructive: Bool)],
        frame panelFrame: NSRect
    ) {
        var content = "\(diagnosis)\n\n\(intervention)"
        for (i, cmd) in commands.enumerated() {
            let label = cmd.isDestructive ? "[Modifies files/system] " : ""
            content += "\n\n--- Command \(i + 1) ---"
            content += "\n\(label)$ \(cmd.command)"
            content += "\nin \(cmd.workingDirectory)"
            if !cmd.explanation.isEmpty {
                content += "\n\(cmd.explanation)"
            }
        }

        var optionLabels = commands.enumerated().map { i, cmd in
            "Approve: \(cmd.command.prefix(60))\(cmd.command.count > 60 ? "…" : "")"
        }
        optionLabels.append("Reject All")

        show(
            content: content,
            options: optionLabels,
            kind: "control",
            frame: panelFrame
        )
    }

    @objc private func closeClicked() {
        dismiss()
    }

    @objc private func optionClicked(_ sender: NSButton) {
        let index = sender.tag
        let value = sender.title
        onOptionSelected?(index, value)
        dismiss()
    }

    /// Measures with a real wrapping-label cell rather than NSString.boundingRect — the two
    /// disagree on where words break, and boundingRect reliably undercounts by a line,
    /// clipping the last line of longer messages.
    private static func naturalContentHeight(_ text: String, width: CGFloat) -> CGFloat {
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = 4
        let measuring = NSTextField(wrappingLabelWithString: "")
        measuring.attributedStringValue = NSAttributedString(
            string: text,
            attributes: [
                .font: NSFont.systemFont(ofSize: 14),
                .paragraphStyle: paragraphStyle,
            ]
        )
        let size = measuring.cell!.cellSize(forBounds: NSRect(x: 0, y: 0, width: width, height: .greatestFiniteMagnitude))
        return ceil(size.height)
    }
}

private final class FlippedDocumentView: NSView {
    override var isFlipped: Bool { true }
}

private extension CALayer {
    func animate(key: String, to toValue: Any, duration: CFTimeInterval) {
        let anim = CABasicAnimation(keyPath: key)
        anim.fromValue = presentation()?.value(forKey: key) ?? value(forKey: key)
        anim.toValue = toValue
        anim.duration = duration
        anim.timingFunction = CAMediaTimingFunction(name: .easeOut)
        anim.fillMode = .backwards
        add(anim, forKey: key)
        setValue(toValue, forKey: key)
    }
}

/// A pill-shaped option button styled to belong to the ink/paper/brass surface it sits on,
/// rather than a stock light-gray AppKit bezel dropped onto a dark HUD.
private final class FlydOptionButton: NSButton {
    private var trackingArea: NSTrackingArea?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        isBordered = false
        bezelStyle = .regularSquare
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.cornerCurve = .continuous
        layer?.borderWidth = 1
        applyBackground(hovering: false)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setTitle(_ text: String) {
        attributedTitle = NSAttributedString(string: text, attributes: [
            .font: NSFont.systemFont(ofSize: 12, weight: .medium),
            .foregroundColor: FlydPalette.paper.withAlphaComponent(0.92)
        ])
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea { removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow], owner: self, userInfo: nil)
        addTrackingArea(area)
        trackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        applyBackground(hovering: true)
    }

    override func mouseExited(with event: NSEvent) {
        applyBackground(hovering: false)
    }

    private func applyBackground(hovering: Bool) {
        layer?.backgroundColor = FlydPalette.paper.withAlphaComponent(hovering ? 0.14 : 0.07).cgColor
        layer?.borderColor = FlydPalette.line.cgColor
    }
}

func showAugmentations(
    invocationId: String,
    resolution: FlydClient.ResolutionResponse,
    fingerprint: InvocationFingerprint
) async {
    guard let augmentations = resolution.augmentations, !augmentations.isEmpty else { return }

    await MainActor.run {
        activeAugmentPanels.forEach { $0.dismiss() }
        activeAugmentPanels.removeAll()

        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.screens.first else { return }

        let sizes = augmentations.map { AugmentPanel.measure(content: $0.content, options: $0.options) }
        let totalHeight = sizes.map(\.height).reduce(0, +) + CGFloat(sizes.count - 1) * 12

        let visibleFrame = screen.visibleFrame
        let centerX = visibleFrame.midX
        let centerY = visibleFrame.midY + totalHeight / 2

        let anchor = NSRect(x: centerX - AugmentPanel.panelWidth / 2 - 12, y: centerY, width: 0, height: 0)
        let frames = AugmentPanel.stackedFrames(sizes: sizes, anchorRect: anchor, screenVisibleFrame: visibleFrame)

        activeAugmentPanels = zip(augmentations, frames).map { augmentation, frame in
            let augmentPanel = AugmentPanel()
            augmentPanel.onOptionSelected = { index, value in
                print("[Flyd] Augment option selected: \(index) — \(value)")
                Task {
                    await FlydClient.shared.sendOutcome(
                        resolutionId: resolution.resolutionId,
                        invocationId: invocationId,
                        status: "succeeded",
                        correction: "user selected augment option: \(value)"
                    )
                }
            }
            augmentPanel.show(
                content: augmentation.content,
                options: augmentation.options,
                kind: augmentation.kind,
                frame: frame
            )
            return augmentPanel
        }
    }
}
