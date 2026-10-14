import Foundation
import Network
import UserNotifications

final class NotificationBridge {
    static let shared = NotificationBridge()
    static let port: UInt16 = 4818

    private let queue = DispatchQueue(label: "com.flyd.notification-bridge")
    private let maxBytes = 64 * 1024
    private var listener: NWListener?

    private init() {}

    func start() {
        guard listener == nil, let port = NWEndpoint.Port(rawValue: Self.port) else {
            return
        }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: port)
        guard let listener = try? NWListener(using: parameters, on: port) else {
            return
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
        self.listener = listener
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: maxBytes) { [weak self] chunk, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            var data = buffer
            if let chunk { data.append(chunk) }
            if let line = Self.firstLine(data) {
                self.handle(line, connection: connection)
            } else if isComplete || error != nil || data.count >= self.maxBytes {
                connection.cancel()
            } else {
                self.receive(connection, buffer: data)
            }
        }
    }

    static func firstLine(_ data: Data) -> Data? {
        guard let newline = data.firstIndex(of: 0x0A) else { return nil }
        return data.subdata(in: data.startIndex..<newline)
    }

    private func handle(_ line: Data, connection: NWConnection) {
        guard let object = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else {
            respond(connection, ok: false, reason: "invalid request")
            return
        }
        let title = ((object["title"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let message = (object["message"] as? String) ?? ""
        post(
            title: title.isEmpty ? "Flyd" : title,
            message: String(message.prefix(220)),
            connection: connection
        )
    }

    private func post(title: String, message: String, connection: NWConnection) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            let status = settings.authorizationStatus
            guard status == .authorized || status == .provisional else {
                self.respond(connection, ok: false, reason: "notifications not authorized")
                return
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = message
            let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
            center.add(request) { error in
                self.respond(connection, ok: error == nil, reason: error?.localizedDescription ?? "")
            }
        }
    }

    private func respond(_ connection: NWConnection, ok: Bool, reason: String) {
        let payload: [String: Any] = reason.isEmpty ? ["ok": ok] : ["ok": ok, "reason": reason]
        var data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
        data.append(0x0A)
        connection.send(content: data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}
