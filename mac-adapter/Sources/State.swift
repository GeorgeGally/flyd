import Foundation

enum FlydMode: Equatable {
    case present
    case invoked
}

enum InvocationPhase: Equatable {
    case idle
    case capturing
    case awaitingIntent
    case resolving
    case executing
    case cancelled
}

final class FlydState: @unchecked Sendable {
    static let shared = FlydState()

    private let lock = NSLock()
    private var _mode: FlydMode = .present
    private var _phase: InvocationPhase = .idle
    private var _invocationId: String?

    var mode: FlydMode {
        lock.withLock { _mode }
    }

    var phase: InvocationPhase {
        lock.withLock { _phase }
    }

    var invocationId: String? {
        lock.withLock { _invocationId }
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

    func startInvocation() -> String {
        lock.lock()
        defer { lock.unlock() }
        let id = UUID().uuidString
        _invocationId = id
        _mode = .invoked
        _phase = .capturing
        return id
    }

    func cancelInvocation() {
        lock.lock()
        _phase = .cancelled
        _invocationId = nil
        lock.unlock()
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .flydPhaseDidChange, object: nil)
        }
    }
}

extension Notification.Name {
    static let flydModeDidChange = Notification.Name("FlydModeDidChange")
    static let flydPhaseDidChange = Notification.Name("FlydPhaseDidChange")
}
