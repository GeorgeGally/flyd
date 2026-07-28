import Foundation

final class VoiceTranscriptionRelay {
    static let shared = VoiceTranscriptionRelay()

    enum ConnectionState {
        case disconnected
        case connecting
        case ready
        case closing
    }

    private let queue = DispatchQueue(label: "flyd.voice-relay", qos: .userInitiated)
    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var state: ConnectionState = .disconnected
    private var transcriptBuffer = ""
    private var preReadyBuffer: [Data] = []
    private let maxPreReadyBytes = 480000
    private var bufferedByteCount = 0
    private var commitPending = false
    private var currentSessionId: Int = -1
    private var sessionToken: Int = 0

    var onTranscriptDelta: ((String) -> Void)?
    var onComplete: ((String) -> Void)?
    var onError: ((String) -> Void)?

    func connect(sessionId: Int) {
        queue.async { [weak self] in
            guard let self, self.state == .disconnected else { return }

            self.currentSessionId = sessionId
            self.sessionToken += 1
            self.state = .connecting
            self.preReadyBuffer = []
            self.bufferedByteCount = 0
            self.commitPending = false

            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 30
            self.session = URLSession(configuration: config)

            guard let url = URL(string: "ws://127.0.0.1:4816") else { return }
            var request = URLRequest(url: url)
            let token = AdapterAuth.shared.credential()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            self.webSocket = self.session?.webSocketTask(with: request)
            self.webSocket?.resume()

            self.sendStart()
            self.waitForReady(token: self.sessionToken)
        }
    }

    func sendAudioChunk(_ data: Data) {
        queue.async { [weak self] in
            guard let self else { return }
            switch self.state {
            case .disconnected, .closing:
                return
            case .connecting:
                if self.bufferedByteCount + data.count <= self.maxPreReadyBytes {
                    self.preReadyBuffer.append(data)
                    self.bufferedByteCount += data.count
                }
            case .ready:
                self.sendDirect(data)
            }
        }
    }

    func commitAudio() {
        queue.async { [weak self] in
            guard let self else { return }
            switch self.state {
            case .ready:
                self.webSocket?.send(.string(#"{"type":"commit"}"#)) { _ in }
            case .connecting:
                self.commitPending = true
            case .disconnected, .closing:
                return
            }
        }
    }

    func disconnect() {
        queue.async { [weak self] in
            guard let self else { return }
            self.state = .closing
            self.sessionToken += 1
            self.currentSessionId = -1
            self.preReadyBuffer = []
            self.bufferedByteCount = 0
            self.commitPending = false

            self.webSocket?.send(.string(#"{"type":"stop"}"#)) { _ in }
            self.webSocket?.cancel(with: .normalClosure, reason: nil)
            self.webSocket = nil
            self.session = nil
            self.transcriptBuffer = ""

            self.state = .disconnected
        }
    }

    private func sendStart() {
        webSocket?.send(.string(#"{"type":"start"}"#)) { _ in }
    }

    private func waitForReady(token: Int) {
        webSocket?.receive { [weak self] result in
            guard let self else { return }

            self.queue.async {
                guard token == self.sessionToken, self.state == .connecting else { return }

                switch result {
                case .success(let message):
                    self.state = .ready
                    self.drainPreReadyBuffer()
                    if case .string(let text) = message {
                        self.handleWSMessage(text)
                    }
                    self.receive(token: token)

                case .failure(let error):
                    self.state = .disconnected
                    DispatchQueue.main.async {
                        self.onError?("Transcription connection error: \(error.localizedDescription)")
                    }
                    self.disconnect()
                }
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
        if commitPending {
            commitPending = false
            webSocket?.send(.string(#"{"type":"commit"}"#)) { _ in }
        }
    }

    private func sendDirect(_ data: Data) {
        let base64 = data.base64EncodedString()
        let message = """
        {"type":"audio","audio":"\(base64)"}
        """
        webSocket?.send(.string(message)) { _ in }
    }

    private func receive(token: Int) {
        webSocket?.receive { [weak self] result in
            guard let self else { return }

            self.queue.async {
                guard token == self.sessionToken, self.state == .ready else { return }

                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text):
                        self.handleWSMessage(text)
                    default:
                        break
                    }
                    self.receive(token: token)

                case .failure(let error):
                    self.state = .disconnected
                    DispatchQueue.main.async {
                        self.onError?("Transcription connection error: \(error.localizedDescription)")
                    }
                    self.disconnect()
                }
            }
        }
    }

    private func handleWSMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        let capturedSessionId = self.currentSessionId

        switch type {
        case "ready":
            break
        case "delta":
            if let deltaText = json["text"] as? String {
                transcriptBuffer += deltaText
                DispatchQueue.main.async { [weak self] in
                    guard capturedSessionId >= 0,
                          capturedSessionId == InvocationStateMachine.shared.transcriptionSessionId else { return }
                    self?.onTranscriptDelta?(deltaText)
                }
            }
        case "complete":
            let fullText = json["text"] as? String ?? transcriptBuffer
            let finalText = fullText.isEmpty ? transcriptBuffer : fullText
            DispatchQueue.main.async { [weak self] in
                guard let self, capturedSessionId >= 0,
                      capturedSessionId == InvocationStateMachine.shared.transcriptionSessionId else { return }
                self.onComplete?(finalText)
            }
        case "error":
            let msg = json["message"] as? String ?? "Unknown transcription error"
            DispatchQueue.main.async { [weak self] in
                guard capturedSessionId >= 0,
                      capturedSessionId == InvocationStateMachine.shared.transcriptionSessionId else { return }
                self?.onError?(msg)
            }
        default:
            break
        }
    }
}
