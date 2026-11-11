import Foundation

/// Who is holding the microphone.
enum MicSessionKind: String, Equatable {
    case voice      // Fn+Control push-to-talk
    case dictation  // fn tap / hold
    case live       // Ctrl×3 realtime session
}

/// Proof of holding the mic. Only the holder of the current token can end the session,
/// so a late callback from a finished session can never turn off someone else's mic.
struct MicSessionToken: Equatable {
    let id: UUID
    let kind: MicSessionKind
}

/// idle → active(kind) → ending → idle. One session at a time; a start while the mic
/// is held is refused so the caller can say so instead of failing silently.
struct MicSessionMachine: Equatable {
    enum Phase: Equatable {
        case idle
        case active(MicSessionToken)
        case ending(MicSessionToken)
    }

    private(set) var phase: Phase = .idle

    var holder: MicSessionToken? {
        switch phase {
        case .idle: return nil
        case .active(let token), .ending(let token): return token
        }
    }

    mutating func begin(_ kind: MicSessionKind, id: UUID = UUID()) -> MicSessionToken? {
        guard case .idle = phase else { return nil }
        let token = MicSessionToken(id: id, kind: kind)
        phase = .active(token)
        return token
    }

    /// Moves the holder's session to `ending`. False for a stale or unknown token.
    mutating func beginEnding(_ token: MicSessionToken) -> Bool {
        guard case .active(let current) = phase, current == token else { return false }
        phase = .ending(token)
        return true
    }

    mutating func finish(_ token: MicSessionToken) {
        guard case .ending(let current) = phase, current == token else { return }
        phase = .idle
    }
}

/// The one owner of the microphone on the Mac. Dictation, push-to-talk and LIVE each
/// begin a session before starting capture and end it with their own token; ending
/// always turns capture off.
final class MicSession {
    static let shared = MicSession(stopCapture: { VoiceCapture.shared.stop() })

    private let lock = NSLock()
    private var machine = MicSessionMachine()
    private let stopCapture: () -> Void

    init(stopCapture: @escaping () -> Void) {
        self.stopCapture = stopCapture
    }

    var holder: MicSessionToken? { lock.withLock { machine.holder } }

    func begin(_ kind: MicSessionKind) -> MicSessionToken? {
        let token = lock.withLock { machine.begin(kind) }
        if token == nil {
            print("[Flyd] Microphone busy (\(holder?.kind.rawValue ?? "ending")); \(kind.rawValue) refused")
        }
        return token
    }

    func end(_ token: MicSessionToken) {
        guard lock.withLock({ machine.beginEnding(token) }) else { return }
        stopCapture()
        lock.withLock { machine.finish(token) }
    }
}
