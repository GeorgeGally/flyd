import Foundation

enum VoiceStartupPolicy {
    enum ReleaseAction: Equatable {
        case finishRecording
        case ignore
    }

    static func message(forTranscriptionError error: String) -> String {
        if error.localizedCaseInsensitiveContains("valid api key") {
            return "Voice setup needs a valid API key"
        }

        if error.localizedCaseInsensitiveContains("audio model access")
            || error.localizedCaseInsensitiveContains("not active for this key") {
            return "Voice is not active for this key yet"
        }

        let isTranscriptionConnectionFailure = [
            "could not connect to the server",
            "connection refused",
            "failed to connect",
            "socket is not connected",
            "connection reset",
            "connection lost",
            "network connection was lost",
            "transcription service error",
        ].contains { error.localizedCaseInsensitiveContains($0) }

        return isTranscriptionConnectionFailure
            ? "Voice failed - try again"
            : "Voice error - try again"
    }

    static func actionOnShortcutRelease(phase: InvocationPhase) -> ReleaseAction {
        if phase == .listening {
            return .finishRecording
        }

        return .ignore
    }
}

/// Core's health as last seen by the adapter. Each change (including the first answer)
/// starts a new generation and says what to do with the cached voice status; a fetch
/// that finishes after a newer change is dropped by `isCurrent`.
struct CoreHealthWatch: Equatable {
    static let pollInterval: TimeInterval = 15

    enum Refresh: Equatable {
        case fetch(generation: Int)
        case clear(generation: Int)
    }

    private(set) var lastHealthy: Bool?
    private(set) var generation = 0

    /// `voiceStatusReady` is whether the cached voice status is present and ok; while
    /// it isn't, each healthy poll fetches again (a restart between polls, a failed fetch).
    mutating func observe(healthy: Bool, voiceStatusReady: Bool) -> Refresh? {
        guard healthy != lastHealthy || (healthy && !voiceStatusReady) else { return nil }
        lastHealthy = healthy
        generation += 1
        return healthy ? .fetch(generation: generation) : .clear(generation: generation)
    }

    func isCurrent(_ generation: Int) -> Bool {
        generation == self.generation
    }
}
