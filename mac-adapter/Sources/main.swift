import AppKit
import SwiftUI

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let state = FlydState.shared
let permissionGate = PermissionGate.shared
let statusItem = StatusItem()
let overlayWindow = OverlayWindow()
let applicationMonitor = ApplicationMonitor.shared
let accessibilityInspector = AccessibilityInspector.shared
let stateMachine = InvocationStateMachine.shared
let auditRecorder = AuditRecorder.shared
let auth = AdapterAuth.shared
let flydClient = FlydClient.shared
let executor = NativeExecutor.shared
let configManager = ConfigManager.shared

let invocationPanel = InvocationPanel()
var activeInvocationTask: Task<Void, Never>?

if !permissionGate.allRequiredGranted() {
    showPermissionsWindow()
} else {
    startFlyd()
}

app.run()

func startFlyd() {
    _ = auth.credential()

    statusItem.start()
    overlayWindow.create()

    applicationMonitor.start()
    accessibilityInspector.start()

    stateMachine.onShortcutPressed = {
        handleInvocation()
    }
    stateMachine.onShortcutReleased = {}

    stateMachine.start()

    Task {
        let healthy = await flydClient.healthCheck()
        if healthy {
            print("[Flyd] Connected to Flyd Core")
        } else {
            print("[Flyd] Flyd Core not running — pass-through disabled. Invocations will log locally.")
        }
    }

    print("[Flyd] Agent started. Press ⌃⌥ to invoke.")
}

func handleInvocation() {
    let currentPhase = state.phase

    if currentPhase != .idle {
        activeInvocationTask?.cancel()
        state.cancelInvocation()
        stateMachine.cancel()
        invocationPanel.dismiss()
        return
    }

    let invocationId = state.startInvocation()
    stateMachine.startPrewarm()
    state.transition(to: .awaitingIntent)

    invocationPanel.onIntentSubmitted = { intent in
        activeInvocationTask = Task { await processInvocation(invocationId: invocationId, intent: intent) }
    }

    invocationPanel.onCancelled = {
        activeInvocationTask?.cancel()
        state.cancelInvocation()
        stateMachine.cancel()
        executor.clearInvocationRefs()
        auditRecorder.record(
            invocationId: invocationId,
            contextSources: ["cancelled"],
            error: "User cancelled"
        )
    }

    invocationPanel.show()
}

func processInvocation(invocationId: String, intent: String) async {
    stateMachine.captureIntent(intent: intent)

    if stateMachine.hasFocusDrift() {
        print("[Flyd] WARNING: Focus drifted between t₀ and t₁")
    }

    guard let environment = accessibilityInspector.captureEnvironment() else {
        state.cancelInvocation()
        stateMachine.cancel()
        executor.clearInvocationRefs()
        invocationPanel.dismiss()
        auditRecorder.record(invocationId: invocationId, contextSources: ["none"], error: "Failed to capture environment")
        return
    }

    state.transition(to: .resolving)

    if !stateMachine.verifyPreExecution() {
        print("[Flyd] WARNING: App/window changed before execution")
    }

    let contextSources = [
        "app:\(environment.application.bundleId)",
        "element:\(environment.focusedElement.role)",
        "sufficiency:\(environment.sufficiency.rawValue)",
    ]

    print("[Flyd] ===== INVOCATION \(invocationId.prefix(8)) =====")
    print("[Flyd] App: \(environment.application.name) (\(environment.application.bundleId))")
    print("[Flyd] Element: \(environment.focusedElement.role) — \(environment.focusedElement.description)")
    print("[Flyd] Intent: \(intent)")
    print("[Flyd] =====================================")

    guard let fingerprint = InvocationFingerprint(
        app: environment.application.bundleId,
        surface: environment.surface?.host,
        window: "win_01",
        element: environment.focusedElement.ref,
        capturedAt: Date()
    ) as InvocationFingerprint? else { return }

    let response = await flydClient.sendManifest(
        invocationId: invocationId,
        environment: environment,
        intent: intent,
        fingerprint: fingerprint
    )

    guard let resolution = response else {
        print("[Flyd] No response from Flyd Core — running locally")

        auditRecorder.record(
            invocationId: invocationId,
            contextSources: contextSources,
            error: "Flyd Core unreachable"
        )

        await MainActor.run {
            invocationPanel.dismiss()
            state.transition(to: .present)
        }
        return
    }

    state.transition(to: .executing)

    print("[Flyd] Resolution: \(resolution.mode) — \(resolution.rationale)")

    switch resolution.mode {
    case "native":
        await executeNativeOperations(resolution: resolution, fingerprint: fingerprint)

    case "requires_augment":
        await showAugmentations(
            invocationId: invocationId,
            resolution: resolution,
            fingerprint: fingerprint
        )

    case "requires_compose":
        print("[Flyd] Compose requested: \(resolution.composeRationale ?? "no rationale")")
        if let url = resolution.composeUrl, let surfaceURL = URL(string: url) {
            NSWorkspace.shared.open(surfaceURL)
        } else {
            print("[Flyd] No compose URL returned — opening surface")
            if let surfaceURL = URL(string: "http://127.0.0.1:3000/surface") {
                NSWorkspace.shared.open(surfaceURL)
            }
        }

    default:
        print("[Flyd] Unknown mode: \(resolution.mode)")
    }

    auditRecorder.record(
        invocationId: invocationId,
        contextSources: contextSources,
        error: nil
    )

    executor.clearInvocationRefs()
    stateMachine.resetCheckpoints()

    await MainActor.run {
        state.transition(to: .present)
    }
}

func executeNativeOperations(
    resolution: FlydClient.ResolutionResponse,
    fingerprint: InvocationFingerprint
) async {
    guard InvocationStateMachine.shared.verifyPreExecution() else {
        print("[Flyd] Aborting: target no longer available")
        await flydClient.sendOutcome(
            resolutionId: resolution.resolutionId,
            invocationId: resolution.invocationId,
            status: "failed",
            correction: "Target no longer available — app or window changed"
        )
        return
    }

    for op in resolution.operations {
        let resolved = ResolvedOperation(target: op.target, kind: op.kind, text: op.text)
        let result = await executor.execute(operation: resolved, fingerprint: fingerprint)

        if result.success {
            print("[Flyd] Executed: \(op.kind) → \(op.text.prefix(40))...")
        } else {
            print("[Flyd] Failed: \(op.kind) — \(result.error ?? "unknown error")")
        }

        await flydClient.sendOutcome(
            resolutionId: resolution.resolutionId,
            invocationId: resolution.invocationId,
            status: result.success ? "succeeded" : "failed",
            correction: result.error
        )
    }
}

func buildFingerprint(from environment: EnvironmentState) -> InvocationFingerprint {
    return InvocationFingerprint(
        app: environment.application.bundleId,
        surface: environment.surface?.host,
        window: "win_01",
        element: environment.focusedElement.ref,
        capturedAt: Date()
    )
}

func showPermissionsWindow() {
    let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 320),
        styleMask: [.titled, .closable, .miniaturizable],
        backing: .buffered,
        defer: false
    )
    window.title = "Flyd — Permissions"
    window.center()
    window.contentView = NSHostingView(rootView: PermissionsView())

    let appDelegate = PermissionsAppDelegate()
    app.delegate = appDelegate

    window.makeKeyAndOrderFront(nil)

    Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { timer in
        if permissionGate.allRequiredGranted() {
            timer.invalidate()
            window.close()
            startFlyd()
        }
    }
}

final class PermissionsAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
