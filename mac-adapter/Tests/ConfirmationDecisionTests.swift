import XCTest
@testable import FlydMacAdapter

final class ConfirmationDecisionTests: XCTestCase {

    func testRequiresConfirmationIsFalseWhenReasonsEmpty() {
        let decision = ConfirmationDecision(reasons: [])
        XCTAssertFalse(decision.requiresConfirmation)
    }

    func testRequiresConfirmationIsTrueWithSingleReason() {
        let decision = ConfirmationDecision(reasons: [.executionConsequence])
        XCTAssertTrue(decision.requiresConfirmation)
    }

    func testRequiresConfirmationIsTrueWithMultipleReasons() {
        let decision = ConfirmationDecision(reasons: [.executionConsequence, .destructiveReplacement])
        XCTAssertTrue(decision.requiresConfirmation)
    }

    func testExecutionConsequenceDisplayName() {
        XCTAssertEqual(ConfirmationDecision.Reason.executionConsequence.displayName, "external consequence")
    }

    func testDestructiveReplacementDisplayName() {
        XCTAssertEqual(ConfirmationDecision.Reason.destructiveReplacement.displayName, "large replacement")
    }

    func testActionGrantInvalidDisplayName() {
        XCTAssertEqual(ConfirmationDecision.Reason.actionGrantInvalid.displayName, "action grant invalid")
    }

    func testTargetDriftedDisplayName() {
        XCTAssertEqual(ConfirmationDecision.Reason.targetDrifted.displayName, "target drifted")
    }

    func testRequiresConfirmationWithGrantInvalid() {
        let decision = ConfirmationDecision(reasons: [.actionGrantInvalid])
        XCTAssertTrue(decision.requiresConfirmation)
    }

    func testRequiresConfirmationWithTargetDrifted() {
        let decision = ConfirmationDecision(reasons: [.targetDrifted])
        XCTAssertTrue(decision.requiresConfirmation)
    }
}
