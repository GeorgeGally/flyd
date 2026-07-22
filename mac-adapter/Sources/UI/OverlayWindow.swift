import AppKit

final class OverlayWindow {
    private var window: NSPanel?

    var isVisible: Bool {
        window?.isVisible ?? false
    }

    func create() {
        let panel = NSPanel(
            contentRect: NSScreen.main?.frame ?? .zero,
            styleMask: [.nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.isReleasedWhenClosed = false
        panel.orderOut(nil)

        window = panel
    }

    func show() {
        window?.orderFront(nil)
    }

    func hide() {
        window?.orderOut(nil)
    }

    func makeInteractive() {
        window?.ignoresMouseEvents = false
    }

    func makePassive() {
        window?.ignoresMouseEvents = true
    }
}
