import AppKit

final class AugmentPanel {
    private var panel: NSPanel?
    private var contentLabel: NSTextField?
    private var optionButtons: [NSButton] = []
    private var autoDismissTimer: Timer?
    private var localEventMonitor: Any?
    private var clickMonitor: Any?

    var onOptionSelected: ((Int, String) -> Void)?

    static let panelWidth: CGFloat = 360
    private static let contentInset: CGFloat = 24
    private static let topPadding: CGFloat = 36
    private static let bottomPadding: CGFloat = 20

    /// Pure layout measurement — no NSScreen/NSEvent calls — so show() and stackedFrames()
    /// share one source of truth and both can be exercised in tests.
    static func measure(content: String, options: [String]?) -> NSSize {
        let hasOptions = (options?.count ?? 0) > 0
        let textWidth = panelWidth - contentInset * 2
        let labelHeight = contentHeight(content, width: textWidth)
        let optionHeight: CGFloat = hasOptions ? CGFloat(options!.count) * 34 + 8 : 0
        let panelHeight = labelHeight + optionHeight + topPadding + bottomPadding
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

    func show(
        content: String,
        options: [String]?,
        kind: String,
        frame panelFrame: NSRect
    ) {
        dismiss()

        let hasOptions = (options?.count ?? 0) > 0
        let isInteractive = kind == "control" || hasOptions
        let panelWidth = Self.panelWidth
        let contentInset = Self.contentInset
        let textWidth = panelWidth - contentInset * 2
        let labelHeight = Self.contentHeight(content, width: textWidth)
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
        panel.hasShadow = true
        panel.isOpaque = false
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = true
        panel.ignoresMouseEvents = !isInteractive

        let contentView = panel.contentView!
        contentView.wantsLayer = true
        contentView.layer?.cornerRadius = 16
        contentView.layer?.cornerCurve = .continuous
        contentView.layer?.backgroundColor = NSColor.clear.cgColor
        contentView.layer?.shadowColor = NSColor.black.cgColor
        contentView.layer?.shadowOpacity = 0.4
        contentView.layer?.shadowRadius = 20
        contentView.layer?.shadowOffset = NSSize(width: 0, height: -8)
        contentView.layer?.masksToBounds = false

        let blur = NSVisualEffectView(frame: contentView.bounds)
        blur.autoresizingMask = [.width, .height]
        blur.material = .hudWindow
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.wantsLayer = true
        blur.layer?.cornerRadius = 16
        blur.layer?.cornerCurve = .continuous
        blur.layer?.masksToBounds = true
        contentView.addSubview(blur)

        let tint = NSView(frame: contentView.bounds)
        tint.autoresizingMask = [.width, .height]
        tint.wantsLayer = true
        tint.layer?.cornerRadius = 16
        tint.layer?.cornerCurve = .continuous
        tint.layer?.backgroundColor = FlydPalette.ink.withAlphaComponent(0.72).cgColor
        contentView.addSubview(tint)

        let hairline = NSView(frame: contentView.bounds)
        hairline.autoresizingMask = [.width, .height]
        hairline.wantsLayer = true
        hairline.layer?.cornerRadius = 16
        hairline.layer?.cornerCurve = .continuous
        hairline.layer?.borderWidth = 1
        hairline.layer?.borderColor = FlydPalette.line.cgColor
        contentView.addSubview(hairline)

        let headerY = panelHeight - 26

        let eyebrow = NSTextField(labelWithString: "")
        eyebrow.attributedStringValue = FlydPalette.tracked(
            "FLYD",
            font: FlydPalette.monospace(10),
            color: FlydPalette.brass,
            tracking: 1.6
        )
        eyebrow.frame = NSRect(x: contentInset, y: headerY, width: 100, height: 14)
        contentView.addSubview(eyebrow)

        // Non-interactive (click-through) cards omit the close button entirely — a prior
        // attempt left it in place while ignoresMouseEvents=true, which makes the whole
        // window transparent at the window-server level, so the button was visible but dead.
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
            contentView.addSubview(closeButton)
        }

        let label = NSTextField(wrappingLabelWithString: content)
        label.font = .systemFont(ofSize: 13)
        label.textColor = FlydPalette.paper.withAlphaComponent(0.88)
        label.backgroundColor = .clear
        label.isBordered = false
        label.frame = NSRect(x: contentInset, y: bottomPadding + optionHeight, width: textWidth, height: labelHeight)
        contentView.addSubview(label)
        contentLabel = label

        if let options {
            for (index, option) in options.enumerated() {
                let y = optionHeight - 4 - CGFloat(index) * 34
                let button = FlydOptionButton(frame: NSRect(x: contentInset, y: y, width: textWidth, height: 24))
                button.setTitle(option)
                button.target = self
                button.action = #selector(optionClicked(_:))
                button.tag = index
                contentView.addSubview(button)
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
    }

    func dismiss() {
        autoDismissTimer?.invalidate()
        autoDismissTimer = nil
        if let monitor = localEventMonitor {
            NSEvent.removeMonitor(monitor)
            localEventMonitor = nil
        }
        if let monitor = clickMonitor {
            NSEvent.removeMonitor(monitor)
            clickMonitor = nil
        }
        panel?.orderOut(nil)
        panel = nil
        contentLabel = nil
        optionButtons.removeAll()
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
    private static func contentHeight(_ text: String, width: CGFloat) -> CGFloat {
        let measuring = NSTextField(wrappingLabelWithString: text)
        measuring.font = .systemFont(ofSize: 13)
        let size = measuring.cell!.cellSize(forBounds: NSRect(x: 0, y: 0, width: width, height: .greatestFiniteMagnitude))
        return min(ceil(size.height), 300)
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

        guard let screen = NSScreen.main else { return }

        let mouse = NSEvent.mouseLocation
        let anchor = NSRect(x: mouse.x, y: mouse.y, width: 0, height: 0)
        let sizes = augmentations.map { AugmentPanel.measure(content: $0.content, options: $0.options) }
        let frames = AugmentPanel.stackedFrames(sizes: sizes, anchorRect: anchor, screenVisibleFrame: screen.visibleFrame)

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
