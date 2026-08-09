import AppKit
import ApplicationServices

final class AccessibilityInspector {
    static let shared = AccessibilityInspector()

    private var observer: AXObserver?
    private var currentElementRef: AXUIElement?
    private var valueObservedElement: AXUIElement?
    private var pid: pid_t = 0
    private var isObserving = false

    private let maxNodeCount = 50

    private(set) var focusedElementBounds: CGRect?
    private(set) var selectedRangeBounds: CGRect?
    private(set) var openDocuments: [String] = []

    func captureOpenDocuments(for bundleId: String) -> [String] {
        var documents: Set<String> = []

        if let runningApp = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first {
            let appElement = AXUIElementCreateApplication(runningApp.processIdentifier)

            var windowList: CFTypeRef?
            let result = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowList)
            guard result == .success, let windows = windowList as? [AXUIElement] else { return [] }

            for window in windows.prefix(10) {
                var titleValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleValue) == .success,
                   let title = titleValue as? String, !title.isEmpty {
                    documents.insert(title)
                }

                var docValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(window, kAXDocumentAttribute as CFString, &docValue) == .success,
                   let docPath = docValue as? String, !docPath.isEmpty {
                    let filename = (docPath as NSString).lastPathComponent
                    documents.insert(filename)
                }
            }
        }

        return Array(documents).prefix(10).map { $0 }
    }
    var editable: Bool {
        guard let role = currentRole else { return false }
        return role == "AXTextField" || role == "AXTextArea"
    }

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
        valueObservedElement = nil
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
        refreshFocusedElementObservation()
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

    fileprivate func refreshFocusedElementObservation() {
        guard let observer,
              let app = AXUIElementCreateApplication(pid) as AXUIElement? else { return }
        var focusedRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focusedRef) == .success,
              let focusedRef else { return }
        let focused = focusedRef as! AXUIElement

        if let previous = valueObservedElement {
            if CFEqual(previous, focused) { return }
            AXObserverRemoveNotification(observer, previous, kAXValueChangedNotification as CFString)
        }
        valueObservedElement = focused
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        AXObserverAddNotification(observer, focused, kAXValueChangedNotification as CFString, selfPtr)
    }

    func captureFocusedElement() -> EnvironmentState.FocusedElementInfo? {
        guard let app = AXUIElementCreateApplication(pid) as AXUIElement? else { return nil }

        var focusedRef: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focusedRef)

        guard result == .success, let focused = focusedRef else {
            focusedElementBounds = nil
            selectedRangeBounds = nil
            return nil
        }
        let focusedElement = focused as! AXUIElement

        currentElementRef = focusedElement
        refreshFocusedElementObservation()

        let role = axAttribute(focusedElement, kAXRoleAttribute as CFString) ?? "unknown"
        let desc = axAttribute(focusedElement, kAXDescriptionAttribute as CFString) ?? ""
        let value = axAttribute(focusedElement, kAXValueAttribute as CFString) ?? ""
        let placeholder = axAttribute(focusedElement, kAXPlaceholderValueAttribute as CFString) ?? ""
        let selectedText = axAttribute(focusedElement, kAXSelectedTextAttribute as CFString) ?? ""

        focusedElementBounds = axRect(focusedElement, "AXFrame" as CFString)
        selectedRangeBounds = captureSelectedRangeBounds(focusedElement)

        return EnvironmentState.FocusedElementInfo(
            ref: "el_01",
            role: role,
            description: desc,
            value: value,
            placeholder: placeholder,
            selectedText: selectedText
        )
    }

    func capturedAXElement() -> AXUIElement? {
        currentElementRef
    }

    var currentRole: String? {
        guard let element = currentElementRef else { return nil }
        return axAttribute(element, kAXRoleAttribute as CFString)
    }

    var currentIdentifier: String? {
        guard let element = currentElementRef else { return nil }
        return axAttribute(element, kAXIdentifierAttribute as CFString)
    }

    var currentDescription: String? {
        guard let element = currentElementRef else { return nil }
        return axAttribute(element, kAXDescriptionAttribute as CFString)
    }

    func captureSemanticNeighbourhood() -> EnvironmentState.SemanticNeighbourhood? {
        let bundleId = ApplicationMonitor.shared.foregroundApp?.bundleId ?? ""

        PrivacyInvariants.capturedAXNodeCount = 0

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

    private func canCollectNode() -> Bool {
        PrivacyInvariants.capturedAXNodeCount += 1
        return PrivacyInvariants.capturedAXNodeCount <= maxNodeCount
    }

    private func mailAppContext() -> EnvironmentState.SemanticNeighbourhood {
        var context: [String: String] = [:]
        guard canCollectNode() else {
            return EnvironmentState.SemanticNeighbourhood(parentType: "email_thread", context: [:])
        }
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
        guard canCollectNode() else {
            return EnvironmentState.SemanticNeighbourhood(parentType: "email_thread", context: [:])
        }
        if let window = AXUIElementCreateApplication(pid) as AXUIElement? {
            context["subject"] = axAttribute(window, kAXTitleAttribute as CFString) ?? ""
        }
        return EnvironmentState.SemanticNeighbourhood(
            parentType: "email_thread",
            context: context
        )
    }

    private func partialContext() -> EnvironmentState.SemanticNeighbourhood {
        guard canCollectNode() else {
            return EnvironmentState.SemanticNeighbourhood(parentType: nil, context: [:])
        }
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

        let capturedWindowTitle = focusedWindow()
            .flatMap { axAttribute($0, kAXTitleAttribute as CFString) }
        let windowInfo = EnvironmentState.WindowInfo(
            title: capturedWindowTitle?.isEmpty == false ? capturedWindowTitle! : appInfo.name,
            ref: "win_01"
        )

        let surfaceInfo = surfaceFor(bundleId: appInfo.bundleId, windowTitle: windowInfo.title)

        let documentPath = captureDocumentPath(for: appInfo.bundleId)
        let browserURL = captureBrowserURL(for: appInfo.bundleId)
        let displayID = captureDisplayID()
        let openDocuments = captureOpenDocuments(for: appInfo.bundleId)

        return EnvironmentState(
            application: appInfo,
            surface: surfaceInfo,
            window: windowInfo,
            focusedElement: focusedElement,
            semanticNeighbourhood: captureSemanticNeighbourhood(),
            selection: focusedElement.selectedText,
            sufficiency: semanticSufficiency(appInfo.bundleId),
            timestamp: Date(),
            documentPath: documentPath,
            browserURL: browserURL,
            displayID: displayID,
            screenshotBounds: nil,
            openDocuments: openDocuments.isEmpty ? nil : openDocuments
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

    private func axRect(_ element: AXUIElement, _ attribute: CFString) -> CGRect? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard result == .success, let copied = value else { return nil }

        var rect = CGRect.zero
        guard AXValueGetValue(copied as! AXValue, .cgRect, &rect) else { return nil }
        return rect
    }

    private func captureSelectedRangeBounds(_ element: AXUIElement) -> CGRect? {
        var rangeValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rangeValue) == .success,
              let range = rangeValue else { return nil }

        var boundsValue: CFTypeRef?
        let param = range as CFTypeRef
        guard AXUIElementCopyParameterizedAttributeValue(element, kAXBoundsForRangeParameterizedAttribute as CFString, param, &boundsValue) == .success,
              let bounds = boundsValue else { return nil }

        var rect = CGRect.zero
        guard AXValueGetValue(bounds as! AXValue, .cgRect, &rect) else { return nil }
        return rect
    }

    private func captureDocumentPath(for bundleId: String) -> String? {
        guard let app = AXUIElementCreateApplication(pid) as AXUIElement? else { return nil }
        var docValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXDocumentAttribute as CFString, &docValue) == .success,
              let doc = docValue else {
            return fallbackDocumentPath(for: bundleId)
        }
        if let url = doc as? URL {
            return url.path
        }
        if let str = doc as? String {
            return str
        }
        return nil
    }

    private func fallbackDocumentPath(for bundleId: String) -> String? {
        guard NSRunningApplication(processIdentifier: pid) != nil else { return nil }
        if bundleId == "com.apple.dt.Xcode" {
            if let workspaceWindow = focusedWindow(),
               let title = axAttribute(workspaceWindow, kAXTitleAttribute as CFString),
               let dashRange = title.range(of: " — ") {
                return String(title[..<dashRange.lowerBound])
            }
        }
        return nil
    }

    private func focusedWindow() -> AXUIElement? {
        guard let app = AXUIElementCreateApplication(pid) as AXUIElement? else { return nil }
        var windowRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &windowRef) == .success,
              let window = windowRef else { return nil }
        return (window as! AXUIElement)
    }

    private static let browserBundleIds: Set<String> = [
        "com.apple.Safari",
        "com.google.Chrome",
        "org.mozilla.firefox",
        "com.microsoft.edgemac",
        "com.brave.Browser",
        "company.thebrowser.Browser",
    ]

    private func captureBrowserURL(for bundleId: String) -> String? {
        guard Self.browserBundleIds.contains(bundleId) else { return nil }

        if bundleId == "com.apple.Safari" {
            return captureSafariURL()
        }
        if bundleId == "com.google.Chrome" {
            return captureChromeURL()
        }

        guard let window = focusedWindow() else { return nil }
        var urlValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXURLAttribute as CFString, &urlValue) == .success,
              let url = urlValue as? URL else {
            return axAttribute(window, kAXTitleAttribute as CFString)
        }
        return url.absoluteString
    }

    private func captureSafariURL() -> String? {
        guard let window = focusedWindow() else { return nil }
        var urlValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXURLAttribute as CFString, &urlValue) == .success,
              let url = urlValue as? URL else {
            return axAttribute(window, kAXTitleAttribute as CFString)
        }
        return url.absoluteString
    }

    private func captureChromeURL() -> String? {
        guard let window = focusedWindow() else { return nil }
        var urlValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXURLAttribute as CFString, &urlValue) == .success,
              let url = urlValue as? URL else {
            let title = axAttribute(window, kAXTitleAttribute as CFString) ?? ""
            let components = title.components(separatedBy: " - Google Chrome")
            return components.first?.trimmingCharacters(in: .whitespaces)
        }
        return url.absoluteString
    }

    private func captureDisplayID() -> String? {
        guard let window = focusedWindow() else { return nil }
        var positionValue: CFTypeRef?
        var sizeValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionValue) == .success,
              AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeValue) == .success else {
            return mainDisplayID()
        }

        var position = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &position),
              AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else {
            return mainDisplayID()
        }

        let windowFrame = CGRect(origin: position, size: size)
        let windowCenter = CGPoint(x: windowFrame.midX, y: windowFrame.midY)

        for screen in NSScreen.screens {
            let screenFrame = screen.frame
            if screenFrame.contains(windowCenter) {
                if let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
                    return "\(screenNumber.uint32Value)"
                }
                return screen.localizedName
            }
        }

        return mainDisplayID()
    }

    private func mainDisplayID() -> String? {
        guard let screen = NSScreen.main,
              let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
        return "\(screenNumber.uint32Value)"
    }
}

private func axObserverCallback(
    _ observer: AXObserver,
    _ element: AXUIElement,
    _ notification: CFString,
    _ refcon: UnsafeMutableRawPointer?
) {
    let inspector = Unmanaged<AccessibilityInspector>.fromOpaque(refcon!).takeUnretainedValue()
    DispatchQueue.main.async {
        if notification as String == kAXFocusedUIElementChangedNotification as String {
            inspector.refreshFocusedElementObservation()
            NotificationCenter.default.post(name: .focusedElementDidChange, object: nil)
        } else if notification as String == kAXValueChangedNotification as String {
            NotificationCenter.default.post(name: .focusedElementValueDidChange, object: nil)
        }
    }
}

extension Notification.Name {
    static let focusedElementDidChange = Notification.Name("FocusedElementDidChange")
    static let focusedElementValueDidChange = Notification.Name("FocusedElementValueDidChange")
}
