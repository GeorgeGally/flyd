import AppKit
import ApplicationServices
import Carbon.HIToolbox
import CryptoKit

/// Invocation-only, PID-bound capture. No shared inspector state, disk, or screenshot.
final class DictationContextCapture {
    let pid: pid_t
    let bundleId: String
    private let lock = NSLock()
    private var element: AXUIElement?
    private var window: AXUIElement?
    private var title = ""

    init(pid: pid_t, bundleId: String) { self.pid = pid; self.bundleId = bundleId }

    func startFields() -> [String: Any] {
        var app: [String: Any] = ["bundleId": bundleId]
        var context: [String: Any] = ["capturedAt": ISO8601DateFormatter().string(from: Date())]
        guard !IsSecureEventInputEnabled(),
              !ConfigManager.shared.isBundleExcluded(bundleId) else {
            return ["purpose": "dictation", "app": app]
        }
        let axApp = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(axApp, 0.15)
        let focused = Self.elementAttribute(axApp, kAXFocusedUIElementAttribute)
        let focusedWindow = Self.elementAttribute(axApp, kAXFocusedWindowAttribute)
        if let focused { AXUIElementSetMessagingTimeout(focused, 0.15) }
        if let focusedWindow { AXUIElementSetMessagingTimeout(focusedWindow, 0.15) }
        lock.lock(); element = focused; window = focusedWindow; lock.unlock()
        if let focusedWindow, let title = Self.text(focusedWindow, kAXTitleAttribute) {
            lock.lock(); self.title = String(title.prefix(300)); lock.unlock()
            app["windowTitle"] = String(title.prefix(300))
            context["documentTitle"] = String(title.prefix(300))
        }
        let config = ConfigManager.shared.config
        if config.dictationContext, !config.incognito, let focused,
           Self.text(focused, kAXSubroleAttribute) != "AXSecureTextField" {
            context["selectedText"] = String((Self.text(focused, kAXSelectedTextAttribute) ?? "").prefix(1000))
            let value = Self.text(focused, kAXValueAttribute) ?? ""
            context["nearbyText"] = String(value.suffix(2000))
        }
        return ["purpose": "dictation", "app": app, "context": context]
    }

    func isStillFocused() -> Bool {
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return false }
        lock.lock(); let original = element; let originalWindow = window; lock.unlock()
        let app = AXUIElementCreateApplication(pid)
        if let original {
            guard let current = Self.elementAttribute(app, kAXFocusedUIElementAttribute),
                  CFEqual(original, current) else { return false }
        }
        if let originalWindow {
            guard let current = Self.elementAttribute(app, kAXFocusedWindowAttribute),
                  CFEqual(originalWindow, current) else { return false }
        }
        return true
    }

    func correctionScope() -> String {
        lock.lock(); let capturedTitle = title; lock.unlock()
        let value = bundleId + "\n" + capturedTitle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func capturedElement() -> AXUIElement? {
        lock.lock(); defer { lock.unlock() }; return element
    }

    static func elementAttribute(_ element: AXUIElement, _ key: String) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    static func text(_ element: AXUIElement, _ key: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
        return value as? String
    }
}
