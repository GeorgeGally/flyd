import Foundation

struct CoreNotificationPayload: Decodable, Equatable {
    let title: String
    let message: String

    /// The notifications in a chunk of Core's /notifications event stream, and what is left over.
    static func parse(_ buffer: Data) -> (notifications: [CoreNotificationPayload], rest: Data) {
        var rest = buffer
        var notifications: [CoreNotificationPayload] = []
        while let end = rest.range(of: Data("\n\n".utf8)) {
            let event = String(decoding: rest[..<end.lowerBound], as: UTF8.self)
            rest = Data(rest[end.upperBound...])
            guard event.contains("event: notification"),
                  let line = event.split(separator: "\n").first(where: { $0.hasPrefix("data: ") }),
                  let payload = try? JSONDecoder().decode(CoreNotificationPayload.self, from: Data(line.dropFirst(6).utf8))
            else { continue }
            notifications.append(payload)
        }
        return (notifications, rest)
    }

    /// Whether a notification may take the island from `phase`; otherwise it waits its turn.
    /// The conversation's own answering state (`.status(_, .working)`) holds it back too: while
    /// Flyd is answering, the spinner already says so and a second "Flyd" notification is noise.
    /// The notification is not lost — it shows once the island is free.
    static func canShow(over phase: DictationPill.Phase?) -> Bool {
        switch phase {
        case .listening, .working, .thinking, .failed, .notification, .status(_, .working), .status(_, .decision), .status(_, .reply):
            return false
        default:
            return true
        }
    }
}

/// Flyd's notifications, from Core's authenticated loopback feed, shown in the notch island. Never takes focus.
final class CoreNotifications: NSObject, URLSessionDataDelegate {
    static let shared = CoreNotifications()

    private let url = URL(string: "http://127.0.0.1:4815/notifications")!
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var buffer = Data()
    private var waiting: [CoreNotificationPayload] = []

    func start() {
        guard session == nil else { return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = .greatestFiniteMagnitude
        configuration.timeoutIntervalForResource = .greatestFiniteMagnitude
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        connect()
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.showNext() }
        RunLoop.main.add(timer, forMode: .common)
    }

    private func showNext() {
        let island = DictationPill.shared
        guard !waiting.isEmpty, CoreNotificationPayload.canShow(over: island.currentPhase) else { return }
        let next = waiting.removeFirst()
        island.show(.notification(next.title, next.message))
    }

    private func connect() {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(AdapterAuth.shared.credential())", forHTTPHeaderField: "Authorization")
        buffer = Data()
        task = session?.dataTask(with: request)
        task?.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard dataTask === task else { return }
        let parsed = CoreNotificationPayload.parse(buffer + data)
        buffer = parsed.rest
        waiting += parsed.notifications
        showNext()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task else { return }
        // Core is starting or restarted: reconnect shortly.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.connect() }
    }
}
