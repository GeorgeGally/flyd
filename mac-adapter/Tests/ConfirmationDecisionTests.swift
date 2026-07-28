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
}
