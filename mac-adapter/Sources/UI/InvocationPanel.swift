import AppKit

final class InvocationPanel {
    enum State {
        case textInput
        case recording
        case transcribing
        case listening
        case processing
        case resolving
        case executing(operationCount: Int, preview: String)
        case undoAvailable(invocationId: String, preview: String)
        case error(message: String)
        case workSession(diagnosis: String, pendingAction: String?)
    }

    private var panel: NSPanel?
    private var textField: NSTextField?
    private var inputBackground: NSView?
    private var voiceActivityView: NSView?
    private var voiceMicDot: NSView?
    private var voiceBars: [NSView] = []
    private var titleLabel: NSTextField?
    private var promptLabel: NSTextField?
    private var statusDot: FlydStatusDot?
    private var localEventMonitor: Any?
    private var currentState: State = .textInput
    private var latestVoiceLevel: CGFloat = 0
    private var latestVoiceSpectrum: [Float] = []

    var onIntentSubmitted: ((String) -> Void)?
    var onCancelled: (() -> Void)?
    var onUndoRequested: ((String) -> Void)?

    func show() {
        if let panel {
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
            if case .textInput = currentState {
                panel.makeFirstResponder(textField)
            }
            return
        }

        let panelSize = NSSize(width: 390, height: 82)
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
            if event.keyCode == 6, event.modifierFlags.contains(.command),
               case .undoAvailable(let invocationId, _) = self?.currentState {
                self?.onUndoRequested?(invocationId)
                self?.dismiss()
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
        let wasVoiceSurface = textField?.isHidden ?? false
        currentState = state
        guard let label = promptLabel else { return }

        switch state {
        case .textInput:
            showTextSurface(true)
            showVoiceSurface(false, level: 0)
            titleLabel?.stringValue = "Ask Flyd"
            label.stringValue = "Return"
            label.textColor = FlydPalette.paper.withAlphaComponent(0.6)
            statusDot?.set(color: FlydPalette.brass, pulsing: false)
            textField?.isEditable = true
            textField?.placeholderString = "summarize this page in one sentence"
            panel?.makeFirstResponder(textField)
        case .recording:
            showTextSurface(false)
            showVoiceSurface(true, level: 1)
            titleLabel?.stringValue = "Listening"
            label.stringValue = "Release to stop"
            label.textColor = FlydPalette.listenBlue
            statusDot?.set(color: FlydPalette.listenBlue, pulsing: true)
            textField?.isEditable = false
        case .transcribing:
            showTextSurface(false)
            showVoiceSurface(true, level: 0.55)
            titleLabel?.stringValue = "Transcribing"
            label.stringValue = ""
            label.textColor = FlydPalette.brass
            statusDot?.set(color: FlydPalette.brass, pulsing: true)
            textField?.isEditable = false
        case .listening:
            showTextSurface(false)
            showVoiceSurface(true, level: 0.8)
            titleLabel?.stringValue = "Listening"
            label.stringValue = "Release to stop"
            label.textColor = FlydPalette.listenBlue
            statusDot?.set(color: FlydPalette.listenBlue, pulsing: true)
            textField?.isEditable = false
            textField?.placeholderString = "say: summarize this page in one sentence"
        case .processing, .resolving:
            showTextSurface(!wasVoiceSurface)
            showVoiceSurface(wasVoiceSurface, level: 0.45)
            titleLabel?.stringValue = "Thinking"
            label.stringValue = ""
            label.textColor = FlydPalette.paper.withAlphaComponent(0.6)
            statusDot?.set(color: FlydPalette.brass, pulsing: true)
            textField?.isEditable = false
        case .executing(let count, let preview):
            showTextSurface(!wasVoiceSurface)
            showVoiceSurface(wasVoiceSurface, level: 0.2)
            titleLabel?.stringValue = "Done"
            label.stringValue = preview.isEmpty ? "\(count) operation(s) executed" : preview
            label.textColor = FlydPalette.signalGreen
            statusDot?.set(color: FlydPalette.signalGreen, pulsing: false)
            textField?.isEditable = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard case .executing = self?.currentState else { return }
                self?.dismiss()
            }
        case .undoAvailable(_, let preview):
            showTextSurface(!wasVoiceSurface)
            showVoiceSurface(wasVoiceSurface, level: 0.2)
            titleLabel?.stringValue = "Done"
            label.stringValue = preview.isEmpty ? "⌘Z to undo" : "\(preview) — ⌘Z to undo"
            label.textColor = FlydPalette.signalGreen
            statusDot?.set(color: FlydPalette.signalGreen, pulsing: false)
            textField?.isEditable = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                guard case .undoAvailable = self?.currentState else { return }
                self?.dismiss()
            }
        case .error(let message):
            titleLabel?.stringValue = "Flyd needs attention"
            label.textColor = FlydPalette.signalRust
            statusDot?.set(color: FlydPalette.signalRust, pulsing: false)
            textField?.isEditable = false
            layoutErrorMessage(message)
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
                if case .error = self?.currentState {
                    self?.cancel()
                }
            }
        case .workSession(let diagnosis, let pendingAction):
            showTextSurface(true)
            showVoiceSurface(false, level: 0)
            titleLabel?.stringValue = "Work Session"
            let actionText = pendingAction.map { " — Pending: \($0)" } ?? ""
            label.stringValue = "\(diagnosis)\(actionText)"
            label.textColor = FlydPalette.brass
            statusDot?.set(color: FlydPalette.brass, pulsing: true)
            textField?.isEditable = true
            textField?.placeholderString = "follow up on this..."
            panel?.makeFirstResponder(textField)
        }
    }

    /// Error text is often a full sentence, not a two-word status. The default single-line,
    /// right-aligned status slot truncates nothing (NSTextField labels don't clip to their
    /// frame) — long messages just overflow straight through the title. Stack title above a
    /// wrapping message instead, and grow the panel upward to fit it.
    private func layoutErrorMessage(_ message: String) {
        guard let panel, let title = titleLabel, let dot = statusDot, let label = promptLabel else { return }
        showTextSurface(false)
        showVoiceSurface(false, level: 0)

        let panelWidth: CGFloat = 390
        let contentInset: CGFloat = 22
        let textWidth = panelWidth - contentInset * 2
        let topMargin: CGFloat = 14
        let titleHeight: CGFloat = 20
        let messageGap: CGFloat = 10
        let bottomMargin: CGFloat = 18
        let messageFont = NSFont.systemFont(ofSize: 13, weight: .medium)

        label.stringValue = message
        label.maximumNumberOfLines = 0
        label.lineBreakMode = .byWordWrapping
        label.alignment = .left
        label.font = messageFont

        let messageHeight = min(wrappedHeight(message, width: textWidth, font: messageFont), 200)
        let panelHeight = topMargin + titleHeight + messageGap + messageHeight + bottomMargin
        let titleY = panelHeight - topMargin - titleHeight

        title.frame = NSRect(x: 38, y: titleY, width: panelWidth - 38 - contentInset, height: titleHeight)
        dot.setFrameOrigin(NSPoint(x: 22, y: titleY + 7))
        label.frame = NSRect(x: contentInset, y: bottomMargin, width: textWidth, height: messageHeight)

        var frame = panel.frame
        let bottomY = frame.origin.y
        frame.size.height = panelHeight
        frame.origin.y = bottomY
        let screenFrame = NSScreen.main?.visibleFrame ?? .zero
        frame.origin.y = min(frame.origin.y, screenFrame.maxY - panelHeight - 20)
        panel.setFrame(frame, display: true, animate: false)
    }

    private func wrappedHeight(_ text: String, width: CGFloat, font: NSFont) -> CGFloat {
        let size = (text as NSString).boundingRect(
            with: NSSize(width: width, height: 2000),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font]
        )
        return ceil(size.height)
    }

    private func showTextSurface(_ isVisible: Bool) {
        inputBackground?.isHidden = !isVisible
        textField?.isHidden = !isVisible
    }

    private func showVoiceSurface(_ isVisible: Bool, level: CGFloat) {
        voiceActivityView?.isHidden = !isVisible
        if !isVisible {
            latestVoiceLevel = 0
            latestVoiceSpectrum = []
        }
        voiceMicDot?.layer?.backgroundColor = FlydPalette.listenBlue
            .withAlphaComponent(isVisible ? max(0.35, level) : 0)
            .cgColor
        applyVoiceBars(isVisible: isVisible)
    }

    func updateVoiceLevel(_ level: Float) {
        latestVoiceLevel = CGFloat(max(0, min(1, level)))
        let isVisible = !(voiceActivityView?.isHidden ?? true)
        voiceMicDot?.layer?.backgroundColor = FlydPalette.listenBlue
            .withAlphaComponent(isVisible ? max(0.35, latestVoiceLevel) : 0)
            .cgColor
        applyVoiceBars(isVisible: isVisible)
    }

    func updateVoiceSpectrum(_ bands: [Float]) {
        latestVoiceSpectrum = bands
        applyVoiceBars(isVisible: !(voiceActivityView?.isHidden ?? true))
    }

    private func applyVoiceBars(isVisible: Bool) {
        for (index, bar) in voiceBars.enumerated() {
            let bandValue: CGFloat
            if latestVoiceSpectrum.isEmpty {
                bandValue = 0
            } else {
                let sourceIndex = min(
                    latestVoiceSpectrum.count - 1,
                    Int((Double(index) / Double(max(voiceBars.count - 1, 1))) * Double(latestVoiceSpectrum.count - 1))
                )
                bandValue = CGFloat(max(0, min(1, latestVoiceSpectrum[sourceIndex])))
            }

            let activity = max(0.015, min(1, bandValue))
            let height = 3 + activity * 25
            var frame = bar.frame
            frame.size.height = height
            frame.origin.y = 18 - height / 2
            bar.frame = frame
            bar.layer?.backgroundColor = FlydPalette.listenBlue
                .withAlphaComponent(isVisible ? max(0.24, 0.30 + activity * 0.62) : 0)
                .cgColor
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
        view.layer?.cornerRadius = 16
        view.layer?.cornerCurve = .continuous
        view.layer?.masksToBounds = false
        view.layer?.shadowColor = NSColor.black.cgColor
        view.layer?.shadowOpacity = 0.4
        view.layer?.shadowRadius = 20
        view.layer?.shadowOffset = NSSize(width: 0, height: -6)

        let blur = NSVisualEffectView(frame: view.bounds)
        blur.autoresizingMask = [.width, .height]
        blur.material = .hudWindow
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.wantsLayer = true
        blur.layer?.cornerRadius = 16
        blur.layer?.cornerCurve = .continuous
        blur.layer?.masksToBounds = true
        view.addSubview(blur)

        let tint = NSView(frame: view.bounds)
        tint.autoresizingMask = [.width, .height]
        tint.wantsLayer = true
        tint.layer?.cornerRadius = 16
        tint.layer?.cornerCurve = .continuous
        tint.layer?.backgroundColor = FlydPalette.ink.withAlphaComponent(0.72).cgColor
        view.addSubview(tint)

        let hairline = NSView(frame: view.bounds)
        hairline.autoresizingMask = [.width, .height]
        hairline.wantsLayer = true
        hairline.layer?.cornerRadius = 16
        hairline.layer?.cornerCurve = .continuous
        hairline.layer?.borderWidth = 1
        hairline.layer?.borderColor = FlydPalette.line.cgColor
        view.addSubview(hairline)

        let dot = FlydStatusDot(frame: NSRect(x: 22, y: 55, width: 7, height: 7))
        view.addSubview(dot)
        statusDot = dot

        let title = NSTextField(labelWithString: "Ask Flyd")
        title.font = FlydPalette.monospace(12)
        title.textColor = FlydPalette.paper
        title.frame = NSRect(x: 38, y: 48, width: 110, height: 20)
        view.addSubview(title)
        titleLabel = title

        let label = NSTextField(labelWithString: "Type an instruction and press Return")
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.textColor = FlydPalette.paper.withAlphaComponent(0.6)
        label.alignment = .right
        label.frame = NSRect(x: 134, y: 48, width: 234, height: 20)
        view.addSubview(label)
        promptLabel = label

        let fieldBackground = NSView(frame: NSRect(x: 18, y: 14, width: 354, height: 28))
        fieldBackground.wantsLayer = true
        fieldBackground.layer?.cornerRadius = 9
        fieldBackground.layer?.cornerCurve = .continuous
        fieldBackground.layer?.backgroundColor = FlydPalette.paper.withAlphaComponent(0.06).cgColor
        fieldBackground.layer?.borderWidth = 1
        fieldBackground.layer?.borderColor = FlydPalette.line.cgColor
        view.addSubview(fieldBackground)
        inputBackground = fieldBackground

        let field = NSTextField(frame: NSRect(x: 30, y: 18, width: 330, height: 20))
        field.isBordered = false
        field.backgroundColor = .clear
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 15)
        field.textColor = FlydPalette.paper
        field.placeholderString = "summarize this page in one sentence"
        field.target = self
        field.action = #selector(textFieldAction)
        view.addSubview(field)
        textField = field
        field.becomeFirstResponder()

        let voiceView = NSView(frame: NSRect(x: 20, y: 10, width: 350, height: 36))
        voiceView.isHidden = true
        voiceView.wantsLayer = true
        voiceView.layer?.backgroundColor = NSColor.clear.cgColor
        view.addSubview(voiceView)
        voiceActivityView = voiceView

        let mic = NSView(frame: NSRect(x: 4, y: 13, width: 10, height: 10))
        mic.wantsLayer = true
        mic.layer?.cornerRadius = 5
        mic.layer?.backgroundColor = FlydPalette.listenBlue.cgColor
        voiceView.addSubview(mic)
        voiceMicDot = mic

        let barCount = 48
        let barWidth: CGFloat = 3
        let startX: CGFloat = 26
        let endInset: CGFloat = 4
        let availableWidth = voiceView.bounds.width - startX - endInset
        let gap = (availableWidth - CGFloat(barCount) * barWidth) / CGFloat(barCount - 1)
        for index in 0..<barCount {
            let x = startX + CGFloat(index) * (barWidth + gap)
            let bar = NSView(frame: NSRect(x: x, y: 16.5, width: barWidth, height: 3))
            bar.wantsLayer = true
            bar.layer?.cornerRadius = barWidth / 2
            bar.layer?.backgroundColor = FlydPalette.listenBlue.withAlphaComponent(0.55).cgColor
            voiceView.addSubview(bar)
            voiceBars.append(bar)
        }
    }

    /// `.executing`/`.undoAvailable` own their own dismissal via an internal timer (and,
    /// for `.undoAvailable`, a live ⌘Z key monitor) — calling this instead of `dismiss()`
    /// after showing one of those states lets it actually stay on screen for its window
    /// instead of being torn down by the caller on the very next run-loop turn.
    func dismissUnlessShowingResult() {
        switch currentState {
        case .executing, .undoAvailable, .workSession:
            return
        default:
            dismiss()
        }
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
        inputBackground = nil
        voiceActivityView = nil
        voiceMicDot = nil
        voiceBars = []
        titleLabel = nil
        promptLabel = nil
        statusDot = nil
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
