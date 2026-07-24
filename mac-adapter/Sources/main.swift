import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import SwiftUI

// Top-level `let`s in main.swift run as sequential statements, not hoisted like normal
// globals — this must be bound before any code path (including the early startFlyd()
// check below) can reach launchCore(), or it's an uninitialized-global crash.
let coreLogFileURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".flyd/overlay/core-launch.log", isDirectory: false)

func openCoreLogHandle() -> FileHandle {
    let directoryURL = coreLogFileURL.deletingLastPathComponent()
    try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: coreLogFileURL.path) {
        FileManager.default.createFile(atPath: coreLogFileURL.path, contents: nil)
    }
    let handle = (try? FileHandle(forWritingTo: coreLogFileURL)) ?? FileHandle.nullDevice
    handle.seekToEndOfFile()
    return handle
}

func appendCoreLog(_ message: String) {
    print("[Flyd] \(message)")
    let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
    guard let data = line.data(using: .utf8) else { return }
    let handle = openCoreLogHandle()
    handle.write(data)
    try? handle.close()
}

if CommandLine.arguments.contains("--permission-diagnostic") {
    printPermissionDiagnostic()
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

if !isRunningFromAppBundle() {
    openInstalledAppFromRawExecutable()
    exit(0)
}

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
let voiceCapture = VoiceCapture.shared
let voiceRelay = VoiceTranscriptionRelay.shared
let liveBridge = LiveAudioBridge.shared

let invocationPanel = InvocationPanel()
var activeInvocationTask: Task<Void, Never>?
var setupWindow: NSWindow?
var flydStarted = false
var suppressNextShortcutRelease = false
let setupCompletedKey = "FlydSetupCompleted"

statusItem.onInvoke = {
    if !flydStarted {
        startFlyd(closeSetup: false)
    }
    if flydStarted {
        handleInvocation()
    }
}
statusItem.onOpenSetup = {
    showPermissionsWindow()
}
statusItem.onRestartFlyd = {
    restartFlyd()
}
statusItem.start()

if UserDefaults.standard.bool(forKey: setupCompletedKey), permissionGate.allRequiredGranted() {
    startFlyd(closeSetup: false)
} else {
    showPermissionsWindow()
}

app.run()

func startFlyd(closeSetup: Bool = true) {
    permissionGate.writeDiagnosticSnapshot()

    if flydStarted {
        if closeSetup {
            setupWindow?.close()
        }
        return
    }

    guard permissionGate.allRequiredGranted() else {
        showPermissionsWindow()
        return
    }

    flydStarted = true
    if closeSetup {
        setupWindow?.close()
    }

    _ = auth.credential()

    statusItem.start()
    overlayWindow.create()

    applicationMonitor.start()
    accessibilityInspector.start()

    stateMachine.onShortcutPressed = {
        handleShortcutPress()
    }
    stateMachine.onShortcutReleased = {
        if suppressNextShortcutRelease {
            suppressNextShortcutRelease = false
            return
        }

        if stateMachine.isVoiceInvocation {
            handleVoiceRelease()
        } else {
            handleInvocation()
        }
    }
    stateMachine.onShortcutHoldDetected = {
        handleVoiceInvocation()
    }

    stateMachine.onVoiceIntentReady = { transcript in
        let (invocationId, revision) = state.startInvocation()
        stateMachine.setRevision(revision)
        stateMachine.startPrewarm()
        if let element = accessibilityInspector.capturedAXElement() {
            executor.registerElement(ref: "el_01", element: element)
        }
        invocationPanel.updateState(.processing)
        activeInvocationTask = Task {
            await processInvocation(invocationId: invocationId, revision: revision, modality: "voice", intent: transcript)
        }
    }

    stateMachine.onLiveEnter = {
        handleLiveEnter()
    }

    stateMachine.onLiveExit = {
        handleLiveExit()
    }

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
    // GUI-launched apps don't inherit the user's shell PATH (no ~/.zshrc, no nvm/homebrew/.local/bin),
    // so `env npm` fails silently. Route through a login shell to pick up the real PATH.
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-l", "-c", "npm run core --silent"]
    process.currentDirectoryURL = URL(fileURLWithPath: resolveCliDir())
    process.environment = ProcessInfo.processInfo.environment

    let logHandle = openCoreLogHandle()
    process.standardOutput = logHandle
    process.standardError = logHandle
    appendCoreLog("Launching Core — cwd=\(resolveCliDir())")

    process.terminationHandler = { proc in
        appendCoreLog("Core exited with status \(proc.terminationStatus)")
        if proc.terminationStatus != 0 {
            appendCoreLog("Restarting in 2s...")
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                launchCore()
            }
        }
    }

    do {
        try process.run()
        appendCoreLog("Core process started (pid \(process.processIdentifier))")
    } catch {
        appendCoreLog("Could not launch Core: \(error.localizedDescription)")
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
    // The installed app in ~/Applications is copied out of the repo, so walking up from
    // its own bundle path can never find cli/package.json. The Makefile bakes the real
    // repo path in at build time (FlydRepoRoot) — trust that first.
    if let bakedRoot = Bundle.main.infoDictionary?["FlydRepoRoot"] as? String,
       FileManager.default.fileExists(atPath: bakedRoot + "/cli/package.json") {
        return bakedRoot
    }

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

func handleLiveEnter() {
    if !PermissionGate.shared.hasMicrophone {
        PermissionGate.shared.requestMicrophonePermission()
    }

    state.transition(to: .live)
    _ = liveBridge.start()

    liveBridge.onResolveOperations = { callId, ops in
        Task {
            let (_, revision) = state.startInvocation()
            stateMachine.setRevision(revision)

            var outcomeStatus = "succeeded"
            for opDict in ops {
                guard let target = opDict["target"] as? String,
                      let kind = opDict["kind"] as? String,
                      let text = opDict["text"] as? String else { continue }

                guard target == "el_01" else { outcomeStatus = "failed"; continue }
                guard InvocationStateMachine.shared.verifyPreExecution() else { outcomeStatus = "failed"; continue }

                let resolved = ResolvedOperation(target: target, kind: kind, text: text)
                let fp = InvocationFingerprint(app: "flyd-live", surface: nil, window: "live_01", element: "el_01", capturedAt: Date())
                let result = await executor.execute(operation: resolved, fingerprint: fp)
                if !result.success { outcomeStatus = "failed" }
                print("[Flyd LIVE] \(kind) → \(result.success ? "ok" : "FAIL: \(result.error ?? "")")")
            }

            print("[Flyd LIVE] Resolve complete — \(outcomeStatus)")
        }
    }

    liveBridge.onError = { error in
        print("[Flyd LIVE] Error: \(error)")
    }

    print("[Flyd] LIVE session entered")
}

func handleLiveExit() {
    liveBridge.stop()
    voiceCapture.stop()
    voiceRelay.disconnect()
    state.transition(to: .present)
    print("[Flyd] LIVE session exited")
}

func handleVoiceInvocation() {
    guard state.phase == .idle else { return }

    guard PermissionGate.shared.hasMicrophone else {
        PermissionGate.shared.requestMicrophonePermission()
        invocationPanel.show()
        invocationPanel.updateState(.error(message: "Microphone permission required for voice"))
        return
    }

    let (invocationId, revision) = state.startInvocation()
    stateMachine.setRevision(revision)
    stateMachine.startPrewarm()

    if let element = accessibilityInspector.capturedAXElement() {
        executor.registerElement(ref: "el_01", element: element)
    }

    state.transition(to: .listening)
    invocationPanel.show()
    invocationPanel.updateState(.recording)

    let sessionId = stateMachine.nextTranscriptionSessionId()
    voiceRelay.connect(sessionId: sessionId)
    voiceRelay.onTranscriptDelta = { delta in
        DispatchQueue.main.async {
            invocationPanel.fillIntent(invocationPanel.currentIntent + delta)
        }
    }
    voiceRelay.onComplete = { [weak self] transcript in
        DispatchQueue.main.async {
            voiceCapture.stop()
            voiceRelay.disconnect()

            let state = self
            let isDictation = VoiceIntentRouter.isPlainDictation(transcript)
            let hasSelection = VoiceIntentRouter.hasSelectedText(transcript)
            let focusedEditable = accessibilityInspector.captureFocusedElement() != nil
                && NativeExecutor.safeEditableRoles.contains(accessibilityInspector.captureFocusedElement()?.role ?? "")

            if isDictation && focusedEditable && !hasSelection {
                invocationPanel.updateState(.executing)
                Task {
                    let fingerprint = InvocationFingerprint(
                        app: ApplicationMonitor.shared.foregroundApp?.bundleId ?? "unknown",
                        surface: nil, window: "win_01", element: "el_01", capturedAt: Date()
                    )
                    let op = ResolvedOperation(target: "el_01", kind: "insert_text", text: transcript)
                    let result = await executor.execute(operation: op, fingerprint: fingerprint)
                    if result.success {
                        print("[Flyd] Voice dictation inserted directly: \(transcript.prefix(40))...")
                        await MainActor.run {
                            state.transition(to: .present)
                            invocationPanel.dismiss()
                            executor.clearInvocationRefs()
                            stateMachine.resetCheckpoints()
                        }
                    } else {
                        print("[Flyd] Voice dictation failed: \(result.error ?? "") — falling back to Core")
                        invocationPanel.updateState(.resolving)
                        let (invocationId, revision) = state.startInvocation()
                        stateMachine.setRevision(revision)
                        stateMachine.startPrewarm()
                        if let element = accessibilityInspector.capturedAXElement() {
                            executor.registerElement(ref: "el_01", element: element)
                        }
                        activeInvocationTask = Task {
                            await processInvocation(invocationId: invocationId, revision: revision, modality: "voice", intent: transcript)
                        }
                    }
                }
            } else {
                invocationPanel.updateState(.resolving)
                let (invocationId, revision) = state.startInvocation()
                stateMachine.setRevision(revision)
                stateMachine.startPrewarm()
                if let element = accessibilityInspector.capturedAXElement() {
                    executor.registerElement(ref: "el_01", element: element)
                }
                activeInvocationTask = Task {
                    await processInvocation(invocationId: invocationId, revision: revision, modality: "voice", intent: transcript)
                }
            }
        }
    }
    voiceRelay.onError = { error in
        DispatchQueue.main.async {
            voiceCapture.stop()
            voiceRelay.disconnect()
            print("[Flyd] Voice transcription error: \(error)")
            let isConnectionFailure = error.localizedCaseInsensitiveContains("connect")
            let message = isConnectionFailure
                ? "Flyd Core isn't running — try typing instead"
                : "Voice error — try typing instead"
            invocationPanel.updateState(.error(message: message))
        }
    }

    voiceCapture.onAudioChunk = { chunk in
        voiceRelay.sendAudioChunk(chunk)
    }

    voiceCapture.onError = { error in
        DispatchQueue.main.async {
            print("[Flyd] Voice capture error: \(error)")
            invocationPanel.updateState(.error(message: error))
        }
    }

    _ = voiceCapture.start()
}

func handleVoiceRelease() {
    voiceRelay.commitAudio()
}

func handleShortcutPress() {
    guard state.phase != .idle else { return }

    suppressNextShortcutRelease = true
    activeInvocationTask?.cancel()
    state.cancelInvocation()
    stateMachine.cancel()
    invocationPanel.dismiss()
    voiceCapture.stop()
    voiceRelay.disconnect()
    executor.clearInvocationRefs()
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
        invocationPanel.updateState(.processing)
        activeInvocationTask = Task { await processInvocation(invocationId: invocationId, revision: revision, modality: "text", intent: intent) }
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

func processInvocation(invocationId: String, revision: Int, modality: String, intent: String) async {
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
        modality: modality,
        fingerprint: fingerprint
    )

    guard let resolution = response else {
        print("[Flyd] No response from Flyd Core — running locally")

        let isDictation = modality == "voice" && VoiceIntentRouter.isPlainDictation(intent)
        let hasSelection = VoiceIntentRouter.hasSelectedText(intent)
        let focusedEditable = environment.focusedElement.role != "unknown"
            && NativeExecutor.safeEditableRoles.contains(environment.focusedElement.role)

        if isDictation && focusedEditable && !hasSelection {
            let op = ResolvedOperation(target: "el_01", kind: "insert_text", text: intent)
            let fp = InvocationFingerprint(
                app: environment.application.bundleId,
                surface: environment.surface?.host,
                window: "win_01",
                element: "el_01",
                capturedAt: Date()
            )
            let result = await executor.execute(operation: op, fingerprint: fp)
            if result.success {
                print("[Flyd] Voice dictation fallback inserted: \(intent.prefix(40))...")
                auditRecorder.record(
                    invocationId: invocationId,
                    contextSources: contextSources,
                    error: "Core unreachable — inserted raw transcript"
                )
            } else {
                print("[Flyd] Voice dictation fallback failed: \(result.error ?? "unknown")")
                auditRecorder.record(
                    invocationId: invocationId,
                    contextSources: contextSources,
                    error: "Core unreachable — fallback also failed: \(result.error ?? "")"
                )
            }
        } else {
            auditRecorder.record(
                invocationId: invocationId,
                contextSources: contextSources,
                error: "Flyd Core unreachable"
            )

            await MainActor.run {
                invocationPanel.updateState(.error(message: "Flyd Core isn't running — try again in a moment"))
            }
        }

        await MainActor.run {
            state.transition(to: .present)
            executor.clearInvocationRefs()
            stateMachine.resetCheckpoints()
            invocationPanel.dismiss()
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
            invocationPanel.dismiss()
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
        invocationPanel.dismiss()
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
    if let window = setupWindow {
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        return
    }

    let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 740, height: 680),
        styleMask: [.titled, .closable, .miniaturizable],
        backing: .buffered,
        defer: false
    )
    window.title = "Flyd Setup"
    window.center()
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [.moveToActiveSpace]
    window.contentViewController = PermissionsViewController(
        onContinue: {
            UserDefaults.standard.set(true, forKey: setupCompletedKey)
            startFlyd()
        },
        onQuit: {
            NSApplication.shared.terminate(nil)
        }
    )

    setupWindow = window
    NSApplication.shared.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
}

func restartFlyd() {
    if let bundleURL = Bundle.main.bundleURL as URL? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-n", bundleURL.path]
        try? process.run()
    }
    NSApplication.shared.terminate(nil)
}

func isRunningFromAppBundle() -> Bool {
    Bundle.main.bundleURL.pathExtension == "app"
}

func openInstalledAppFromRawExecutable() {
    let installedAppURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Applications/Flyd.app")

    if FileManager.default.fileExists(atPath: installedAppURL.path) {
        NSWorkspace.shared.open(installedAppURL)
        print("[Flyd] Opened installed Flyd.app. Run `make run` from mac-adapter instead of launching .build/release/FlydMacAdapter directly.")
    } else {
        print("[Flyd] Flyd must run from an app bundle for macOS permissions. Run `make install` from mac-adapter first.")
    }
}

func printPermissionDiagnostic() {
    let bundleURL = Bundle.main.bundleURL.path
    let bundleIdentifier = Bundle.main.bundleIdentifier ?? "none"
    let executableURL = Bundle.main.executableURL?.path ?? "none"
    let accessibility = AXIsProcessTrusted()
    let screenRecording = CGPreflightScreenCaptureAccess()

    print("bundleURL=\(bundleURL)")
    print("bundleIdentifier=\(bundleIdentifier)")
    print("executableURL=\(executableURL)")
    print("accessibility=\(accessibility)")
    print("screenRecording=\(screenRecording)")
}
