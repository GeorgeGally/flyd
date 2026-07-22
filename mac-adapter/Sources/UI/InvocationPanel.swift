import AppKit

final class InvocationPanel {
    private var panel: NSPanel?
    private var textField: NSTextField?
    private var promptLabel: NSTextField?

    var onIntentSubmitted: ((String) -> Void)?
    var onCancelled: (() -> Void)?

    func show() {
        guard let mouseLocation = NSEvent.mouseLocation as NSPoint? else { return }

        let panelWidth: CGFloat = 360
        let panelHeight: CGFloat = 72
        let panelFrame = NSRect(
            x: mouseLocation.x - panelWidth / 2,
            y: mouseLocation.y - panelHeight - 12,
            width: panelWidth,
            height: panelHeight
        )

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
        buildContent(in: panel.contentView!, panel: panel)

        panel.makeKey()
        panel.orderFront(nil)

        self.panel = panel
    }

    private func buildContent(in view: NSView, panel: NSPanel) {
        view.wantsLayer = true
        view.layer?.cornerRadius = 10

        let label = NSTextField(labelWithString: "What do you want Flyd to do?")
        label.font = .systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        label.frame = NSRect(x: 12, y: 44, width: 336, height: 16)
        view.addSubview(label)
        promptLabel = label

        let field = NSTextField(frame: NSRect(x: 12, y: 16, width: 336, height: 24))
        field.isBordered = false
        field.backgroundColor = .clear
        field.font = .systemFont(ofSize: 14)
        field.placeholderString = "Type your intent..."
        field.target = self
        field.action = #selector(textFieldAction)
        view.addSubview(field)
        textField = field
        field.becomeFirstResponder()
    }

    func dismiss() {
        textField?.resignFirstResponder()
        panel?.orderOut(nil)
        panel = nil
        textField = nil
        promptLabel = nil
    }

    @objc private func textFieldAction() {
        guard let text = textField?.stringValue, !text.trimmingCharacters(in: .whitespaces).isEmpty else {
            onCancelled?()
            dismiss()
            return
        }
        onIntentSubmitted?(text)
        dismiss()
    }
}
