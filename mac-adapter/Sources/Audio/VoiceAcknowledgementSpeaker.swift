import AVFoundation

enum VoiceInvocationPurpose {
    case conversation
    case dictation
}

struct VoiceAcknowledgementGate {
    private var lastAcknowledgedInvocationId: String?

    mutating func claim(invocationId: String, purpose: VoiceInvocationPurpose) -> Bool {
        guard purpose == .conversation else { return false }
        guard lastAcknowledgedInvocationId != invocationId else { return false }
        lastAcknowledgedInvocationId = invocationId
        return true
    }
}

final class VoiceAcknowledgementSpeaker {
    static let shared = VoiceAcknowledgementSpeaker()

    private let synthesizer = AVSpeechSynthesizer()

    func speakWorking() {
        stop()
        let utterance = AVSpeechUtterance(string: "On it.")
        utterance.rate = 0.52
        utterance.pitchMultiplier = 0.96
        utterance.volume = 0.82
        synthesizer.speak(utterance)
    }

    func stop() {
        guard synthesizer.isSpeaking else { return }
        synthesizer.stopSpeaking(at: .immediate)
    }
}
