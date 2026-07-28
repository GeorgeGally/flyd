import AppKit
import CoreGraphics
import ApplicationServices

struct ShortcutConfiguration {
    var modifiers: CGEventFlags
    var keyCode: CGKeyCode?

    static let `default` = ShortcutConfiguration(
        modifiers: [.maskControl, .maskAlternate],
        keyCode: nil
    )
}

final class InvocationStateMachine {
    static let shared = InvocationStateMachine()

    var configuration = ShortcutConfiguration.default

    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    var wasPressed = false
    fileprivate var textIntercepted = false
    fileprivate var shortcutRoutingState = ShortcutRoutingState()

    fileprivate let holdThreshold: TimeInterval = 0.3
    fileprivate var holdTimer: DispatchWorkItem?
    fileprivate var holdTimerDidFire = false
    fileprivate(set) var isVoiceInvocation = false

    private(set) var transcriptionSessionId: Int = -1

    private let checkpointLock = NSLock()
    private var _t0Fingerprint: InvocationFingerprint?
    private var _t0ScreenHash: UInt64?
    private var _t1Fingerprint: InvocationFingerprint?
    private var _t1ScreenHash: UInt64?
    private var _currentScreenImage: CGImage?
    private var prewarmTask: Task<Void, Never>?

    private var t0Fingerprint: InvocationFingerprint? {
        get { checkpointLock.withLock { _t0Fingerprint } }
        set { checkpointLock.withLock { _t0Fingerprint = newValue } }
    }

    private var t0ScreenHash: UInt64? {
        get { checkpointLock.withLock { _t0ScreenHash } }
        set { checkpointLock.withLock { _t0ScreenHash = newValue } }
    }

    private var t1Fingerprint: InvocationFingerprint? {
        get { checkpointLock.withLock { _t1Fingerprint } }
        set { checkpointLock.withLock { _t1Fingerprint = newValue } }
    }

    private var t1ScreenHash: UInt64? {
        get { checkpointLock.withLock { _t1ScreenHash } }
        set { checkpointLock.withLock { _t1ScreenHash = newValue } }
    }

    private var currentScreenImage: CGImage? {
        get { checkpointLock.withLock { _currentScreenImage } }
        set { checkpointLock.withLock { _currentScreenImage = newValue } }
    }

    private var currentRevision: Int = 0

    var onShortcutPressed: (() -> Void)?
    var onShortcutReleased: (() -> Void)?
    var onShortcutHoldDetected: (() -> Void)?
    var onLiveToggle: (() -> Void)?
    var onIntentReady: ((String, EnvironmentState, InvocationFingerprint) -> Void)?
    var onCancelled: (() -> Void)?

    deinit {
        stop()
    }

    func start() {
        if eventTap != nil {
            writeKeyboardDiagnostic(status: "already-running")
            return
        }

        guard PermissionGate.shared.hasAccessibility else {
            print("[Flyd] Cannot start keyboard monitor: Accessibility permission not granted")
            writeKeyboardDiagnostic(status: "not-started", error: "Accessibility permission is not granted")
            return
        }

        guard PermissionGate.shared.hasKeyboardShortcut else {
            print("[Flyd] Cannot start keyboard monitor: Keyboard shortcut permission not granted")
            writeKeyboardDiagnostic(status: "not-started", error: "Keyboard shortcut permission is not granted")
            return
        }

        let eventMask = CGEventMask(
            (1 << CGEventType.keyDown.rawValue) |
            (1 << CGEventType.keyUp.rawValue) |
            (1 << CGEventType.flagsChanged.rawValue)
        )

        let selfPtr = Unmanaged.passUnretained(self).toOpaque()

        eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: eventMask,
            callback: stateMachineEventCallback,
            userInfo: selfPtr
        )

        guard let eventTap else {
            print("[Flyd] Failed to create CGEvent tap")
            writeKeyboardDiagnostic(status: "not-started", error: "Could not create event tap")
            return
        }

        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
        CFRunLoopAddSource(RunLoop.current.getCFRunLoop(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: eventTap, enable: true)
        print("[Flyd] Keyboard monitor started. Double-tap fn for text, hold fn+⌃ for voice.")
        writeKeyboardDiagnostic(status: "running")
    }

    func reenableEventTap() {
        guard let eventTap else { return }

        CGEvent.tapEnable(tap: eventTap, enable: true)
        print("[Flyd] Keyboard monitor re-enabled")
        writeKeyboardDiagnostic(status: "running", eventType: "tap-reenabled")
    }

