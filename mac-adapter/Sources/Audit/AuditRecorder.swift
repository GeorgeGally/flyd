import Foundation

struct AuditRecord: Codable {
    let invocationId: String
    let timestamp: Date
    let contextSources: [String]
    let error: String?
}

final class AuditRecorder {
    static let shared = AuditRecorder()

    private let directory: URL

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        directory = home.appendingPathComponent(".flyd/overlay/audit")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func record(invocationId: String, contextSources: [String], error: String? = nil) {
        let record = AuditRecord(
            invocationId: invocationId,
            timestamp: Date(),
            contextSources: contextSources,
            error: error.map { sanitize($0) }
        )

        guard let data = try? JSONEncoder().encode(record) else { return }

        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let dateStr = dateFormatter.string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let filename = "\(dateStr)-\(invocationId.prefix(8)).json"
        let fileURL = directory.appendingPathComponent(filename)

        try? data.write(to: fileURL)
    }

    private func sanitize(_ message: String) -> String {
        if message.count > 200 {
            return String(message.prefix(200))
        }
        return message
    }

    func recordLiveSessionStart(sessionId: String) {
        let filename = "live-\(sessionId.prefix(8))-start.json"
        let fileURL = directory.appendingPathComponent(filename)
        let record: [String: String] = [
            "type": "live_session_start",
            "sessionId": sessionId,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
        guard let data = try? JSONEncoder().encode(record) else { return }
        try? data.write(to: fileURL)
    }

    func recordLiveSessionEnd(sessionId: String, duration: TimeInterval, error: String? = nil) {
        let filename = "live-\(sessionId.prefix(8))-end.json"
        let fileURL = directory.appendingPathComponent(filename)
        var record: [String: String] = [
            "type": "live_session_end",
            "sessionId": sessionId,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "duration": String(format: "%.1f", duration),
        ]
        if let error = error {
            record["error"] = sanitize(error)
        }
        guard let data = try? JSONEncoder().encode(record) else { return }
        try? data.write(to: fileURL)
    }
}
