import AppKit
import ApplicationServices

final class AccessibilityInspector {
    static let shared = AccessibilityInspector()

    private var observer: AXObserver?
    private var currentElementRef: AXUIElement?
    private var pid: pid_t = 0
    private var isObserving = false

    private let maxNodeCount = 50

    deinit {
        stop()
    }

    func start() {
        let workspace = NSWorkspace.shared
        NotificationCenter.default.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self else { return }
            if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
                self.attach(to: app.processIdentifier)
            }
        }

        let frontApp = workspace.frontmostApplication
        if let pid = frontApp?.processIdentifier {
            attach(to: pid)
        }
    }

    func stop() {
        if let observer {
            CFRunLoopRemoveSource(
                RunLoop.current.getCFRunLoop(),
                AXObserverGetRunLoopSource(observer),
                .defaultMode
            )
            self.observer = nil
        }
        currentElementRef = nil
        pid = 0
        isObserving = false
    }

    private func attach(to newPid: pid_t) {
        stop()
        guard !ApplicationMonitor.shared.excludedBundleIds.contains(bundleId(for: newPid)) else { return }
        pid = newPid

        var observerRef: AXObserver?
        let result = AXObserverCreate(newPid, axObserverCallback, &observerRef)
        guard result == .success, let observer = observerRef else { return }
        self.observer = observer

        CFRunLoopAddSource(
            RunLoop.current.getCFRunLoop(),
            AXObserverGetRunLoopSource(observer),
            .defaultMode
        )

        registerFocusedElementNotification(on: observer)
        isObserving = true
    }

    private func registerFocusedElementNotification(on observer: AXObserver) {
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        AXObserverAddNotification(
            observer,
            AXUIElementCreateApplication(pid),
            kAXFocusedUIElementChangedNotification as CFString,
            selfPtr
        )
    }

    func captureFocusedElement() -> EnvironmentState.FocusedElementInfo? {
        guard let app = AXUIElementCreateApplication(pid) as AXUIElement? else { return nil }

        var focusedRef: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focusedRef)

        guard result == .success, let focused = focusedRef else { return nil }
        let focusedElement = focused as! AXUIElement

        let role = axAttribute(focusedElement, kAXRoleAttribute as CFString) ?? "unknown"
        let desc = axAttribute(focusedElement, kAXDescriptionAttribute as CFString) ?? ""
        let value = axAttribute(focusedElement, kAXValueAttribute as CFString) ?? ""
        let placeholder = axAttribute(focusedElement, kAXPlaceholderValueAttribute as CFString) ?? ""
        let selectedText = axAttribute(focusedElement, kAXSelectedTextAttribute as CFString) ?? ""

        return EnvironmentState.FocusedElementInfo(
            ref: "el_01",
            role: role,
            description: desc,
            value: value,
            placeholder: placeholder,
            selectedText: selectedText
        )
    }

    func captureSemanticNeighbourhood() -> EnvironmentState.SemanticNeighbourhood? {
        let bundleId = ApplicationMonitor.shared.foregroundApp?.bundleId ?? ""

        switch bundleId {
        case "com.apple.mail":
            return mailAppContext()
        case "com.google.Chrome":
            if let host = currentChromeHost(), host.contains("mail.google.com") {
                return gmailContext()
            }
            return partialContext()
        default:
            return partialContext()
        }
    }

    private func mailAppContext() -> EnvironmentState.SemanticNeighbourhood {
        var context: [String: String] = [:]
        if let window = AXUIElementCreateApplication(pid) as AXUIElement? {
            context["subject"] = axAttribute(window, kAXTitleAttribute as CFString) ?? ""
        }
        return EnvironmentState.SemanticNeighbourhood(
            parentType: "email_thread",
            context: context
        )
    }

    private func gmailContext() -> EnvironmentState.SemanticNeighbourhood {
        var context: [String: String] = [:]
        if let window = AXUIElementCreateApplication(pid) as AXUIElement? {
            context["subject"] = axAttribute(window, kAXTitleAttribute as CFString) ?? ""
        }
        return EnvironmentState.SemanticNeighbourhood(
            parentType: "email_thread",
            context: context
        )
    }

    private func partialContext() -> EnvironmentState.SemanticNeighbourhood {
        return EnvironmentState.SemanticNeighbourhood(
            parentType: nil,
            context: [:]
        )
    }

    private func currentChromeHost() -> String? {
        guard ApplicationMonitor.shared.foregroundApp?.bundleId == "com.google.Chrome" else { return nil }
        if let window = AXUIElementCreateApplication(pid) as AXUIElement? {
            return axAttribute(window, kAXTitleAttribute as CFString)
        }
        return nil
    }

    func captureEnvironment() -> EnvironmentState? {
        guard let appInfo = ApplicationMonitor.shared.foregroundApp else { return nil }
        guard let focusedElement = captureFocusedElement() else { return nil }

        let windowInfo = EnvironmentState.WindowInfo(
            title: appInfo.name,
            ref: "win_01"
        )

        let surfaceInfo = surfaceFor(bundleId: appInfo.bundleId, windowTitle: windowInfo.title)

        return EnvironmentState(
            application: appInfo,
            surface: surfaceInfo,
            window: windowInfo,
            focusedElement: focusedElement,
            semanticNeighbourhood: captureSemanticNeighbourhood(),
            selection: focusedElement.selectedText,
            sufficiency: semanticSufficiency(appInfo.bundleId),
            timestamp: Date()
        )
    }

    private func surfaceFor(bundleId: String, windowTitle: String) -> EnvironmentState.SurfaceInfo? {
        switch bundleId {
        case "com.google.Chrome":
            if windowTitle.contains("mail.google.com") {
                return EnvironmentState.SurfaceInfo(kind: "web_app", host: "mail.google.com", title: windowTitle)
            }
            return EnvironmentState.SurfaceInfo(kind: "web_app", host: nil, title: windowTitle)
        case "com.apple.mail":
            return EnvironmentState.SurfaceInfo(kind: "mail_app", host: nil, title: windowTitle)
        case "com.apple.Terminal":
            return EnvironmentState.SurfaceInfo(kind: "terminal", host: nil, title: windowTitle)
        default:
            return nil
        }
    }

    private func semanticSufficiency(_ bundleId: String) -> EnvironmentState.SufficiencyLevel {
        switch bundleId {
        case "com.apple.mail", "com.google.Chrome":
            return .semantic
        default:
            return .partial
        }
    }

    private func bundleId(for pid: pid_t) -> String {
        if let app = NSRunningApplication(processIdentifier: pid) {
            return app.bundleIdentifier ?? "unknown"
        }
        return "unknown"
    }

    private func axAttribute(_ element: AXUIElement, _ attribute: CFString) -> String? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard result == .success, let copied = value else { return nil }


        if let str = copied as? String {
            return str
        }
        if let num = copied as? NSNumber {
            return num.stringValue
        }
        return "\(copied)"
    }
}

private func axObserverCallback(
    _ observer: AXObserver,
    _ element: AXUIElement,
    _ notification: CFString,
    _ refcon: UnsafeMutableRawPointer?
) {
    _ = Unmanaged<AccessibilityInspector>.fromOpaque(refcon!).takeUnretainedValue()
    DispatchQueue.main.async {
        NotificationCenter.default.post(name: .focusedElementDidChange, object: nil)
    }
}

extension Notification.Name {
    static let focusedElementDidChange = Notification.Name("FocusedElementDidChange")
}