    func stop() {
        prewarmTask?.cancel()
        if let runLoopSource {
            CFRunLoopRemoveSource(RunLoop.current.getCFRunLoop(), runLoopSource, .commonModes)
            self.runLoopSource = nil
        }
        if let eventTap {
            CFMachPortInvalidate(eventTap)
            self.eventTap = nil
        }
        resetCheckpoints()
        writeKeyboardDiagnostic(status: "stopped")
    }

    func startPrewarm() {
        let state = FlydState.shared
        state.transition(to: .capturing)
        prewarmTask?.cancel()

        let appInfo = ApplicationMonitor.shared.foregroundApp
        let element = AccessibilityInspector.shared.captureFocusedElement()

        t0Fingerprint = InvocationFingerprint(
            app: appInfo?.bundleId ?? "unknown",
            surface: nil,
            window: "win_01",
            element: element?.ref ?? "unknown",
            capturedAt: Date()
        )

        prewarmTask = Task {
            await prewarmPerception()
        }
    }

    private func prewarmPerception() async {
        // Screen perception is always captured — the accessibility tree alone is
        // blind to most app content (Electron/web apps expose near-empty AX trees).
        guard let image = await ScreenCaptureManager.shared.captureScreenshot() else { return }

        currentScreenImage = image
        t0ScreenHash = ScreenFingerprint.hash(from: image)
    }

    /// Base64 JPEG of the screen captured for the current invocation.
    /// Falls back to a fresh capture if prewarm hasn't produced one yet.
    func invocationScreenshotBase64() async -> String? {
        if let image = currentScreenImage {
            return Self.jpegBase64(from: image)
        }
        guard let image = await ScreenCaptureManager.shared.captureScreenshot() else { return nil }
        currentScreenImage = image
        return Self.jpegBase64(from: image)
    }

    private static func jpegBase64(from image: CGImage, quality: CGFloat = 0.6) -> String? {
        let rep = NSBitmapImageRep(cgImage: image)
        guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: quality]) else { return nil }
        return data.base64EncodedString()
    }

    func captureIntent(intent: String) {
        prewarmTask?.cancel()

        var environment = ObservationCoordinator.shared.latestMeaningfulState()
        let t1Time = Date()

        t1Fingerprint = InvocationFingerprint(
            app: environment?.application.bundleId ?? ApplicationMonitor.shared.foregroundApp?.bundleId ?? "unknown",
            surface: nil,
            window: "win_01",
            element: environment?.focusedElement.ref ?? "unknown",
            capturedAt: t1Time
        )

        environment = AccessibilityInspector.shared.captureEnvironment()

        if let env = environment {
            onIntentReady?(intent, env, t1Fingerprint ?? t0Fingerprint ?? InvocationFingerprint(app: "unknown", surface: nil, window: "win_01", element: "unknown", capturedAt: Date()))
        } else {
            onCancelled?()
        }
    }

    func verifyPreExecution() -> Bool {
        guard let t1fp = t1Fingerprint else { return false }

        let currentApp = ApplicationMonitor.shared.foregroundApp
        let currentFingerprint = InvocationFingerprint(
            app: currentApp?.bundleId ?? "unknown",
            surface: nil,
            window: "win_01",
            element: AccessibilityInspector.shared.captureFocusedElement()?.ref ?? "unknown",
            capturedAt: Date()
        )

        return t1fp.appAndWindowMatch(currentFingerprint)
    }

    func cancel() {
        prewarmTask?.cancel()
        holdTimer?.cancel()
        holdTimer = nil
        holdTimerDidFire = false
        isVoiceInvocation = false
        shortcutRoutingState = ShortcutRoutingState()
        transcriptionSessionId += 1
        resetCheckpoints()
        onCancelled?()
    }

    fileprivate func isModifierKeyCode(_ keyCode: CGKeyCode) -> Bool {
        let modifierKeyCodes: Set<CGKeyCode> = [
            0x36, 0x37, // right/left Command
            0x38, 0x3C, // left/right Shift
            0x3A, 0x3D, // left/right Option
            0x3B, 0x3E, // left/right Control
            0x3F,       // Fn
            0x39,       // Caps Lock
        ]
        return modifierKeyCodes.contains(keyCode)
    }

    func nextTranscriptionSessionId() -> Int {
        transcriptionSessionId += 1
        return transcriptionSessionId
    }

    func setRevision(_ revision: Int) {
        checkpointLock.withLock { currentRevision = revision }
    }

    func isRevisionCurrent(_ revision: Int) -> Bool {
        checkpointLock.withLock { revision == currentRevision }
    }

    func hasFocusDrift() -> Bool {
        guard let t0 = t0Fingerprint, let t1 = t1Fingerprint else { return false }
        return !t0.appAndWindowMatch(t1)
    }

    func resetCheckpoints() {
        t0Fingerprint = nil
        t0ScreenHash = nil
        t1Fingerprint = nil
        t1ScreenHash = nil
        currentScreenImage = nil
        prewarmTask = nil
    }

    fileprivate func writeKeyboardDiagnostic(status: String, error: String? = nil, eventType: String? = nil, flags: CGEventFlags? = nil) {
        let snapshot = KeyboardMonitorSnapshot(
            bundleURL: Bundle.main.bundleURL.path,
            bundleIdentifier: Bundle.main.bundleIdentifier ?? "none",
            executableURL: Bundle.main.executableURL?.path ?? "none",
            processIdentifier: ProcessInfo.processInfo.processIdentifier,
            status: status,
            accessibility: PermissionGate.shared.hasAccessibility,
            keyboardShortcut: PermissionGate.shared.hasKeyboardShortcut,
            eventTapCreated: eventTap != nil,
            eventTapEnabled: eventTap.map { CGEvent.tapIsEnabled(tap: $0) } ?? false,
            eventType: eventType,
            flagsRawValue: flags?.rawValue,
            error: error,
            capturedAt: Date()
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601

        let directoryURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".flyd/overlay", isDirectory: true)
        let fileURL = directoryURL.appendingPathComponent("keyboard-diagnostic.json")

        do {
            try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            let data = try encoder.encode(snapshot)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            print("[Flyd] Could not write keyboard diagnostic: \(error.localizedDescription)")
        }
    }
}

