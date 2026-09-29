import AppKit

/// One dictation, from the first fn edge to text in the focused app. All calls arrive on
/// the main thread (event-tap callbacks and relay completions are dispatched there).
final class DictationController {
    static let shared = DictationController()

    private struct Session {
        let invocationId: String
        let bundleId: String
        var targetPid: pid_t?
    }

    private enum Phase {
        case idle
        case recording(Session)
        case transcribing(Session)
        case inserting
    }

    private static let transcriptionTimeout: TimeInterval = 20

    private var phase: Phase = .idle
    private let pill = DictationPill()
    private var timeout: DispatchWorkItem?

    private let state = FlydState.shared
    private let capture = VoiceCapture.shared
    private let relay = VoiceTranscriptionRelay.shared
    private let stateMachine = InvocationStateMachine.shared

    var isActive: Bool {
        if case .idle = phase { return false }
        return true
    }

    func start() {
        guard case .idle = phase else { return }
        let (invocationId, _) = state.startInvocation()
        let session = Session(
            invocationId: invocationId,
            bundleId: NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown",
            targetPid: nil
        )
        phase = .recording(session)
        state.transition(to: .listening)
        pill.show(.listening)

        relay.connect(sessionId: stateMachine.nextTranscriptionSessionId())
        relay.onTranscriptDelta = nil
        relay.onComplete = { [weak self] transcript in self?.transcribed(transcript) }
        relay.onError = { [weak self] error in
            self?.fail(VoiceStartupPolicy.message(forTranscriptionError: error))
        }

        capture.onAudioChunk = { [relay] chunk in relay.sendAudioChunk(chunk) }
        capture.onLevel = nil
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
    }

    func stop() {
        guard case .recording(var session) = phase else { return }
        session.targetPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
        stopCapture()
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

    /// Shows a problem before any recording started (setup, permissions).
    func showBlocked(_ message: String) {
        guard case .idle = phase else { return }
        pill.show(.failed(message))
    }

    private func transcribed(_ transcript: String) {
        guard case .transcribing(let session) = phase else { return }
        teardown()

        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            fail("I didn't catch that")
            return
        }

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
        pill.show(.failed(message))
        state.cancelInvocation()
        phase = .idle
    }

    private func stopCapture() {
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
            return .copied("Secure input is on — copied instead")
        case .copiedOnly:
            return .copied("Copied — paste with ⌘V")
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
