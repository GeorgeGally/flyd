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

final class FlydState: @unchecked Sendable {
    static let shared = FlydState()

    private let lock = NSLock()
    private var _mode: FlydMode = .present
    private var _phase: InvocationPhase = .idle
    private var _invocationId: String?
    private var _currentRevision: Int = 0

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

    func transition(to mode: FlydMode) {
        lock.lock()
        _mode = mode
        if mode == .present {
            _phase = .idle
            _invocationId = nil
        }
        lock.unlock()
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .flydModeDidChange, object: nil)
        }
    }

    func transition(to phase: InvocationPhase) {
        lock.lock()
        _phase = phase
        if phase == .idle || phase == .cancelled {
            _invocationId = nil
        }
        lock.unlock()
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .flydPhaseDidChange, object: nil)
        }
    }

    func startInvocation() -> (invocationId: String, revision: Int) {
        lock.lock()
        defer { lock.unlock() }
        _currentRevision += 1
        let id = UUID().uuidString
        _invocationId = id
        _mode = .invoked
        _phase = .capturing
        return (id, _currentRevision)
    }

    func cancelInvocation() {
        lock.lock()
        _mode = .present
        _phase = .idle
        _invocationId = nil
        lock.unlock()
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .flydModeDidChange, object: nil)
            NotificationCenter.default.post(name: .flydPhaseDidChange, object: nil)
        }
    }
}

extension Notification.Name {
    static let flydModeDidChange = Notification.Name("FlydModeDidChange")
    static let flydPhaseDidChange = Notification.Name("FlydPhaseDidChange")
    static let flydConfigDidChange = Notification.Name("FlydConfigDidChange")
}
