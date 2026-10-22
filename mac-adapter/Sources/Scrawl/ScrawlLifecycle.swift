import Foundation

/// Session identity survives Stop for transcription, and is revoked on cancel/error/completion.
struct ScrawlLifecycle {
    enum Phase { case idle, starting, recording, finishing }
    private enum State {
        case idle
        case starting(UUID)
        case recording(UUID)
        case finishing(UUID)
    }
    private var state: State = .idle
    var phase: Phase {
        switch state {
        case .idle: return .idle
        case .starting: return .starting
        case .recording: return .recording
        case .finishing: return .finishing
        }
    }
    var token: UUID? {
        switch state {
        case .idle: return nil
        case .starting(let token), .recording(let token), .finishing(let token): return token
        }
    }
    var isActive: Bool { token != nil }
    mutating func begin() -> UUID? {
        guard case .idle = state else { return nil }
        let token = UUID()
        state = .starting(token)
        return token
    }
    mutating func didStart(_ token: UUID) -> Bool {
        guard case .starting = state, self.token == token else { return false }
        state = .recording(token)
        return true
    }
    mutating func stop() -> Bool {
        guard case .recording(let token) = state else { return false }
        state = .finishing(token)
        return true
    }
    func accepts(_ token: UUID) -> Bool { self.token == token }
    func acceptsFrame(_ token: UUID) -> Bool {
        accepts(token) && (phase == .starting || phase == .recording)
    }
    mutating func end() { state = .idle }
}
