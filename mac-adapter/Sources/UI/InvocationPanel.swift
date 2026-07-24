import AppKit

final class InvocationPanel {
    enum State {
        case textInput
        case recording
        case transcribing
        case listening
        case processing
        case resolving
        case executing
        case error(message: String)
    }

    private var panel: NSPanel?
    private var textField: NSTextField?
    private var titleLabel: NSTextField?
    private var promptLabel: NSTextField?
    private var localEventMonitor: Any?
    private var currentState: State = .textInput

    var onIntentSubmitted: ((String) -> Void)?
    var onCancelled: (() -> Void)?

    func show() {
        if let panel {
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
            if case .textInput = currentState {
                panel.makeFirstResponder(textField)
            }
            return
        }

        let panelSize = NSSize(width: 560, height: 132)
        let panelFrame = commandPanelFrame(size: panelSize)

        let panel = FocusablePanel(
            contentRect: panelFrame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .ignoresCycle]
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isOpaque = false
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        buildContent(in: panel.contentView!, panel: panel)

        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        panel.makeFirstResponder(textField)

        self.panel = panel
        self.currentState = .textInput

        localEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 {
                self?.handleEscape()
                return nil
            }
            return event
        }
    }

    private func commandPanelFrame(size: NSSize) -> NSRect {
        let screenFrame = NSScreen.main?.visibleFrame ?? .zero

        let margin: CGFloat = 20
        let preferredX = screenFrame.midX - size.width / 2
        let preferredY = screenFrame.minY + 64
        let x = min(max(preferredX, screenFrame.minX + margin), screenFrame.maxX - size.width - margin)
        let y = min(max(preferredY, screenFrame.minY + margin), screenFrame.maxY - size.height - margin)

        return NSRect(origin: NSPoint(x: x, y: y), size: size)
    }

    func updateState(_ state: State) {
        currentState = state
        guard let label = promptLabel else { return }

        switch state {
        case .textInput:
            titleLabel?.stringValue = "Ask Flyd"
            label.stringValue = "Type an instruction and press Return"
            label.textColor = NSColor.white.withAlphaComponent(0.7)
            textField?.isHidden = false
            textField?.isEditable = true
            textField?.placeholderString = "summarize this page in one sentence"
            panel?.makeFirstResponder(textField)
        case .recording:
            titleLabel?.stringValue = "Recording"
            label.stringValue = "Speak now..."
            label.textColor = .systemBlue
            textField?.isHidden = true
            textField?.isEditable = false
        case .transcribing:
            titleLabel?.stringValue = "Transcribing"
            label.stringValue = "Converting speech to text..."
            label.textColor = .systemBlue
            textField?.isEditable = false
        case .listening:
            titleLabel?.stringValue = "Listening"
            label.stringValue = "Say what you want Flyd to do, then release"
            label.textColor = .systemBlue
            textField?.isHidden = false
            textField?.isEditable = false
            textField?.placeholderString = "say: summarize this page in one sentence"
        case .processing, .resolving:
            titleLabel?.stringValue = "Working"
            label.stringValue = "Thinking..."
            label.textColor = NSColor.white.withAlphaComponent(0.7)
            textField?.isEditable = false
        case .executing:
            titleLabel?.stringValue = "Done"
            label.stringValue = ""
            label.textColor = .systemGreen
            textField?.isEditable = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard case .executing = self?.currentState else { return }
                self?.dismiss()
            }
        case .error(let message):
            titleLabel?.stringValue = "Flyd needs attention"
            label.stringValue = message
            label.textColor = .systemRed
            textField?.isEditable = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                if case .error = self?.currentState {
                    self?.cancel()
                }
            }
        }
    }

    var currentIntent: String {
        textField?.stringValue ?? ""
    }

    func fillIntent(_ text: String) {
        textField?.stringValue = text
    }

    private func buildContent(in view: NSView, panel: NSPanel) {
        view.wantsLayer = true
        view.layer?.cornerRadius = 14
        view.layer?.cornerCurve = .continuous
        view.layer?.backgroundColor = NSColor.clear.cgColor
        view.layer?.borderWidth = 1
        view.layer?.borderColor = NSColor.white.withAlphaComponent(0.34).cgColor
        view.layer?.shadowColor = NSColor.black.cgColor
        view.layer?.shadowOpacity = 0.22
        view.layer?.shadowRadius = 22
        view.layer?.shadowOffset = NSSize(width: 0, height: -10)
        view.layer?.masksToBounds = false

        let glass = NSVisualEffectView(frame: view.bounds)
        glass.autoresizingMask = [.width, .height]
        glass.material = .hudWindow
        glass.blendingMode = .behindWindow
        glass.state = .active
        glass.isEmphasized = true
        glass.appearance = NSAppearance(named: .vibrantDark)
        glass.wantsLayer = true
        glass.layer?.cornerRadius = 14
        glass.layer?.cornerCurve = .continuous
        glass.layer?.masksToBounds = true
        view.addSubview(glass)

        let tint = NSView(frame: view.bounds)
        tint.autoresizingMask = [.width, .height]
        tint.wantsLayer = true
        tint.layer?.cornerRadius = 14
        tint.layer?.cornerCurve = .continuous
        tint.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.08).cgColor
        view.addSubview(tint)

        let hairline = NSView(frame: view.bounds)
        hairline.autoresizingMask = [.width, .height]
        hairline.wantsLayer = true
        hairline.layer?.cornerRadius = 14
        hairline.layer?.cornerCurve = .continuous
        hairline.layer?.borderWidth = 1
        hairline.layer?.borderColor = NSColor.white.withAlphaComponent(0.42).cgColor
        view.addSubview(hairline)

        let title = NSTextField(labelWithString: "Ask Flyd")
        title.font = .systemFont(ofSize: 16, weight: .semibold)
        title.textColor = .white
        title.frame = NSRect(x: 22, y: 92, width: 128, height: 22)
        view.addSubview(title)
        titleLabel = title

        let label = NSTextField(labelWithString: "Type an instruction and press Return")
        label.font = .systemFont(ofSize: 13)
        label.textColor = NSColor.white.withAlphaComponent(0.7)
        label.frame = NSRect(x: 152, y: 92, width: 386, height: 22)
        view.addSubview(label)
        promptLabel = label

        let fieldBackground = NSView(frame: NSRect(x: 22, y: 22, width: 516, height: 52))
        fieldBackground.wantsLayer = true
        fieldBackground.layer?.cornerRadius = 11
        fieldBackground.layer?.cornerCurve = .continuous
        fieldBackground.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.10).cgColor
        fieldBackground.layer?.borderWidth = 1
        fieldBackground.layer?.borderColor = NSColor.white.withAlphaComponent(0.36).cgColor
        view.addSubview(fieldBackground)

        let field = NSTextField(frame: NSRect(x: 38, y: 36, width: 484, height: 24))
        field.isBordered = false
        field.backgroundColor = .clear
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 16)
        field.textColor = .white
        field.placeholderString = "summarize this page in one sentence"
        field.target = self
        field.action = #selector(textFieldAction)
        view.addSubview(field)
        textField = field
        field.becomeFirstResponder()
    }

    func dismiss() {
        if let monitor = localEventMonitor {
            NSEvent.removeMonitor(monitor)
            localEventMonitor = nil
        }
        textField?.resignFirstResponder()
        panel?.orderOut(nil)
        panel = nil
        textField = nil
        titleLabel = nil
        promptLabel = nil
    }

    private func handleEscape() {
        cancel()
    }

    private func cancel() {
        if let monitor = localEventMonitor {
            NSEvent.removeMonitor(monitor)
            localEventMonitor = nil
        }
        onCancelled?()
        dismiss()
    }

    @objc private func textFieldAction() {
        guard let text = textField?.stringValue, !text.trimmingCharacters(in: .whitespaces).isEmpty else {
            cancel()
            return
        }
        if let monitor = localEventMonitor {
            NSEvent.removeMonitor(monitor)
            localEventMonitor = nil
        }
        onIntentSubmitted?(text)
    }
}

private final class FocusablePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
