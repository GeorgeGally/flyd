import AVFoundation

final class VoiceCapture {
    static let shared = VoiceCapture()

    private let engine = AVAudioEngine()
    private var isRunning = false
    private var audioBuffer = Data()
    private let bufferLock = NSLock()

    var onAudioChunk: ((Data) -> Void)?
    var onTranscriptionDelta: ((String) -> Void)?
    var onComplete: ((String) -> Void)?
    var onError: ((String) -> Void)?

    var isActive: Bool { isRunning }

    func start() -> Bool {
        guard !isRunning else { return true }
        guard PermissionGate.shared.hasMicrophone else {
            onError?("Microphone permission not granted")
            return false
        }

        do {
            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)

            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                guard let self = self, self.isRunning else { return }
                self.processAudioBuffer(buffer)
            }

            try engine.start()
            isRunning = true
            audioBuffer = Data()
            PrivacyInvariants.audioEngineActive = true
            return true
        } catch {
            onError?("Audio engine error: \(error.localizedDescription)")
            return false
        }
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false

        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        engine.reset()

        PrivacyInvariants.audioEngineActive = false

        let finalBuffer = bufferLock.withLock { audioBuffer }
        audioBuffer = Data()
    }

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frames = Int(buffer.frameLength)

        var pcm16 = Data(capacity: frames * 2)
        for i in 0..<frames {
            let sample = channelData[i]
            let clamped = max(-1.0, min(1.0, Float(sample)))
            let int16 = Int16(clamped * Float(Int16.max))
            var value = int16
            pcm16.append(Data(bytes: &value, count: 2))
        }

        bufferLock.withLock { audioBuffer.append(pcm16) }
        onAudioChunk?(pcm16)
    }

    func drainBuffer() -> Data {
        bufferLock.withLock {
            let data = audioBuffer
            audioBuffer = Data()
            return data
        }
    }
}
