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

enum VoiceAcknowledgementPresentation {
    static let text = "Okay, I'm on it."
    static let rate: Float = 0.48
    static let pitch: Float = 1.0
    static let preferredVoiceIdentifier = "com.apple.voice.compact.en-GB.Daniel"
}

final class VoiceAcknowledgementSpeaker {
    static let shared = VoiceAcknowledgementSpeaker()

    private let synthesizer = AVSpeechSynthesizer()

    func speakWorking() {
        stop()
        let utterance = AVSpeechUtterance(string: VoiceAcknowledgementPresentation.text)
        utterance.rate = VoiceAcknowledgementPresentation.rate
        utterance.pitchMultiplier = VoiceAcknowledgementPresentation.pitch
        utterance.volume = 0.82
        utterance.preUtteranceDelay = 0.06
        utterance.postUtteranceDelay = 0.04
        utterance.voice = AVSpeechSynthesisVoice(
            identifier: VoiceAcknowledgementPresentation.preferredVoiceIdentifier
        ) ?? AVSpeechSynthesisVoice(language: "en-GB")
        synthesizer.speak(utterance)
    }

    func stop() {
        guard synthesizer.isSpeaking else { return }
        synthesizer.stopSpeaking(at: .immediate)
    }
}
