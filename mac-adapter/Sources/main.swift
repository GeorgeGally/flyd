import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import SwiftUI

// Top-level `let`s in main.swift run as sequential statements, not hoisted like normal
// globals — this must be bound before any code path (including the early startFlyd()
// check below) can reach launchCore(onExit:), or it's an uninitialized-global crash.
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
// Bound before ensureCoreLaunched() runs below; see the note on coreLogFileURL.
let coreSupervisorQueue = DispatchQueue(label: "flyd.core-supervisor")
let coreSupervisor = CoreSupervisor(
    probe: { done in
        Task {
            let healthy = await flydClient.healthCheck()
            coreSupervisorQueue.async { done(healthy) }
        }
    },
    launch: { onExit in
        launchCore { status in coreSupervisorQueue.async { onExit(status) } }
    },
    schedule: { delay, work in
        coreSupervisorQueue.asyncAfter(deadline: .now() + delay, execute: work)
    },
    log: appendCoreLog
)
let executor = NativeExecutor.shared
let configManager = ConfigManager.shared
let voiceCapture = VoiceCapture.shared
let voiceRelay = VoiceTranscriptionRelay.shared
let dictation = DictationController.shared
let island = DictationPill.shared

let invocationPanel = InvocationPanel()
var activeAugmentPanels: [AugmentPanel] = []
var activeInvocationTask: Task<Void, Never>?
var activeVoiceInvocationId: String?
let voiceConversationId = UUID().uuidString
var voiceTranscriptionTimeout: DispatchWorkItem?
var voiceHoldMonitor: Timer?
var cachedVoiceStatus: FlydClient.VoiceStatusResponse?
var setupWindow: NSWindow?
var coreLaunched = false
var flydStarted = false
var suppressNextShortcutRelease = false
let setupCompletedKey = "FlydSetupCompleted"
let invokeOnLaunch = StartupInvocationPolicy.shouldInvoke(arguments: CommandLine.arguments)

let workInteractionCoordinator = WorkInteractionCoordinator.shared

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
statusItem.onPasteRawDictation = { dictation.pasteLast(raw: true) }
statusItem.onPasteLastDictation = {
    dictation.pasteLast()
}
statusItem.onOpenConversation = {
    ConversationWindow.shared.show()
}
SystemAudioMute.recoverAfterLaunch()
statusItem.start()
ensureCoreLaunched()

// The Conversation window's server runs from launch, so the window opens at once.
let conversationServer = ConversationServer.shared
conversationServer.onReady = { url in
    ConversationWindow.shared.serverReady(url)
    // The notch island follows the conversation: working, replies, decisions.
    ConversationStatus.shared.start(serverURL: url)
}
conversationServer.onFailure = { ConversationWindow.shared.serverFailed($0) }
conversationServer.start()
let conversationHotKey = GlobalHotKey(
    keyCode: GlobalHotKey.conversation.keyCode,
    modifiers: GlobalHotKey.conversation.modifiers,
    id: 1
) {
    ConversationWindow.shared.toggle()
}
NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: nil) { _ in
    conversationServer.stop()
}
/// Opening Flyd again (Dock, Spotlight, `open -a Flyd`) shows the conversation.
final class FlydAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        ConversationServer.appendLog("reopen: showing the conversation")
        ConversationWindow.shared.show()
        return false
    }
}
let appDelegate = FlydAppDelegate()
app.delegate = appDelegate

// Launching Flyd opens the conversation.
DispatchQueue.main.async { ConversationWindow.shared.show() }

// `--conversation-selftest`: close the window, reopen it through the
// menu-bar menu, then check the page and save a snapshot (see ConversationWindow).
if CommandLine.arguments.contains("--conversation-selftest") {
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        ConversationWindow.shared.close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            statusItem.chooseConversationItem()
            ConversationServer.appendLog("conversation selftest: opened from the menu-bar item, visible=\(ConversationWindow.shared.isVisible)")
            ConversationWindow.shared.runSelfTestWhenLoaded()
            // The island: a reply status shows, and clicking it opens the window.
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
                ConversationWindow.shared.close()
                island.show(.status("selftest reply", .reply))
                ConversationServer.appendLog("island selftest: showing=\(String(describing: island.currentPhase)) clickable=\(island.currentPhase != nil)")
                island.onStatusClick?()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    InvocationPanel().renderSnapshotForDiagnostics(
                        to: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".flyd/overlay/ask-flyd-panel.png")
                    )
                    ConversationServer.appendLog("island selftest: after click windowVisible=\(ConversationWindow.shared.isVisible) islandHidden=\(island.currentPhase == nil)")
                }
            }
        }
    }
}

