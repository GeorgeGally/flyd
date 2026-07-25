import Foundation

struct UndoRecord {
    let invocationId: String
    let target: TargetDescriptor
    let previousValue: String
    let expiresAt: Date

    static let ttl: TimeInterval = 30
}

final class UndoManager {
    static let shared = UndoManager()

    private var records: [UndoRecord] = []
    private let maxRecords = 3

    func register(target: TargetDescriptor, previousValue: String, invocationId: String) {
        let record = UndoRecord(
            invocationId: invocationId,
            target: target,
            previousValue: previousValue,
            expiresAt: Date().addingTimeInterval(UndoRecord.ttl)
        )

        records.append(record)
        while records.count > maxRecords { records.removeFirst() }

        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .undoAvailable,
                object: nil,
                userInfo: ["invocationId": invocationId]
            )
        }
    }

    func undo(for invocationId: String) -> UndoRecord? {
        records.removeAll { $0.expiresAt <= Date() }
        guard let index = records.firstIndex(where: { $0.invocationId == invocationId }) else {
            return nil
        }
        return records.remove(at: index)
    }

    func purge() {
        records.removeAll()
    }
}

extension Notification.Name {
    static let undoAvailable = Notification.Name("UndoAvailable")
}
