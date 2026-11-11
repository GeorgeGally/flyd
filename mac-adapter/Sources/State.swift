import Foundation

enum FlydMode: Equatable {
    case present
    case invoked
    case live
}

enum InvocationPhase: Equatable {
    case idle
    case capturing
    case listening
    case awaitingIntent
    case transcribing
    case resolving
    case executing
    case cancelled
    case error
}

/// Flyd's mode and phase, moved only by the invocation session that owns them.
///
/// A session begins through `begin(_:)`, which takes the mic session and makes its token
/// id the invocation id. Every later phase write and the end carry that token; a write
/// from a session that already ended (a cancelled text invocation finishing late, a
/// LIVE teardown after the next session began) is ignored instead of resetting the
/// phase under whoever holds Flyd now.
final class FlydState: @unchecked Sendable {
    static let shared = FlydState(mic: .shared)

    let mic: MicSession
    private let lock = NSLock()
    private var _mode: FlydMode = .present
    private var _phase: InvocationPhase = .idle
    private var _invocationId: String?
    private var _currentRevision: Int = 0

    init(mic: MicSession) {
        self.mic = mic
    }

    var mode: FlydMode {
        lock.withLock { _mode }
    }

    var phase: InvocationPhase {
        lock.withLock { _phase }
    }

    var invocationId: String? {
        lock.withLock { _invocationId }
    }

    var revision: Int {
        lock.withLock { _currentRevision }
    }

    /// Whether `session` still owns Flyd's state.
    func isCurrent(_ session: InvocationSessionToken) -> Bool {
        lock.withLock { _invocationId == session.id }
    }

    /// Starts a session, or nil when one is already held (the mic is busy).
    func begin(_ kind: InvocationSessionKind) -> InvocationSessionToken? {
        guard let token = mic.begin(kind) else { return nil }
        lock.withLock {
            _currentRevision += 1
            _invocationId = token.id
            _mode = kind == .live ? .live : .invoked
            _phase = Self.startPhase(for: kind)
        }
        postChange(mode: true, phase: true)
        return token
    }

    static func startPhase(for kind: InvocationSessionKind) -> InvocationPhase {
        switch kind {
        case .text: return .capturing
        case .voice, .dictation: return .listening
        case .live: return .idle
        }
    }

    /// Moves the phase for `session`; ignored when `session` no longer owns Flyd.
    func transition(to phase: InvocationPhase, session: InvocationSessionToken) {
        let applied: Bool = lock.withLock {
            guard _invocationId == session.id else { return false }
            _phase = phase
            return true
        }
        guard applied else {
            print("[Flyd] Ignored stale \(session.kind.rawValue) phase \(phase) from \(session.id.prefix(8))")
            return
        }
        postChange(mode: false, phase: true)
    }

    /// Ends `session`: the mic goes off and Flyd returns to present. A stale token
    /// (its session already ended) changes nothing.
    func end(_ session: InvocationSessionToken) {
        mic.end(session)
        let applied: Bool = lock.withLock {
            guard _invocationId == session.id else { return false }
            _mode = .present
            _phase = .idle
            _invocationId = nil
            return true
        }
        if applied { postChange(mode: true, phase: true) }
    }

    /// Scrawl recording holds the invocation without a mic session (it guards its own
    /// exclusivity); it ends with `cancelInvocation(_:)` and its own id.
    func startInvocation() -> (invocationId: String, revision: Int) {
        let started: (String, Int) = lock.withLock {
            _currentRevision += 1
            let id = UUID().uuidString
            _invocationId = id
            _mode = .invoked
            _phase = .capturing
            return (id, _currentRevision)
        }
        postChange(mode: true, phase: true)
        return started
    }

    func cancelInvocation(_ invocationId: String) {
        let applied: Bool = lock.withLock {
            guard _invocationId == invocationId else { return false }
            _mode = .present
            _phase = .idle
            _invocationId = nil
            return true
        }
        if applied { postChange(mode: true, phase: true) }
    }

    private func postChange(mode: Bool, phase: Bool) {
        DispatchQueue.main.async {
            if mode { NotificationCenter.default.post(name: .flydModeDidChange, object: nil) }
            if phase { NotificationCenter.default.post(name: .flydPhaseDidChange, object: nil) }
        }
    }
}

extension Notification.Name {
    static let flydModeDidChange = Notification.Name("FlydModeDidChange")
    static let flydPhaseDidChange = Notification.Name("FlydPhaseDidChange")
    static let flydConfigDidChange = Notification.Name("FlydConfigDidChange")
}
