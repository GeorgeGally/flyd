import Foundation
import ApplicationServices

struct UndoRecord {
    let invocationId: String
    let target: TargetDescriptor
    let element: AXUIElement
    let previousValue: String
    let operationKind: String
    let targetRef: String
    let expiresAt: Date

    static let ttl: TimeInterval = 30
}

final class UndoManager {
    static let shared = UndoManager()

    private let lock = NSLock()
    private var records: [UndoRecord] = []
    private let maxRecords = 3

    func register(target: TargetDescriptor, element: AXUIElement, previousValue: String, operationKind: String, targetRef: String, invocationId: String) {
        let record = UndoRecord(
            invocationId: invocationId,
            target: target,
            element: element,
            previousValue: previousValue,
            operationKind: operationKind,
            targetRef: targetRef,
            expiresAt: Date().addingTimeInterval(UndoRecord.ttl)
        )

        lock.lock()
        records.append(record)
        while records.count > maxRecords { records.removeFirst() }
        lock.unlock()

        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .undoAvailable,
                object: nil,
                userInfo: ["invocationId": invocationId]
            )
        }
    }

    func undo(for invocationId: String) -> UndoRecord? {
        lock.lock()
        records.removeAll { $0.expiresAt <= Date() }
        guard let index = records.firstIndex(where: { $0.invocationId == invocationId }) else {
            lock.unlock()
            return nil
        }
        let record = records[index]
        lock.unlock()
        return record
    }

    func consume(for invocationId: String) {
        lock.lock()
        records.removeAll { $0.invocationId == invocationId }
        lock.unlock()
    }

    func purge() {
        lock.lock()
        records.removeAll()
        lock.unlock()
    }
}

extension Notification.Name {
    static let undoAvailable = Notification.Name("UndoAvailable")
}
