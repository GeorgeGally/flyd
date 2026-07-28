import Foundation

final class LiveAudioBridge {
    static let shared = LiveAudioBridge()

    enum ConnectionState: Equatable {
        case disconnected
        case connecting
        case ready
        case active
        case closing
        case failed
    }

    private let queue = DispatchQueue(label: "flyd.live-audio", qos: .userInitiated)
    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var state: ConnectionState = .disconnected
    private var sessionToken: Int = 0

    var onStateChange: ((ConnectionState) -> Void)?
    var onTranscriptDelta: ((String) -> Void)?
    var onAudioReceived: ((Data) -> Void)?
    var onResolutionResult: (([String: Any]) -> Void)?
    var onObservationRequest: (([String: Any]) -> Void)?
    var onError: ((String) -> Void)?

    func sendRaw(_ text: String) {
        queue.async { [weak self] in
            self?.webSocket?.send(.string(text)) { _ in }
        }
    }

    func connect() {
        queue.async { [weak self] in
            guard let self, self.state == .disconnected else { return }

            self.sessionToken += 1
            self.state = .connecting
            self.notifyState()

            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 30
            self.session = URLSession(configuration: config)

            guard let url = URL(string: "ws://127.0.0.1:4817") else { return }
            var request = URLRequest(url: url)
            let token = AdapterAuth.shared.credential()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            self.webSocket = self.session?.webSocketTask(with: request)
            self.webSocket?.resume()

            self.webSocket?.send(.string(#"{"type":"start"}"#)) { _ in }
            self.waitForReady(token: self.sessionToken)
        }
    }

    func sendAudioChunk(_ data: Data) {
        queue.async { [weak self] in
            guard let self, (self.state == .active || self.state == .ready) else { return }
            let base64 = data.base64EncodedString()
            let message = """
            {"type":"audio","audio":"\(base64)"}
            """
            self.webSocket?.send(.string(message)) { _ in }
        }
    }

    func disconnect() {
        queue.async { [weak self] in
            guard let self else { return }
            guard self.state != .disconnected else { return }

            if self.state == .connecting || self.state == .ready || self.state == .active {
                self.state = .closing
                self.notifyState()
                self.webSocket?.send(.string(#"{"type":"stop"}"#)) { _ in }
            }

            self.sessionToken += 1
            self.webSocket?.cancel(with: .normalClosure, reason: nil)
            self.webSocket = nil
            self.session = nil
            self.state = .disconnected
            self.notifyState()
        }
    }

    private func notifyState() {
        let current = state
        DispatchQueue.main.async { [weak self] in
            self?.onStateChange?(current)
        }
    }

    private func waitForReady(token: Int) {
        webSocket?.receive { [weak self] result in
            guard let self else { return }

            self.queue.async {
                guard token == self.sessionToken, self.state == .connecting else { return }

                switch result {
                case .success(let message):
                    if case .string(let text) = message {
                        self.handleWSMessage(text)
                    }
                    self.receive(token: token)

                case .failure(let error):
                    self.state = .failed
                    self.notifyState()
                    DispatchQueue.main.async {
                        self.onError?("LIVE connection error: \(error.localizedDescription)")
                    }
                    self.disconnect()
                }
            }
        }
    }

    private func receive(token: Int) {
        webSocket?.receive { [weak self] result in
            guard let self else { return }

            self.queue.async {
                guard token == self.sessionToken,
                      self.state == .connecting || self.state == .ready || self.state == .active else { return }

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
                    self.state = .failed
                    self.notifyState()
                    DispatchQueue.main.async {
                        self.onError?("LIVE connection error: \(error.localizedDescription)")
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

        switch type {
        case "connecting":
            break
        case "ready":
            state = .active
            notifyState()
        case "transcript_delta":
            if let deltaText = json["text"] as? String {
                DispatchQueue.main.async { [weak self] in
                    self?.onTranscriptDelta?(deltaText)
                }
            }
        case "audio_output":
            if let base64 = json["audio"] as? String,
               let audioData = Data(base64Encoded: base64) {
                DispatchQueue.main.async { [weak self] in
                    self?.onAudioReceived?(audioData)
                }
            }
        case "resolution_result":
            DispatchQueue.main.async { [weak self] in
                self?.onResolutionResult?(json)
            }
        case "observation_request":
            DispatchQueue.main.async { [weak self] in
                self?.onObservationRequest?(json)
            }
        case "error":
            state = .failed
            notifyState()
            let msg = json["message"] as? String ?? "Unknown realtime error"
            DispatchQueue.main.async { [weak self] in
                self?.onError?(msg)
            }
            disconnect()
        default:
            break
        }
    }
}
