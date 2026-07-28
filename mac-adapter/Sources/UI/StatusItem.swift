import AppKit
import SwiftUI

final class StatusItem {
    private var statusItem: NSStatusItem?
    private var menu: NSMenu?
    private var privacyWindow: NSWindow?
    private var auditWindow: NSWindow?
    var onInvoke: (() -> Void)?
    var onOpenSetup: (() -> Void)?
    var onRestartFlyd: (() -> Void)?

    func start() {
        if statusItem != nil {
            updateColor(for: FlydState.shared.mode)
            setupMenu()
            return
        }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard let button = statusItem?.button else { return }

        button.imagePosition = .imageOnly
        button.toolTip = "Flyd"

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

        let invokeItem = NSMenuItem(
            title: "Ask Flyd...",
            action: #selector(invokeFlyd),
            keyEquivalent: ""
        )
        invokeItem.target = self
        menu.addItem(invokeItem)

        menu.addItem(.separator())

        let setupItem = NSMenuItem(
            title: "Setup...",
            action: #selector(openSetup),
            keyEquivalent: ""
        )
        setupItem.target = self
        menu.addItem(setupItem)

        menu.addItem(.separator())

        let privacyItem = NSMenuItem(
            title: "Settings...",
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

        let restartItem = NSMenuItem(
            title: "Restart Flyd",
            action: #selector(restartFlyd),
            keyEquivalent: "r"
        )
        restartItem.target = self
        menu.addItem(restartItem)

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

    @objc private func invokeFlyd() {
        onInvoke?()
    }

    @objc private func openSetup() {
        onOpenSetup?()
    }

    @objc private func openPrivacySettings() {
        if let window = privacyWindow {
            NSApplication.shared.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 560),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Flyd — Settings"
        window.center()
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: PrivacySettingsView())
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        privacyWindow = window
    }

    @objc private func openAuditTrail() {
        if let window = auditWindow {
            NSApplication.shared.activate(ignoringOtherApps: true)
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
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: AuditTrailView())
        NSApplication.shared.activate(ignoringOtherApps: true)
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

    @objc private func restartFlyd() {
        onRestartFlyd?()
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

        statusItem?.button?.image = Self.dotImage(color: color)
    }

    private static func dotImage(color: NSColor) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18))
        image.lockFocus()

        NSColor.clear.setFill()
        NSRect(x: 0, y: 0, width: 18, height: 18).fill()

        color.setFill()
        let path = NSBezierPath(ovalIn: NSRect(x: 5, y: 5, width: 8, height: 8))
        path.fill()

        image.unlockFocus()
        image.isTemplate = false
        return image
    }
}
