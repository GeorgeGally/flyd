import Foundation

final class VoiceTranscriptionRelay {
    static let shared = VoiceTranscriptionRelay()

    enum ConnectionState {
        case disconnected
        case connecting
        case ready
        case closing
    }

    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var state: ConnectionState = .disconnected
    private var transcriptBuffer = ""
    private var preReadyBuffer: [Data] = []
    private let maxPreReadyBytes = 48000
    private var bufferedByteCount = 0

    private var currentSessionId: Int = -1

    var onTranscriptDelta: ((String) -> Void)?
    var onComplete: ((String) -> Void)?
    var onError: ((String) -> Void)?

    func connect(sessionId: Int) {
        guard state == .disconnected else { return }

        currentSessionId = sessionId
        state = .connecting
        preReadyBuffer = []
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
        waitForReady()
    }

    func sendAudioChunk(_ data: Data) {
        switch state {
        case .disconnected, .closing:
            return
        case .connecting:
            if bufferedByteCount + data.count <= maxPreReadyBytes {
                preReadyBuffer.append(data)
                bufferedByteCount += data.count
            }
        case .ready:
            sendDirect(data)
        }
    }

    func commitAudio() {
        guard state == .ready else { return }
        webSocket?.send(.string(#"{"type":"commit"}"#)) { _ in }
    }

    func disconnect() {
        state = .closing
        currentSessionId = -1
        preReadyBuffer = []
        bufferedByteCount = 0

        webSocket?.send(.string(#"{"type":"stop"}"#)) { _ in }
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        session = nil
        transcriptBuffer = ""

        state = .disconnected
    }

    private func sendStart() {
        webSocket?.send(.string(#"{"type":"start"}"#)) { _ in }
    }

    private func waitForReady() {
        webSocket?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success:
                self.state = .ready
                self.drainPreReadyBuffer()
                self.receive()

            case .failure(let error):
                self.state = .disconnected
                self.onError?("Transcription connection error: \(error.localizedDescription)")
                self.disconnect()
            }
        }
    }

    private func drainPreReadyBuffer() {
        let chunks = preReadyBuffer
        preReadyBuffer = []
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

    private func receive() {
        webSocket?.receive { [weak self] result in
            guard let self = self, self.state == .ready else { return }

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
