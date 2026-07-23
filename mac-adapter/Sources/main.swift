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

if !permissionGate.hasAccessibility {
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

    launchCore()

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

func launchCore() {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["npm", "run", "core", "--silent"]
    process.currentDirectoryURL = URL(fileURLWithPath: resolveCliDir())
    process.environment = ProcessInfo.processInfo.environment

    process.terminationHandler = { proc in
        if proc.terminationStatus != 0 {
            print("[Flyd] Core exited with status \(proc.terminationStatus) — restarting in 2s...")
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                launchCore()
            }
        }
    }

    do {
        try process.run()
        print("[Flyd] Core launched (pid \(process.processIdentifier))")
    } catch {
        print("[Flyd] Could not launch Core: \(error.localizedDescription)")
    }
}

func resolveCliDir() -> String {
    if let envPath = ProcessInfo.processInfo.environment["FLYD_CLI_DIR"] {
        return envPath
    }

    let repoPath = repoRoot()
    return repoPath.appending("/cli")
}

func repoRoot() -> String {
    if let bundlePath = Bundle.main.resourcePath {
        var path = bundlePath
        for _ in 0...8 {
            if FileManager.default.fileExists(atPath: path + "/cli/package.json") {
                return path
            }
            path = (path as NSString).deletingLastPathComponent
        }
    }
    return FileManager.default.currentDirectoryPath
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

    let (invocationId, revision) = state.startInvocation()
    stateMachine.setRevision(revision)
    stateMachine.startPrewarm()

    if let element = accessibilityInspector.capturedAXElement() {
        executor.registerElement(ref: "el_01", element: element)
    }

    state.transition(to: .awaitingIntent)

    invocationPanel.onIntentSubmitted = { intent in
        activeInvocationTask = Task { await processInvocation(invocationId: invocationId, revision: revision, intent: intent) }
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

func processInvocation(invocationId: String, revision: Int, intent: String) async {
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
        environmentRevision: revision,
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

    if !InvocationStateMachine.shared.isRevisionCurrent(resolution.environmentRevision) {
        print("[Flyd] Discarding stale resolution — revision \(resolution.environmentRevision) is not current")
        await flydClient.sendOutcome(
            resolutionId: resolution.resolutionId,
            invocationId: resolution.invocationId,
            status: "failed",
            correction: "Stale resolution — superseded by newer invocation"
        )
        await MainActor.run {
            state.transition(to: .present)
        }
        return
    }

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
    let window = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 420, height: 320),
        styleMask: [.titled, .closable, .nonactivatingPanel],
        backing: .buffered,
        defer: false
    )
    window.title = "Flyd — Permissions"
    window.center()
    window.isFloatingPanel = true
    window.level = .floating
    window.collectionBehavior = [.canJoinAllSpaces]
    window.hidesOnDeactivate = false
    window.contentView = PermissionsViewController().view

    window.makeKeyAndOrderFront(nil)

    Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { timer in
        if permissionGate.hasAccessibility {
            timer.invalidate()
            window.close()
            startFlyd()
        }
    }
}