if UserDefaults.standard.bool(forKey: setupCompletedKey), permissionGate.allRequiredGranted() {
    startFlyd(closeSetup: false)
} else {
    showPermissionsWindow()
}

if invokeOnLaunch {
    DispatchQueue.main.asyncAfter(deadline: .now() + StartupInvocationPolicy.acceptanceFocusDelay) {
        guard flydStarted else {
            appendCoreLog("Acceptance invocation blocked: required macOS permissions or setup are incomplete")
            return
        }
        handleInvocation()
    }
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
    ForegroundFeedbackMonitor.shared.start()

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
    stateMachine.onDictationStart = {
        startDictation()
    }
    stateMachine.onDictationStop = {
        dictation.stop()
    }
    stateMachine.onDictationCancel = {
        dictation.cancel()
    }
    stateMachine.onLiveToggle = {
        LiveSessionController.shared.handleToggle()
    }

    invocationPanel.onUndoRequested = { invocationId in
        let undone = executor.undoLast(for: invocationId)
        print("[Flyd] Undo \(invocationId.prefix(8)): \(undone ? "ok" : "failed — target no longer available")")
    }

    workInteractionCoordinator.configure(invocationPanel: invocationPanel, executor: executor)

    stateMachine.start()

    Task {
        let healthy = await flydClient.healthCheck()
        if healthy {
            print("[Flyd] Connected to Flyd Core")
            if let voiceStatus = await flydClient.voiceStatus() {
                await MainActor.run {
                    cachedVoiceStatus = voiceStatus
                    if !voiceStatus.ok {
                        print("[Flyd] Voice setup unavailable: \(voiceStatus.message ?? "unknown")")
                    }
                }
            }
        } else {
            print("[Flyd] Flyd Core not running — pass-through disabled. Invocations will log locally.")
        }
    }

    print("[Flyd] Agent started. Tap fn to dictate (tap again to insert) or hold it to talk, double-tap fn for text, hold ⌃fn for conversation.")
}

func ensureCoreLaunched() {
    guard !coreLaunched else { return }
    coreLaunched = true
    _ = auth.credential()
    CoreLaunchLog.rotateIfNeeded(at: coreLogFileURL)
    coreSupervisorQueue.async { coreSupervisor.start() }
}

