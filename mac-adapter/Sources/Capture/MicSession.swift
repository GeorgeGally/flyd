import Foundation

/// The one owner of the microphone on the Mac. Text, push-to-talk, dictation and LIVE
/// each begin a session (through `FlydState.begin`) before starting capture and end it
/// with their own token; ending always turns capture off.
final class MicSession {
    static let shared = MicSession(stopCapture: { VoiceCapture.shared.stop() })

    private let lock = NSLock()
    private var machine = InvocationSessionMachine()
    private let stopCapture: () -> Void

    init(stopCapture: @escaping () -> Void) {
        self.stopCapture = stopCapture
    }

    var holder: InvocationSessionToken? { lock.withLock { machine.holder } }
    var session: InvocationSession { lock.withLock { machine.session } }

    func begin(_ kind: InvocationSessionKind) -> InvocationSessionToken? {
        let token = lock.withLock { machine.begin(kind) }
        if token == nil {
            print("[Flyd] Microphone busy (\(holder?.kind.rawValue ?? "ending")); \(kind.rawValue) refused")
        }
        return token
    }

    /// Turns capture off while the session goes on (push-to-talk and dictation keep
    /// their session through transcription). Only the active holder can do it.
    func stopCapture(for token: InvocationSessionToken) {
        guard lock.withLock({ machine.session.active == token }) else { return }
        stopCapture()
    }

    /// Ends the holder's session: `ending` turns capture off, then the mic is free.
    /// False (and nothing touched) for a stale token.
    @discardableResult
    func end(_ token: InvocationSessionToken) -> Bool {
        guard lock.withLock({ machine.beginEnding(token) }) else { return false }
        stopCapture()
        lock.withLock { machine.finish(token) }
        return true
    }
}
