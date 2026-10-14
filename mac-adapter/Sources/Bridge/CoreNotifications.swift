import Foundation

struct CoreNotificationPayload: Decodable, Equatable {
    let title: String
    let message: String

    /// The notifications in a chunk of Core's /notifications event stream, and what is left over.
    static func parse(_ buffer: String) -> (notifications: [CoreNotificationPayload], rest: String) {
        var rest = buffer
        var notifications: [CoreNotificationPayload] = []
        while let end = rest.range(of: "\n\n") {
            let event = String(rest[..<end.lowerBound])
            rest = String(rest[end.upperBound...])
            guard event.contains("event: notification"),
                  let line = event.split(separator: "\n").first(where: { $0.hasPrefix("data: ") }),
                  let payload = try? JSONDecoder().decode(CoreNotificationPayload.self, from: Data(line.dropFirst(6).utf8))
            else { continue }
            notifications.append(payload)
        }
        return (notifications, rest)
    }
}

/// Flyd's notifications, from Core's authenticated loopback feed, shown in the notch island. Never takes focus.
final class CoreNotifications: NSObject, URLSessionDataDelegate {
    static let shared = CoreNotifications()

    private let url = URL(string: "http://127.0.0.1:4815/notifications")!
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var buffer = ""

    func start() {
        guard session == nil else { return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = .greatestFiniteMagnitude
        configuration.timeoutIntervalForResource = .greatestFiniteMagnitude
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        connect()
    }

    private func connect() {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(AdapterAuth.shared.credential())", forHTTPHeaderField: "Authorization")
        buffer = ""
        task = session?.dataTask(with: request)
        task?.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard dataTask === task, let text = String(data: data, encoding: .utf8) else { return }
        let parsed = CoreNotificationPayload.parse(buffer + text)
        buffer = parsed.rest
        for notification in parsed.notifications where !DictationPill.shared.isBusyWithVoice {
            DictationPill.shared.show(.notification(notification.title, notification.message))
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task else { return }
        // Core is starting or restarted: reconnect shortly.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.connect() }
    }
}
