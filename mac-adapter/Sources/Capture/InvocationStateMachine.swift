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

    fileprivate let holdThreshold: TimeInterval = 0.3
    fileprivate var holdTimer: DispatchWorkItem?
    fileprivate var holdTimerDidFire = false
    fileprivate(set) var isVoiceInvocation = false

    private let ctrlKeyCode: CGKeyCode = 0x3B
    fileprivate var ctrlPressTimestamps: [TimeInterval] = []
    fileprivate let triplePressWindow: TimeInterval = 0.5
    fileprivate var liveDebounceUntil: TimeInterval = 0
    file    private var wasCtrlDown = false
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
    var onVoiceIntentReady: ((String) -> Void)?
    var onIntentReady: ((String, EnvironmentState, InvocationFingerprint) -> Void)?
    var onCancelled: (() -> Void)?
    var onLiveEnter: (() -> Void)?
    var onLiveExit: (() -> Void)?

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
        print("[Flyd] Keyboard monitor started. Press ⌃⌥ to invoke.")
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
        if AccessibilityInspector.shared.captureFocusedElement() != nil {
            return
        }

        guard let image = await ScreenCaptureManager.shared.captureScreenshot() else { return }

        currentScreenImage = image
        t0ScreenHash = ScreenFingerprint.hash(from: image)
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
        transcriptionSessionId += 1
        resetCheckpoints()
        onCancelled?()
    }

    func voiceIntentReceived(_ transcript: String) {
        onVoiceIntentReady?(transcript)
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

    case .flagsChanged:
        let flags = event.flags
        machine.writeKeyboardDiagnostic(status: "running", eventType: "flags-changed", flags: flags)
        let targetFlags = machine.configuration.modifiers

        // Ctrl triple-press detection (rising edge only)
        let ctrlDown = flags.contains(.maskControl)
        if ctrlDown && !machine.wasCtrlDown {
            let now = Date().timeIntervalSinceReferenceDate
            if now >= machine.liveDebounceUntil {
                machine.ctrlPressTimestamps.append(now)
                machine.ctrlPressTimestamps = machine.ctrlPressTimestamps.suffix(3)

                if machine.ctrlPressTimestamps.count == 3 {
                    let firstPress = machine.ctrlPressTimestamps[0]
                    let lastPress = machine.ctrlPressTimestamps[2]
                    if lastPress - firstPress <= machine.triplePressWindow {
                        machine.ctrlPressTimestamps = []
                        machine.liveDebounceUntil = now + 0.3
                        machine.wasPressed = false
                        machine.holdTimer?.cancel()
                        machine.holdTimer = nil
                        machine.holdTimerDidFire = false

                        let isLive = FlydState.shared.mode == .live
                        DispatchQueue.main.async {
                            if isLive {
                                machine.onLiveExit?()
                            } else {
                                machine.onLiveEnter?()
                            }
                        }
                    }
                }
            }
        }
        machine.wasCtrlDown = ctrlDown

        // ⌃⌥ shortcut detection (tap vs hold)
        if flags.intersection(targetFlags) == targetFlags {
            if !machine.wasPressed {
                machine.wasPressed = true
                machine.isVoiceInvocation = false
                machine.holdTimerDidFire = false

                let holdItem = DispatchWorkItem {
                    machine.holdTimerDidFire = true
                    machine.isVoiceInvocation = true
                    DispatchQueue.main.async {
                        machine.onShortcutHoldDetected?()
                    }
                }
                machine.holdTimer = holdItem
                DispatchQueue.main.asyncAfter(deadline: .now() + machine.holdThreshold, execute: holdItem)

                DispatchQueue.main.async {
                    machine.writeKeyboardDiagnostic(status: "running", eventType: "shortcut-pressed", flags: flags)
                    machine.onShortcutPressed?()
                }
            }
        } else if machine.wasPressed {
            machine.wasPressed = false
            machine.holdTimer?.cancel()
            machine.holdTimer = nil

            let timerFired = machine.holdTimerDidFire
            machine.holdTimerDidFire = false

            DispatchQueue.main.async {
                if timerFired {
                    machine.isVoiceInvocation = true
                }
                machine.onShortcutReleased?()
            }
        }

    default:
        break
    }

    return Unmanaged.passUnretained(event)
}
