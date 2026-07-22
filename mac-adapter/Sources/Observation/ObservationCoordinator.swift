import Foundation

final class ObservationCoordinator {
    static let shared = ObservationCoordinator()

    private let lock = NSLock()
    private var pendingToken: UUID?
    private var activeToken: UUID?
    private var analyzedTokens: Set<UUID> = []
    private var lastEnvironment: EnvironmentState?

    func requestObservation() -> UUID {
        let token = UUID()
        lock.lock()
        pendingToken = token
        activeToken = nil
        lock.unlock()

        scheduleAnalysis(token: token)
        return token
    }

    func latestMeaningfulState() -> EnvironmentState? {
        lock.lock()
        defer { lock.unlock() }
        if let last = lastEnvironment {
            return last
        }
        return AccessibilityInspector.shared.captureEnvironment()
    }

    private func scheduleAnalysis(token: UUID) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }

            self.lock.lock()
            let isLatest = self.pendingToken == token
            self.lock.unlock()

            guard isLatest else { return }

            self.lock.lock()
            if let active = self.activeToken, self.analyzedTokens.contains(active) {
                self.lock.unlock()
                return
            }
            self.activeToken = token
            self.lock.unlock()

            let env = AccessibilityInspector.shared.captureEnvironment()

            self.lock.lock()
            self.analyzedTokens.insert(token)
            if let env {
                self.lastEnvironment = env
            }
            if self.pendingToken == token {
                self.pendingToken = nil
            }
            self.lock.unlock()
        }
    }

    func invalidate() {
        lock.lock()
        pendingToken = nil
        activeToken = nil
        lock.unlock()
    }

    func clearCache() {
        lock.lock()
        lastEnvironment = nil
        analyzedTokens.removeAll()
        lock.unlock()
    }
}