func launchCore(onExit: @escaping (Int32) -> Void) -> Bool {
    let process = Process()
    // GUI-launched apps don't inherit the user's shell PATH (no ~/.zshrc, no nvm/homebrew/.local/bin),
    // so `env npm` fails silently. Route through a login shell to pick up the real PATH.
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-l", "-c", "npm run core --silent"]
    process.currentDirectoryURL = URL(fileURLWithPath: resolveCliDir())
    process.environment = ProcessInfo.processInfo.environment

    CoreLaunchLog.rotateIfNeeded(at: coreLogFileURL)
    let logHandle = openCoreLogHandle()
    process.standardOutput = logHandle
    process.standardError = logHandle
    appendCoreLog("Launching Core — cwd=\(resolveCliDir())")

    process.terminationHandler = { proc in
        try? logHandle.close()
        onExit(proc.terminationStatus)
    }

    do {
        try process.run()
        appendCoreLog("Core process started (pid \(process.processIdentifier))")
        return true
    } catch {
        try? logHandle.close()
        appendCoreLog("Could not launch Core: \(error.localizedDescription)")
        return false
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

func handleVoiceInvocation() {
    ShortcutLog.record("handler: talk to Flyd (Fn+Control)")
    if state.mode == .live {
        LiveSessionController.shared.stop()
    }

    suppressNextShortcutRelease = false
    guard state.phase == .idle else { return }

    if let voiceStatus = cachedVoiceStatus, !voiceStatus.ok {
        island.show(.failed(voiceStatus.message ?? "Voice setup needs attention"))
        return
    }

    guard PermissionGate.shared.hasMicrophone else {
        PermissionGate.shared.requestMicrophonePermission()
        island.show(.failed("Microphone permission required"))
        return
    }

    beginVoiceInvocation()
}

func startDictation() {
    ShortcutLog.record("handler: dictation")
    guard state.mode != .live, state.phase == .idle else { return }

    if let voiceStatus = cachedVoiceStatus, !voiceStatus.ok {
        dictation.showBlocked(voiceStatus.message ?? "Voice setup needs attention")
        return
    }

    guard permissionGate.hasMicrophone else {
        permissionGate.requestMicrophonePermission()
        dictation.showBlocked("Microphone permission required")
        return
    }

    dictation.start()
}

/// Fn+Control held: the captain is talking to Flyd, in the background. His
/// words go into the Conversation's message box and are sent on release like
/// a typed message; nothing is raised or focused, so he keeps looking at what
/// he is talking about. The notch pill is the only cue.
func beginVoiceInvocation() {
    let (invocationId, _) = state.startInvocation()
    activeVoiceInvocationId = invocationId

    state.transition(to: .listening)
    island.show(.listening)
    ConversationWindow.shared.voice(.start)

    var heard = ""
    let sessionId = stateMachine.nextTranscriptionSessionId()
    voiceRelay.connect(sessionId: sessionId)
    voiceRelay.onTranscriptDelta = { delta in
        DispatchQueue.main.async {
            heard += delta
            ConversationWindow.shared.voice(.draft(heard))
        }
    }
    voiceRelay.onComplete = { transcript in
        DispatchQueue.main.async {
            clearVoiceTranscriptionTimeout()
            voiceCapture.stop()
            voiceRelay.disconnect()
            let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else {
                cleanupVoiceInvocation(message: "I didn't catch that - try again")
                return
            }
            ConversationWindow.shared.voice(.send(text))
            cleanupVoiceInvocation()
        }
    }
    voiceRelay.onError = { error in
        DispatchQueue.main.async {
            clearVoiceTranscriptionTimeout()
            voiceCapture.stop()
            voiceRelay.disconnect()
            print("[Flyd] Voice transcription error: \(error)")
            cleanupVoiceInvocation(message: VoiceStartupPolicy.message(forTranscriptionError: error))
        }
    }

    voiceCapture.onAudioChunk = { chunk in
        voiceRelay.sendAudioChunk(chunk)
    }
    voiceCapture.onLevel = nil
    voiceCapture.onSpectrum = { bands in
        DispatchQueue.main.async {
            island.updateSpectrum(bands)
        }
    }
    voiceCapture.onError = { error in
        DispatchQueue.main.async {
            print("[Flyd] Voice capture error: \(error)")
            cleanupVoiceInvocation(message: error)
        }
    }

    guard voiceCapture.start() else {
        cleanupVoiceInvocation(message: "The microphone did not start")
        return
    }
    startVoiceHoldMonitor()
}

func handleVoiceRelease() {
    let action = VoiceStartupPolicy.actionOnShortcutRelease(phase: state.phase)

    switch action {
    case .finishRecording:
        stopVoiceHoldMonitor()
        voiceCapture.stop()
        state.transition(to: .transcribing)
        island.show(.working)
        ConversationWindow.shared.voice(.transcribing)
        startVoiceTranscriptionTimeout()
        voiceRelay.commitAudio()
    case .ignore:
        return
    }
}

func startVoiceTranscriptionTimeout() {
    clearVoiceTranscriptionTimeout()

    let timeout = DispatchWorkItem {
        guard state.phase == .transcribing else { return }
        cleanupVoiceInvocation(message: "Voice did not finish - try again")
    }
    voiceTranscriptionTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
}

func clearVoiceTranscriptionTimeout() {
    voiceTranscriptionTimeout?.cancel()
    voiceTranscriptionTimeout = nil
}

func startVoiceHoldMonitor() {
    stopVoiceHoldMonitor()
    voiceHoldMonitor = Timer(timeInterval: 0.05, repeats: true) { _ in
        guard state.phase == .listening else { return }
        let flags = CGEventSource.flagsState(.hidSystemState)
        if !ShortcutRouter.isVoiceChordActive(flags: flags) {
            handleVoiceRelease()
        }
    }
    if let voiceHoldMonitor {
        RunLoop.main.add(voiceHoldMonitor, forMode: .common)
    }
}

func stopVoiceHoldMonitor() {
    voiceHoldMonitor?.invalidate()
    voiceHoldMonitor = nil
}

func cleanupVoiceInvocation(message: String? = nil) {
    clearVoiceTranscriptionTimeout()
    stopVoiceHoldMonitor()
    voiceCapture.stop()
    resetVoiceCaptureCallbacks()
    voiceRelay.disconnect()
    activeVoiceInvocationId = nil
    activeInvocationTask?.cancel()
    activeInvocationTask = nil
    state.cancelInvocation()
    stateMachine.cancel()
    executor.clearInvocationRefs()

    // Push-to-talk lives in the Conversation window: a problem is said there,
    // and a finished or abandoned recording leaves the message box as it was.
    if let message {
        ConversationWindow.shared.voice(.fail(message))
        island.show(.failed(message))
    } else {
        ConversationWindow.shared.voice(.cancel)
        island.hide()
    }
}

func handleShortcutPress() {
    guard state.phase != .idle else { return }

    dictation.cancel()
    island.hide()
    suppressNextShortcutRelease = true
    activeInvocationTask?.cancel()
    state.cancelInvocation()
    stateMachine.cancel()
    invocationPanel.dismiss()
    activeAugmentPanels.forEach { $0.dismiss() }
    activeAugmentPanels.removeAll()
    workInteractionCoordinator.cancelActiveInvocation()
    clearVoiceTranscriptionTimeout()
    voiceCapture.stop()
    resetVoiceCaptureCallbacks()
    stopVoiceHoldMonitor()
    voiceRelay.disconnect()
    activeVoiceInvocationId = nil
    executor.clearInvocationRefs()
}

func resetVoiceCaptureCallbacks() {
    voiceCapture.onAudioChunk = nil
    voiceCapture.onLevel = nil
    voiceCapture.onSpectrum = nil
    voiceCapture.onError = nil
}

func handleInvocation() {
    ShortcutLog.record("handler: text bar (Ask Flyd)")
    if state.mode == .live {
        LiveSessionController.shared.stop()
    }

    let currentPhase = state.phase

    if currentPhase != .idle {
        activeInvocationTask?.cancel()
        state.cancelInvocation()
        stateMachine.cancel()
        invocationPanel.dismiss()
        workInteractionCoordinator.cancelActiveInvocation()
        return
    }

    if workInteractionCoordinator.isActive {
        let workSession = stateMachine.ensureWorkSession()
        stateMachine.setRevision(workSession.revision)
        invocationPanel.updateState(.workSession(
            diagnosis: "Continue working on this",
            pendingAction: nil
        ))
        invocationPanel.show()
        invocationPanel.onIntentSubmitted = { intent in
            invocationPanel.updateState(.processing)
            let (invocationId, revision) = state.startInvocation()
            stateMachine.setRevision(revision)
            activeInvocationTask = Task {
                await processInvocation(
                    invocationId: invocationId,
                    revision: revision,
                    modality: "text",
                    intent: intent,
                    conversationId: voiceConversationId
                )
            }
        }
        invocationPanel.onCancelled = {
            activeInvocationTask?.cancel()
            state.cancelInvocation()
            stateMachine.cancel()
            executor.clearInvocationRefs()
            workInteractionCoordinator.cancelActiveInvocation()
        }
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

func processInvocation(
    invocationId: String,
    revision: Int,
    modality: String,
    intent: String,
    conversationId: String? = nil
) async {
    let traceStart = Date()

    stateMachine.captureIntent(intent: intent)

    let tCapture = Date().timeIntervalSince(traceStart)

    if stateMachine.hasFocusDrift() {
        print("[Flyd] WARNING: Focus drifted between t₀ and t₁")
    }

    let environment = accessibilityInspector.captureEnvironment() ?? EnvironmentState.fallback(
        application: applicationMonitor.foregroundApp,
        reason: "Focused element unavailable"
    )
    let usedFallbackEnvironment = environment.focusedElement.role == "AXUnknown"

    state.transition(to: .resolving)

    if !stateMachine.verifyPreExecution() {
        print("[Flyd] WARNING: App/window changed before execution")
    }

    let contextSources = [
        "app:\(environment.application.bundleId)",
        "element:\(environment.focusedElement.role)",
        "sufficiency:\(environment.sufficiency.rawValue)",
    ]

    if usedFallbackEnvironment {
        print("[Flyd] Focused element unavailable — continuing with partial environment")
    }

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

    guard await flydClient.waitForHealth(timeoutSeconds: 4) else {
        print("[Flyd] Flyd Core is not ready — cannot resolve")

        auditRecorder.record(
            invocationId: invocationId,
            contextSources: contextSources,
            error: "Flyd Core not ready"
        )

        await MainActor.run {
            showInvocationError("Flyd is starting - try again in a moment", modality: modality)
            state.transition(to: .present)
            executor.clearInvocationRefs()
            stateMachine.resetCheckpoints()
        }
        return
    }

    let screenshotBase64 = await stateMachine.invocationScreenshotBase64()
    if screenshotBase64 == nil {
        print("[Flyd] No screen capture available for this invocation — resolving without vision")
    }

    let workSession = stateMachine.ensureWorkSession()
    let response = await flydClient.sendManifest(
        invocationId: invocationId,
        environmentRevision: revision,
        environment: environment,
        intent: intent,
        modality: modality,
        screenshot: screenshotBase64,
        conversationId: conversationId,
        fingerprint: fingerprint,
        documentPath: environment.documentPath,
        browserURL: environment.browserURL,
        displayID: environment.displayID,
        screenshotBounds: environment.screenshotBounds ?? ScreenCaptureManager.shared.capturedDisplayBounds,
        focusedElementBounds: accessibilityInspector.focusedElementBounds,
        selectedRangeBounds: accessibilityInspector.selectedRangeBounds,
        editable: accessibilityInspector.editable,
        workSessionId: workSession.sessionId,
        workSessionRevision: workSession.revision
    )

    guard !Task.isCancelled, FlydState.shared.invocationId == invocationId else {
        print("[Flyd] Invocation \(invocationId.prefix(8)) cancelled during resolution")
        return
    }

    guard let resolution = response else {
        print("[Flyd] No response from Flyd Core — cannot resolve")

        auditRecorder.record(
            invocationId: invocationId,
            contextSources: contextSources,
            error: "Flyd Core unreachable"
        )

        await MainActor.run {
            showInvocationError("Flyd did not answer in time - try again", modality: modality)
            state.transition(to: .present)
            executor.clearInvocationRefs()
            stateMachine.resetCheckpoints()
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
            showInvocationError(ResolutionDisplayPolicy.superseded, modality: modality)
            state.transition(to: .present)
            executor.clearInvocationRefs()
            stateMachine.resetCheckpoints()
        }
        return
    }

    if let failure = ResolutionDisplayPolicy.failure(for: resolution) {
        print("[Flyd] Resolution \(resolution.mode) has nothing to show")
        auditRecorder.record(
            invocationId: invocationId,
            contextSources: contextSources,
            error: "Nothing to show for \(resolution.mode)"
        )
        await MainActor.run {
            showInvocationError(failure, modality: modality)
            state.transition(to: .present)
            executor.clearInvocationRefs()
            stateMachine.resetCheckpoints()
        }
        return
    }

    switch resolution.mode {
    case "native":
        var reasons: [ConfirmationDecision.Reason] = []
        if resolution.requiresConfirmation == true {
            reasons.append(.executionConsequence)
        }
        for op in resolution.operations {
            if executor.requiresReplacementConfirmation(kind: op.kind, text: op.text) {
                reasons.append(.destructiveReplacement)
                break
            }
        }
        let decision = ConfirmationDecision(reasons: reasons)
        if decision.requiresConfirmation {
            let confirmed = await requestCombinedConfirmation(
                rationale: resolution.rationale,
                reasons: decision.reasons
            )
            guard confirmed else {
                await flydClient.sendOutcome(
                    resolutionId: resolution.resolutionId,
                    invocationId: resolution.invocationId,
                    status: "rejected",
                    correction: "Confirmation denied by user"
                )
                await MainActor.run {
                    invocationPanel.dismiss()
                    island.hide()
                    state.transition(to: .present)
                }
                return
            }
        }
        let results = await executeNativeOperations(resolution: resolution, fingerprint: fingerprint)
        await MainActor.run {
            let preview = results
                .map { result in
                    result.success
                        ? "\(result.kind): \"\(result.text.prefix(60))\(result.text.count > 60 ? "..." : "")\""
                        : result.message
                }
                .joined(separator: ", ")
            if modality == "voice" {
                island.show(results.contains(where: \.success) ? .inserted : .failed(preview))
            } else if results.contains(where: \.success) {
                invocationPanel.updateState(.undoAvailable(invocationId: invocationId, preview: preview))
            } else {
                invocationPanel.updateState(.error(message: preview))
            }
        }

        if modality == "voice", ConfigManager.shared.config.replyMode == .voice {
            let spokenText = results.filter(\.success).map(\.text).joined(separator: ". ")
            if !spokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if let audio = await flydClient.speak(text: spokenText) {
                    await MainActor.run {
                        SpeechPlayer.shared.play(audio)
                    }
                }
            }
        }

    case "requires_augment":
        await showAugmentations(
            invocationId: invocationId,
            resolution: resolution,
            fingerprint: fingerprint
        )

        if modality == "voice", ConfigManager.shared.config.replyMode == .voice {
            let spokenText = (resolution.augmentations ?? [])
                .filter { $0.kind == "explanation" }
                .map(\.content)
                .joined(separator: ". ")
            if !spokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if let audio = await flydClient.speak(text: spokenText) {
                    await MainActor.run {
                        SpeechPlayer.shared.play(audio)
                    }
                }
            }
        }

    case "requires_compose":
        print("[Flyd] Compose requested: \(resolution.composeRationale ?? "no rationale")")
        await MainActor.run {
            if let url = resolution.composeUrl, let surfaceURL = URL(string: url) {
                NSWorkspace.shared.open(surfaceURL)
            } else {
                print("[Flyd] No compose URL returned — opening surface")
                if let surfaceURL = URL(string: "http://127.0.0.1:3000/surface") {
                    NSWorkspace.shared.open(surfaceURL)
                }
            }
        }

    case "work_intelligence":
        print("[Flyd] Work intelligence response received")
        await MainActor.run {
            workInteractionCoordinator.renderWorkIntelligence(
                invocationId: invocationId,
                invocationRevision: revision,
                response: resolution
            )
            let diagnosisText = resolution.diagnosis?.primaryIssue.finding ?? "Work session active"
            let pending = resolution.intervention?.proposedAction?.description
            invocationPanel.updateState(.workSession(diagnosis: diagnosisText, pendingAction: pending))
        }

    case "requires_execution":
        print("[Flyd] Shell execution requested")
        await MainActor.run {
            workInteractionCoordinator.renderExecutionCards(
                invocationId: invocationId,
                resolution: resolution
            )
        }

    case "requires_surface":
        // "Open Flyd" and the like: Core asked for a native surface, not an answer.
        await MainActor.run {
            invocationPanel.dismiss()
            island.hide()
            state.transition(to: .present)
            if resolution.surface == "conversation" {
                ConversationWindow.shared.show()
            }
        }

    case "requires_task":
        print("[Flyd] Task plan requested")
        await MainActor.run {
            workInteractionCoordinator.renderTaskPlan(
                invocationId: invocationId,
                resolution: resolution
            )
        }

    default:
        break
    }

    auditRecorder.record(
        invocationId: invocationId,
        contextSources: contextSources,
        error: nil
    )

    let traceTotal = Date().timeIntervalSince(traceStart)
    print("[Flyd Trace] \(invocationId.prefix(8)): capture=\(String(format: "%.0f", tCapture*1000))ms total=\(String(format: "%.0f", traceTotal*1000))ms")

    executor.clearInvocationRefs()
    stateMachine.resetCheckpoints()

    await MainActor.run {
        if modality == "voice" {
            if resolution.mode != "native" { island.hide() }
        } else {
            invocationPanel.dismissUnlessShowingResult()
        }
        state.transition(to: .present)
    }
}

/// Voice questions report in the notch island; typed ones in the text bar they came from.
@MainActor
func showInvocationError(_ message: String, modality: String) {
    if modality == "voice" {
        island.show(.failed(message))
    } else {
        invocationPanel.updateState(.error(message: message))
    }
}

func executeNativeOperations(
    resolution: FlydClient.ResolutionResponse,
    fingerprint: InvocationFingerprint,
    observedTarget: ObservedTarget? = nil
) async -> [(success: Bool, kind: String, text: String, message: String)] {
    var results: [(success: Bool, kind: String, text: String, message: String)] = []

    if let target = observedTarget {
        if !executor.verifyObservedTarget(target) {
            print("[Flyd] Aborting LIVE execution: target verification failed")
            for _ in resolution.operations {
                await flydClient.sendOutcome(
                    resolutionId: resolution.resolutionId,
                    invocationId: resolution.invocationId,
                    status: "failed",
                    correction: "Target verification failed — app or window changed"
                )
            }
            return results
        }
    } else {
        guard InvocationStateMachine.shared.verifyPreExecution() else {
            print("[Flyd] Aborting: target no longer available")
            let fallbackText = resolution.operations.map(\.text).joined(separator: "\n\n")
            if !fallbackText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                await copyTextToClipboard(fallbackText)
                results.append((success: false, kind: "clipboard", text: fallbackText, message: "Target changed - copied result to clipboard"))
            }
            await flydClient.sendOutcome(
                resolutionId: resolution.resolutionId,
                invocationId: resolution.invocationId,
                status: "failed",
                correction: "Target no longer available — app or window changed"
            )
            return results
        }
    }

    for op in resolution.operations {
        let resolved = ResolvedOperation(target: op.target, kind: op.kind, text: op.text)
        let result = await executor.execute(operation: resolved, fingerprint: fingerprint)

        let verificationPayload: FlydClient.VerificationEvidencePayload?
        if let evidence = result.verificationEvidence {
            verificationPayload = FlydClient.VerificationEvidencePayload(
                preValueDigest: evidence.preValueDigest,
                postValue: evidence.postValue,
                postValueDigest: evidence.postValueDigest,
                changed: evidence.changed
            )
        } else {
            verificationPayload = nil
        }

        if result.success {
            results.append((success: true, kind: op.kind, text: op.text, message: ""))
            print("[Flyd] Executed: \(op.kind) → \(op.text.prefix(40))...")
            if let v = verificationPayload {
                print("[Flyd] Verification: preDigest=\(v.preValueDigest?.prefix(8) ?? "nil") postDigest=\(v.postValueDigest?.prefix(8) ?? "nil") changed=\(v.changed)")
            }
            print("[Flyd] Undo available for invocation \(resolution.invocationId.prefix(8))")
        } else {
            await copyTextToClipboard(op.text)
            results.append((success: false, kind: op.kind, text: op.text, message: "Insert failed - copied result to clipboard"))
            print("[Flyd] Failed: \(op.kind) — \(result.error ?? "unknown error")")
        }

        await flydClient.sendOutcome(
            resolutionId: resolution.resolutionId,
            invocationId: resolution.invocationId,
            status: result.success ? "succeeded" : "failed",
            correction: result.error,
            verification: verificationPayload
        )
    }
    return results
}

func copyTextToClipboard(_ text: String) async {
    await MainActor.run {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

func requestCombinedConfirmation(rationale: String, reasons: [ConfirmationDecision.Reason]) async -> Bool {
    let reasonText = reasons.map { $0.displayName }.joined(separator: ", ")
    return await withCheckedContinuation { continuation in
        Task { @MainActor in
            let alert = NSAlert()
            alert.messageText = "Flyd wants to modify content"
            alert.informativeText = "\(rationale)\n\nReasons: \(reasonText). Allow?"
            alert.alertStyle = .warning
            alert.addButton(withTitle: "Allow")
            alert.addButton(withTitle: "Cancel")
            let response = alert.runModal()
            continuation.resume(returning: response == .alertFirstButtonReturn)
        }
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