private struct KeyboardMonitorSnapshot: Encodable {
    let bundleURL: String
    let bundleIdentifier: String
    let executableURL: String
    let processIdentifier: Int32
    let status: String
    let accessibility: Bool
    let keyboardShortcut: Bool
    let eventTapCreated: Bool
    let eventTapEnabled: Bool
    let eventType: String?
    let flagsRawValue: UInt64?
    let error: String?
    let capturedAt: Date
}

private func stateMachineEventCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let refcon else { return Unmanaged.passUnretained(event) }
    let machine = Unmanaged<InvocationStateMachine>.fromOpaque(refcon).takeUnretainedValue()

    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        machine.reenableEventTap()

    case .keyDown:
        let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        if machine.wasPressed && !machine.isVoiceInvocation && !machine.isModifierKeyCode(keyCode) {
            machine.textIntercepted = true
        }

    case .flagsChanged:
        let flags = event.flags
        machine.writeKeyboardDiagnostic(status: "running", eventType: "flags-changed", flags: flags)

        let routeEvent = ShortcutRouter.route(
            eventType: type,
            flags: flags,
            state: &machine.shortcutRoutingState
        )

        switch routeEvent {
        case .textTapped:
            machine.wasPressed = false
            machine.isVoiceInvocation = false
            machine.textIntercepted = false
            DispatchQueue.main.async {
                machine.writeKeyboardDiagnostic(status: "running", eventType: "text-double-tap", flags: flags)
                machine.onShortcutPressed?()
                machine.onShortcutReleased?()
            }
        case .voicePressed:
            machine.wasPressed = true
            machine.isVoiceInvocation = true
            DispatchQueue.main.async {
                machine.writeKeyboardDiagnostic(status: "running", eventType: "voice-shortcut-pressed", flags: flags)
                machine.onShortcutPressed?()
                machine.onShortcutHoldDetected?()
            }
        case .voiceReleased:
            machine.wasPressed = false
            machine.isVoiceInvocation = true
            DispatchQueue.main.async {
                machine.onShortcutReleased?()
            }
        case .liveToggle:
            guard FlydState.shared.mode != .invoked else { break }
            DispatchQueue.main.async {
                machine.onLiveToggle?()
            }
        case .none:
            break
        }

    default:
        break
    }

    return Unmanaged.passUnretained(event)
}
