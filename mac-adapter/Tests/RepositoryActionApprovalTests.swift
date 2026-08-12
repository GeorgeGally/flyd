import XCTest
@testable import FlydMacAdapter

final class RepositoryActionApprovalTests: XCTestCase {
    func testPresentationNamesAllowedOperationAndHumanReadableApprovalWindow() {
        let proposal = makeProposal(expiryMs: 120_000, allowedOperation: "repository_modify")

        let lines = RepositoryActionApprovalPolicy.presentationLines(for: proposal)

        XCTAssertEqual(lines, [
            "Allowed operation: repository_modify",
            "Approval window: 2 minutes",
        ])
    }

    func testPendingActionRetainsAuthorityAndExpiryDeadline() throws {
        let receivedAt = Date(timeIntervalSince1970: 1_000)
        let proposal = makeProposal(expiryMs: 60_000, allowedOperation: "repository_modify")

        let pending = try XCTUnwrap(
            PendingRepositoryAction(proposal: proposal, receivedAt: receivedAt)
        )

        XCTAssertEqual(pending.expiresAt, Date(timeIntervalSince1970: 1_060))
    }

    func testPendingActionRejectsMissingAllowedOperation() {
        let proposal = makeProposal(expiryMs: 60_000, allowedOperation: nil)

        XCTAssertNil(PendingRepositoryAction(proposal: proposal, receivedAt: Date()))
    }

    func testPendingActionRejectsNonPositiveApprovalWindow() {
        let proposal = makeProposal(expiryMs: 0, allowedOperation: "repository_modify")

        XCTAssertNil(PendingRepositoryAction(proposal: proposal, receivedAt: Date()))
    }

    func testPendingActionExpiresAtItsCapturedDeadline() throws {
        let receivedAt = Date(timeIntervalSince1970: 1_000)
        let pending = try XCTUnwrap(PendingRepositoryAction(
            proposal: makeProposal(expiryMs: 1_000, allowedOperation: "repository_modify"),
            receivedAt: receivedAt
        ))

        XCTAssertNil(pending.approvalError(at: Date(timeIntervalSince1970: 1_000.999)))
        XCTAssertEqual(
            pending.approvalError(at: Date(timeIntervalSince1970: 1_001)),
            "This approval window has expired. Ask Flyd to propose the action again."
        )
    }

    func testRepositoryActionRunIdentityFailsClosedWhenInvocationContextChanges() {
        let identity = RepositoryActionRunIdentity(
            token: UUID(),
            actionId: "action-1",
            workSessionId: "session-1",
            workSessionRevision: 4,
            invocationId: "invocation-1",
            interactionId: "interaction-1"
        )

        XCTAssertTrue(identity.matches(
            activeIdentity: identity,
            workSessionId: "session-1",
            workSessionRevision: 4,
            invocationId: "invocation-1",
            interactionId: "interaction-1"
        ))
        XCTAssertFalse(identity.matches(
            activeIdentity: identity,
            workSessionId: "session-1",
            workSessionRevision: 4,
            invocationId: "invocation-2",
            interactionId: "interaction-1"
        ))
        XCTAssertFalse(identity.matches(
            activeIdentity: nil,
            workSessionId: "session-1",
            workSessionRevision: 4,
            invocationId: "invocation-1",
            interactionId: "interaction-1"
        ))
    }

    private func makeProposal(expiryMs: Int, allowedOperation: String?) -> ActionProposalPayload {
        ActionProposalPayload(
            actionId: "action-1",
            kind: "repository_action",
            description: "Fix the verifier",
            previewText: nil,
            targetFingerprint: TargetFingerprintPayload(
                elementRef: nil,
                selectedTextDigest: nil,
                fieldValueDigest: nil,
                repositoryRoot: "/tmp/project",
                branch: "main",
                headDigest: "head-1",
                statusDigest: "status-1"
            ),
            workSessionRevision: 4,
            diagnosedIssueId: "issue-1",
            finishCondition: "Tests pass",
            expiryMs: expiryMs,
            allowedOperation: allowedOperation,
            shellCommands: nil
        )
    }
}
