import Foundation

struct InvocationToken: Equatable {
    let invocationId: String
    let revision: Int

    func ownsInvocation(_ other: InvocationToken) -> Bool {
        invocationId == other.invocationId && revision == other.revision
    }

    static func current() -> InvocationToken? {
        guard let id = FlydState.shared.invocationId else { return nil }
        return InvocationToken(invocationId: id, revision: FlydState.shared.revision)
    }

    func assertOwnership(or handler: @escaping () -> Void = {}) -> Bool {
        guard let current = Self.current(), current.ownsInvocation(self) else {
            handler()
            return false
        }
        return true
    }
}
