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
    var onIntentReady: ((String, EnvironmentState, InvocationFingerprint) -> Void)?
    var onCancelled: (() -> Void)?

    deinit {
        stop()
    }

    func start() {
        guard PermissionGate.shared.hasAccessibility else {
            print("[Flyd] Cannot start keyboard monitor: Accessibility permission not granted")
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
            return
        }

        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
        CFRunLoopAddSource(RunLoop.current.getCFRunLoop(), runLoopSource, .commonModes)
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
        resetCheckpoints()
        onCancelled?()
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
    case .flagsChanged:
        let flags = event.flags
        let targetFlags = machine.configuration.modifiers

        if flags.intersection(targetFlags) == targetFlags {
            if !machine.wasPressed {
                machine.wasPressed = true
                DispatchQueue.main.async {
                    machine.onShortcutPressed?()
                }
            }
        } else if machine.wasPressed {
            machine.wasPressed = false
            DispatchQueue.main.async {
                machine.onShortcutReleased?()
            }
        }

    default:
        break
    }

    return Unmanaged.passUnretained(event)
}
