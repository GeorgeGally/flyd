import AppKit

/// One dictation, from the first fn edge to text in the focused app. All calls arrive on
/// the main thread (event-tap callbacks and relay completions are dispatched there).
final class DictationController {
    static let shared = DictationController()

    private struct Session {
        let invocationId: String
        let bundleId: String
        let startedAt: TimeInterval
        var peakLevel: Float = 0
        var targetPid: pid_t?
    }

    private enum Phase {
        case idle
        case recording(Session)
        case transcribing(Session)
        case inserting
    }

    static let maxRecording: TimeInterval = 300
    private static let transcriptionTimeout: TimeInterval = 20

    private var phase: Phase = .idle
    private let pill = DictationPill()
    private var timeout: DispatchWorkItem?
    private var recordingCap: DispatchWorkItem?
    /// The last dictated text, so a paste that landed in the wrong place can be redone.
    /// Memory only: never written to disk, the journal or Flyd's memory.
    private var lastText: String?

    private let state = FlydState.shared
    private let capture = VoiceCapture.shared
    private let relay = VoiceTranscriptionRelay.shared
    private let stateMachine = InvocationStateMachine.shared

    func start() {
        guard case .idle = phase else { return }
        let (invocationId, _) = state.startInvocation()
        let session = Session(
            invocationId: invocationId,
            bundleId: NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown",
            startedAt: ProcessInfo.processInfo.systemUptime
        )
        phase = .recording(session)
        state.transition(to: .listening)
        pill.show(.listening)

        let bundleId = session.bundleId
        relay.connect(sessionId: stateMachine.nextTranscriptionSessionId()) {
            var app: [String: Any] = ["bundleId": bundleId]
            if let title = AccessibilityInspector.shared.focusedWindowTitle(), !title.isEmpty {
                app["windowTitle"] = title
            }
            return ["purpose": "dictation", "app": app]
        }
        relay.onTranscriptDelta = nil
        relay.onComplete = { [weak self] transcript in self?.transcribed(transcript) }
        relay.onError = { [weak self] error in
            self?.fail(VoiceStartupPolicy.message(forTranscriptionError: error))
        }

        capture.onAudioChunk = { [relay] chunk in relay.sendAudioChunk(chunk) }
        capture.onLevel = { [weak self] level in
            DispatchQueue.main.async { self?.heard(level) }
        }
        capture.onSpectrum = { [weak self] bands in
            DispatchQueue.main.async { self?.pill.updateSpectrum(bands) }
        }
        capture.onError = { [weak self] error in
            DispatchQueue.main.async { self?.fail(error) }
        }

        guard capture.start() else {
            fail("Microphone unavailable")
            return
        }

        let cap = DispatchWorkItem { [weak self] in
            self?.stop()
            self?.stateMachine.endDictationGesture()
        }
        recordingCap = cap
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.maxRecording, execute: cap)
    }

    func stop() {
        guard case .recording(var session) = phase else { return }
        session.targetPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
        stopCapture()

        let duration = ProcessInfo.processInfo.systemUptime - session.startedAt
        guard SpeechGate.heardSpeech(duration: duration, peakLevel: session.peakLevel) else {
            finishWithoutSpeech(session)
            return
        }
        phase = .transcribing(session)
        state.transition(to: .transcribing)
        pill.show(.working)

        let timeout = DispatchWorkItem { [weak self] in self?.fail("Dictation did not finish — try again") }
        self.timeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.transcriptionTimeout, execute: timeout)
        relay.commitAudio()
    }

    /// Discards the recording; nothing is sent for transcription or inserted.
    func cancel() {
        switch phase {
        case .idle, .inserting:
            return
        case .recording, .transcribing:
            teardown()
            pill.hide()
            state.cancelInvocation()
            phase = .idle
        }
    }

    func pasteLast() {
        guard case .idle = phase else { return }
        guard let text = lastText else {
            pill.show(.notice("Nothing dictated yet"))
            return
        }
        Task { @MainActor in
            let outcome = await TextInserter.insert(text, targetPid: nil)
            self.pill.show(Self.pillPhase(for: outcome))
        }
    }

    /// Shows a problem before any recording started (setup, permissions).
    func showBlocked(_ message: String) {
        guard case .idle = phase else { return }
        pill.show(.failed(message))
    }

    private func heard(_ level: Float) {
        guard case .recording(var session) = phase else { return }
        session.peakLevel = max(session.peakLevel, level)
        phase = .recording(session)
    }

    /// Core answers with an empty transcript when it judged the audio to be silence.
    private func transcribed(_ transcript: String) {
        guard case .transcribing(let session) = phase else { return }

        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            finishWithoutSpeech(session)
            return
        }
        teardown()

        lastText = text
        phase = .inserting
        state.transition(to: .executing)
        Task { @MainActor in
            let outcome = await TextInserter.insert(text, targetPid: session.targetPid)
            AuditRecorder.shared.record(
                invocationId: session.invocationId,
                contextSources: ["dictation", "app:\(session.bundleId)", "outcome:\(Self.auditName(outcome))"]
            )
            self.pill.show(Self.pillPhase(for: outcome))
            self.state.transition(to: .present)
            self.phase = .idle
        }
    }

    private func finishWithoutSpeech(_ session: Session) {
        AuditRecorder.shared.record(
            invocationId: session.invocationId,
            contextSources: ["dictation", "app:\(session.bundleId)", "outcome:no-speech"]
        )
        teardown()
        pill.show(.notice("No speech"))
        state.cancelInvocation()
        phase = .idle
    }

    private func fail(_ message: String) {
        switch phase {
        case .idle, .inserting:
            return
        case .recording(let session), .transcribing(let session):
            AuditRecorder.shared.record(
                invocationId: session.invocationId,
                contextSources: ["dictation", "app:\(session.bundleId)"],
                error: message
            )
        }
        teardown()
        stateMachine.endDictationGesture()
        pill.show(.failed(message))
        state.cancelInvocation()
        phase = .idle
    }

    private func stopCapture() {
        recordingCap?.cancel()
        recordingCap = nil
        capture.stop()
        capture.onAudioChunk = nil
        capture.onLevel = nil
        capture.onSpectrum = nil
        capture.onError = nil
    }

    private func teardown() {
        timeout?.cancel()
        timeout = nil
        stopCapture()
        relay.onComplete = nil
        relay.onError = nil
        relay.disconnect()
    }

    static func pillPhase(for outcome: InsertOutcome) -> DictationPill.Phase {
        switch outcome {
        case .pasted, .typed:
            return .inserted
        case .copiedOnly(.secureInput):
            return .notice("Secure input is on — copied instead")
        case .copiedOnly:
            return .notice("Copied — paste with ⌘V")
        }
    }

    private static func auditName(_ outcome: InsertOutcome) -> String {
        switch outcome {
        case .pasted: return "pasted"
        case .typed: return "typed"
        case .copiedOnly(.secureInput): return "copied:secure-input"
        case .copiedOnly(.targetChanged): return "copied:target-changed"
        case .copiedOnly(.pasteFailed): return "copied:paste-failed"
        }
    }
}

/// Recordings that are too short or never rise above room noise are dropped before any
/// audio leaves the Mac. `peakLevel` is VoiceCapture's scaled RMS (0...1).
enum SpeechGate {
    static let minimumDuration: TimeInterval = 0.3
    static let silenceLevel: Float = 0.15

    static func heardSpeech(duration: TimeInterval, peakLevel: Float) -> Bool {
        duration >= minimumDuration && peakLevel >= silenceLevel
    }
}
