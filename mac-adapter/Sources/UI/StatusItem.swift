import AppKit
import SwiftUI

final class StatusItem {
    private var statusItem: NSStatusItem?
    private var dotView: StatusDotView?
    private var menu: NSMenu?
    private weak var privacyWindow: NSWindow?
    private weak var auditWindow: NSWindow?

    func start() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = statusItem?.button else { return }

        let view = StatusDotView(frame: NSRect(x: 0, y: 0, width: 18, height: 18))
        dotView = view
        button.addSubview(view)
        view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            view.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            view.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            view.widthAnchor.constraint(equalToConstant: 8),
            view.heightAnchor.constraint(equalToConstant: 8),
        ])

        updateColor(for: FlydState.shared.mode)

        setupMenu()

        NotificationCenter.default.addObserver(
            forName: .flydModeDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.updateColor(for: FlydState.shared.mode)
        }
    }

    private func setupMenu() {
        let menu = NSMenu()

        let privacyItem = NSMenuItem(
            title: "Privacy Settings...",
            action: #selector(openPrivacySettings),
            keyEquivalent: ","
        )
        privacyItem.target = self
        menu.addItem(privacyItem)

        let auditItem = NSMenuItem(
            title: "Invocation History...",
            action: #selector(openAuditTrail),
            keyEquivalent: ""
        )
        auditItem.target = self
        menu.addItem(auditItem)

        menu.addItem(.separator())

        let incognitoItem = NSMenuItem(
            title: "Incognito Mode",
            action: #selector(toggleIncognito),
            keyEquivalent: ""
        )
        incognitoItem.target = self
        incognitoItem.state = ConfigManager.shared.config.incognito ? .on : .off
        menu.addItem(incognitoItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(
            title: "Quit Flyd",
            action: #selector(quitApp),
            keyEquivalent: "q"
        )
        quitItem.target = self
        menu.addItem(quitItem)

        self.menu = menu
        statusItem?.menu = menu
    }

    @objc private func openPrivacySettings() {
        if let window = privacyWindow, window.isVisible {
            window.makeKeyAndOrderFront(nil)
            return
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 560),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Flyd — Privacy Settings"
        window.center()
        window.contentView = NSHostingView(rootView: PrivacySettingsView())
        window.makeKeyAndOrderFront(nil)
        privacyWindow = window
    }

    @objc private func openAuditTrail() {
        if let window = auditWindow, window.isVisible {
            window.makeKeyAndOrderFront(nil)
            return
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 400),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Flyd — Invocation History"
        window.center()
        window.contentView = NSHostingView(rootView: AuditTrailView())
        window.makeKeyAndOrderFront(nil)
        auditWindow = window
    }

    @objc private func toggleIncognito() {
        let newValue = !ConfigManager.shared.config.incognito
        ConfigManager.shared.setIncognito(newValue)
        updateIncognitoMenuItem()
    }

    private func updateIncognitoMenuItem() {
        if let item = menu?.items.first(where: { $0.title == "Incognito Mode" }) {
            item.state = ConfigManager.shared.config.incognito ? .on : .off
        }
    }

    @objc private func quitApp() {
        NSApplication.shared.terminate(nil)
    }

    private func updateColor(for mode: FlydMode) {
        var color: NSColor
        switch mode {
        case .present:
            color = .lightGray
        case .invoked:
            color = .systemBlue
        case .live:
            color = .systemGreen
        }

        if FlydState.shared.phase == .cancelled || FlydState.shared.phase == .error {
            color = .systemRed
        }

        dotView?.color = color
    }
}

private final class StatusDotView: NSView {
    var color: NSColor = .lightGray {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        let path = NSBezierPath(ovalIn: bounds)
        path.fill()
    }
}
