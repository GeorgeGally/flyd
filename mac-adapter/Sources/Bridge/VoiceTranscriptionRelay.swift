import Foundation

final class VoiceTranscriptionRelay {
    static let shared = VoiceTranscriptionRelay()

    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var isConnected = false
    private var transcriptBuffer = ""
    private var preConnectBuffer: [Data] = []
    private let maxPreConnectBytes = 48000
    private var bufferedByteCount = 0

    private var currentSessionId: Int = -1

    var onTranscriptDelta: ((String) -> Void)?
    var onComplete: ((String) -> Void)?
    var onError: ((String) -> Void)?

    func connect(sessionId: Int) {
        guard !isConnected else { return }

        currentSessionId = sessionId
        preConnectBuffer = []
        bufferedByteCount = 0

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)

        guard let url = URL(string: "ws://127.0.0.1:4816") else { return }
        var request = URLRequest(url: url)
        let token = AdapterAuth.shared.credential()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        webSocket = session?.webSocketTask(with: request)
        webSocket?.resume()

        sendStart()
        receive()
        isConnected = true

        drainPreConnectBuffer()
    }

    func sendAudioChunk(_ data: Data) {
        if !isConnected {
            bufferChunk(data)
            return
        }
        sendDirect(data)
    }

    func commitAudio() {
        guard isConnected else { return }
        webSocket?.send(.string(#"{"type":"commit"}"#)) { _ in }
    }

    func disconnect() {
        isConnected = false
        currentSessionId = -1
        preConnectBuffer = []
        bufferedByteCount = 0

        webSocket?.send(.string(#"{"type":"stop"}"#)) { _ in }
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        session = nil
        transcriptBuffer = ""
    }

    private func bufferChunk(_ data: Data) {
        let size = data.count
        if bufferedByteCount + size > maxPreConnectBytes { return }
        preConnectBuffer.append(data)
        bufferedByteCount += size
    }

    private func drainPreConnectBuffer() {
        let chunks = preConnectBuffer
        preConnectBuffer = []
        bufferedByteCount = 0
        for chunk in chunks {
            sendDirect(chunk)
        }
    }

    private func sendDirect(_ data: Data) {
        let base64 = data.base64EncodedString()
        let message = """
        {"type":"audio","audio":"\(base64)"}
        """
        webSocket?.send(.string(message)) { _ in }
    }

    private func sendStart() {
        webSocket?.send(.string(#"{"type":"start"}"#)) { _ in }
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
                    guard self?.currentSessionId == InvocationStateMachine.shared.transcriptionSessionId else { return }
                    self?.onTranscriptDelta?(deltaText)
                }
            }
        case "complete":
            let fullText = json["text"] as? String ?? transcriptBuffer
            let finalText = fullText.isEmpty ? transcriptBuffer : fullText
            let capturedSessionId = self.currentSessionId
            DispatchQueue.main.async { [weak self] in
                guard let self, capturedSessionId >= 0,
                      capturedSessionId == InvocationStateMachine.shared.transcriptionSessionId else { return }
                self.onComplete?(finalText)
            }
        case "error":
            let msg = json["message"] as? String ?? "Unknown transcription error"
            DispatchQueue.main.async { [weak self] in
                guard self?.currentSessionId == InvocationStateMachine.shared.transcriptionSessionId else { return }
                self?.onError?(msg)
            }
        default:
            break
        }
    }
}
