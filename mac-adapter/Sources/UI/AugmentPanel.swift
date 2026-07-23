import AppKit

final class AugmentPanel {
    private var panel: NSPanel?
    private var contentLabel: NSTextField?
    private var optionButtons: [NSButton] = []
    private var autoDismissTimer: Timer?

    var onOptionSelected: ((Int, String) -> Void)?

    func show(
        content: String,
        options: [String]?,
        placement: String,
        beside rect: NSRect? = nil
    ) {
        dismiss()

        let hasOptions = (options?.count ?? 0) > 0
        let panelWidth: CGFloat = 320
        let labelHeight = contentHeight(content, width: panelWidth - 24)
        let optionHeight: CGFloat = hasOptions ? CGFloat(options!.count) * 30 + 8 : 0
        let panelHeight: CGFloat = labelHeight + optionHeight + 24

        var panelFrame: NSRect
        if let rect = rect {
            panelFrame = NSRect(
                x: rect.maxX + 12,
                y: rect.midY - panelHeight / 2,
                width: panelWidth,
                height: panelHeight
            )
        } else if let mouseLocation = NSEvent.mouseLocation as NSPoint? {
            panelFrame = NSRect(
                x: mouseLocation.x + 24,
                y: mouseLocation.y - panelHeight - 8,
                width: panelWidth,
                height: panelHeight
            )
        } else {
            guard let screen = NSScreen.main else { return }
            panelFrame = NSRect(
                x: screen.frame.midX - panelWidth / 2,
                y: screen.frame.midY - panelHeight / 2,
                width: panelWidth,
                height: panelHeight
            )
        }

        let panel = NSPanel(
            contentRect: panelFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .ignoresCycle]
        panel.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.95)
        panel.hasShadow = true
        panel.isOpaque = false
        panel.isReleasedWhenClosed = false
        panel.ignoresMouseEvents = !hasOptions

        let contentView = panel.contentView!
        contentView.wantsLayer = true
        contentView.layer?.cornerRadius = 10

        let label = NSTextField(wrappingLabelWithString: content)
        label.font = .systemFont(ofSize: 12)
        label.textColor = .labelColor
        label.frame = NSRect(x: 12, y: optionHeight + 4, width: panelWidth - 24, height: labelHeight)
        contentView.addSubview(label)
        contentLabel = label

        if let options {
            for (index, option) in options.enumerated() {
                let y = optionHeight - 4 - CGFloat(index) * 30
                let button = NSButton(
                    frame: NSRect(x: 12, y: y, width: panelWidth - 24, height: 24)
                )
                button.title = option
                button.bezelStyle = .rounded
                button.controlSize = .small
                button.target = self
                button.action = #selector(optionClicked(_:))
                button.tag = index
                contentView.addSubview(button)
                optionButtons.append(button)
            }
        }

        if !hasOptions {
            autoDismissTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
                self?.dismiss()
            }
        }

        panel.orderFront(nil)
        self.panel = panel
    }

    func dismiss() {
        autoDismissTimer?.invalidate()
        autoDismissTimer = nil
        panel?.orderOut(nil)
        panel = nil
        contentLabel = nil
        optionButtons.removeAll()
    }

    @objc private func optionClicked(_ sender: NSButton) {
        let index = sender.tag
        let value = sender.title
        onOptionSelected?(index, value)
        dismiss()
    }

    private func contentHeight(_ text: String, width: CGFloat) -> CGFloat {
        let size = (text as NSString).boundingRect(
            with: NSSize(width: width, height: 2000),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: NSFont.systemFont(ofSize: 12)]
        )
        return min(size.height, 200)
    }
}

func showAugmentations(
    invocationId: String,
    resolution: FlydClient.ResolutionResponse,
    fingerprint: InvocationFingerprint
) async {
    guard let augmentations = resolution.augmentations, !augmentations.isEmpty else { return }

    await MainActor.run {
        let augmentPanel = AugmentPanel()
        let placement = NSRect(
            x: NSEvent.mouseLocation.x,
            y: NSEvent.mouseLocation.y,
            width: 0,
            height: 0
        )

        augmentPanel.onOptionSelected = { index, value in
            print("[Flyd] Augment option selected: \(index) — \(value)")
            Task {
                await flydClient.sendOutcome(
                    resolutionId: resolution.resolutionId,
                    invocationId: invocationId,
                    status: "succeeded",
                    correction: "user selected augment option: \(value)"
                )
            }
        }

        for augmentation in augmentations {
            augmentPanel.show(
                content: augmentation.content,
                options: augmentation.options,
                placement: augmentation.placement,
                beside: placement
            )
        }
    }
}
