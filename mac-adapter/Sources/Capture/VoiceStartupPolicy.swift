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
