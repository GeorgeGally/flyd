import Foundation

final class VoiceTranscriptionRelay {
    static let shared = VoiceTranscriptionRelay()

    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var isConnected = false
    private var transcriptBuffer = ""

    var onTranscriptDelta: ((String) -> Void)?
    var onComplete: ((String) -> Void)?
    var onError: ((String) -> Void)?

    func connect() {
        guard !isConnected else { return }

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)

        guard let url = URL(string: "ws://127.0.0.1:4816") else { return }
        webSocket = session?.webSocketTask(with: url)
        webSocket?.resume()

        sendStart()
        receive()
        isConnected = true
    }

    func sendAudioChunk(_ data: Data) {
        guard isConnected else { return }
        let base64 = data.base64EncodedString()
        let message = """
        {"type":"audio","audio":"\(base64)"}
        """
        webSocket?.send(.string(message)) { _ in }
    }

    func commitAudio() {
        guard isConnected else { return }
        webSocket?.send(.string(#"{"type":"commit"}"#)) { _ in }
    }

    func disconnect() {
        isConnected = false
        webSocket?.send(.string(#"{"type":"stop"}"#)) { _ in }
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        session = nil
        transcriptBuffer = ""
    }

    private func sendStart() {
        let model = ProcessInfo.processInfo.environment["FLYD_TRANSCRIPTION_MODEL"] ?? "gpt-realtime-whisper"
        let message = """
        {"type":"start","config":{"model":"\(model)"}}
        """
        webSocket?.send(.string(message)) { _ in }
    }

    private func receive() {
        webSocket?.receive { [weak self] result in
            guard let self = self, self.isConnected else { return }

            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleWSMessage(text)
                default:
                    break
                }
                self.receive()

            case .failure(let error):
                self.onError?("Transcription connection error: \(error.localizedDescription)")
                self.disconnect()
            }
        }
    }

    private func handleWSMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        switch type {
        case "delta":
            if let deltaText = json["text"] as? String {
                transcriptBuffer += deltaText
                DispatchQueue.main.async { [weak self] in
                    self?.onTranscriptDelta?(deltaText)
                }
            }
        case "complete":
            let fullText = json["text"] as? String ?? transcriptBuffer
            let finalText = fullText.isEmpty ? transcriptBuffer : fullText
            DispatchQueue.main.async { [weak self] in
                self?.onComplete?(finalText)
            }
        case "error":
            let msg = json["message"] as? String ?? "Unknown transcription error"
            DispatchQueue.main.async { [weak self] in
                self?.onError?(msg)
            }
        default:
            break
        }
    }
}
