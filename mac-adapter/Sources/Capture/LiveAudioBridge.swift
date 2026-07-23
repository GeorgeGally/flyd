import AVFoundation
import Foundation

final class LiveAudioBridge {
    static let shared = LiveAudioBridge()

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var relaySocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var isActive = false

    var onTranscriptDelta: ((String) -> Void)?
    var onResolveOperations: ((String, [[String: Any]]) -> Void)?
    var onError: ((String) -> Void)?

    func start() -> Bool {
        guard !isActive else { return true }
        guard PermissionGate.shared.hasMicrophone else { return false }

        do {
            let inputNode = engine.inputNode
            let outputFormat = engine.mainMixerNode.outputFormat(forBus: 0)
            let inputFormat = inputNode.outputFormat(forBus: 0)

            engine.attach(playerNode)
            engine.connect(playerNode, to: engine.mainMixerNode, format: outputFormat)

            inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
                self?.processMicBuffer(buffer)
            }

            try engine.start()
            playerNode.play()

            connectRelay()
            isActive = true
            PrivacyInvariants.audioEngineActive = true
            return true
        } catch {
            onError?("LIVE audio engine error: \(error.localizedDescription)")
            return false
        }
    }

    func stop() {
        guard isActive else { return }
        isActive = false

        engine.inputNode.removeTap(onBus: 0)
        playerNode.stop()
        engine.stop()

        relaySocket?.cancel(with: .normalClosure, reason: nil)
        relaySocket = nil
        session = nil

        PrivacyInvariants.audioEngineActive = false
    }

    private func connectRelay() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 0
        session = URLSession(configuration: config)

        guard let url = URL(string: "ws://127.0.0.1:4817") else { return }
        relaySocket = session?.webSocketTask(with: url)
        relaySocket?.resume()

        let model = ProcessInfo.processInfo.environment["FLYD_REALTIME_MODEL"] ?? "gpt-realtime-2.1"
        let startMsg = """
        {"type":"start","config":{"model":"\(model)"}}
        """
        relaySocket?.send(.string(startMsg)) { _ in }
        receiveMessages()
    }

    private func processMicBuffer(_ buffer: AVAudioPCMBuffer) {
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

        let base64 = pcm16.base64EncodedString()
        let msg = """
        {"type":"audio","audio":"\(base64)"}
        """
        relaySocket?.send(.string(msg)) { _ in }
    }

    func playAudioOutput(_ base64: String) {
        guard let data = Data(base64Encoded: base64) else { return }
        let int16Count = data.count / 2
        var floatBuffer = [Float](repeating: 0, count: int16Count)

        for i in 0..<int16Count {
            let int16 = data.subdata(in: i*2..<i*2+2).withUnsafeBytes { $0.load(as: Int16.self) }
            floatBuffer[i] = Float(int16) / Float(Int16.max)
        }

        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false),
              let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(floatBuffer.count)) else { return }

        pcmBuffer.frameLength = AVAudioFrameCount(floatBuffer.count)
        if let channelData = pcmBuffer.floatChannelData?[0] {
            for i in 0..<floatBuffer.count {
                channelData[i] = floatBuffer[i]
            }
        }

        playerNode.scheduleBuffer(pcmBuffer)
    }

    private func receiveMessages() {
        relaySocket?.receive { [weak self] result in
            guard let self = self, self.isActive else { return }

            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleMessage(text)
                default:
                    break
                }
                self.receiveMessages()

            case .failure(let error):
                self.onError?("LIVE relay error: \(error.localizedDescription)")
                self.stop()
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        switch type {
        case "audio_output":
            if let audio = json["audio"] as? String {
                DispatchQueue.main.async { [weak self] in
                    self?.playAudioOutput(audio)
                }
            }
        case "transcript_delta":
            if let delta = json["text"] as? String {
                DispatchQueue.main.async { [weak self] in
                    self?.onTranscriptDelta?(delta)
                }
            }
        case "resolve_operations":
            let callId = json["call_id"] as? String ?? ""
            let ops = json["operations"] as? [[String: Any]] ?? []
            DispatchQueue.main.async { [weak self] in
                self?.onResolveOperations?(callId, ops)
            }
        case "error":
            let msg = json["message"] as? String ?? "Unknown error"
            DispatchQueue.main.async { [weak self] in
                self?.onError?(msg)
            }
        default:
            break
        }
    }
}
