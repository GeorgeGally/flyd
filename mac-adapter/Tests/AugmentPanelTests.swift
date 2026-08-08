import XCTest
@testable import FlydMacAdapter

final class AugmentPanelTests: XCTestCase {

    func testMeasureIsTallerWithOptionsThanWithout() {
        let withoutOptions = AugmentPanel.measure(content: "Use this reply.", options: nil)
        let withOptions = AugmentPanel.measure(content: "Use this reply.", options: ["A", "B", "C"])

        XCTAssertGreaterThan(withOptions.height, withoutOptions.height)
    }

    func testMeasureWidthIsFixed() {
        let size = AugmentPanel.measure(content: "Any content", options: nil)
        XCTAssertEqual(size.width, AugmentPanel.panelWidth)
    }

    func testStackedFramesDoNotOverlap() {
        let sizes = [
            NSSize(width: 360, height: 100),
            NSSize(width: 360, height: 80),
            NSSize(width: 360, height: 120),
        ]
        let anchor = NSRect(x: 500, y: 500, width: 0, height: 0)
        let screen = NSRect(x: 0, y: 0, width: 1920, height: 1080)

        let frames = AugmentPanel.stackedFrames(sizes: sizes, anchorRect: anchor, screenVisibleFrame: screen)

        XCTAssertEqual(frames.count, 3)
        for i in 1..<frames.count {
            XCTAssertLessThanOrEqual(frames[i].maxY, frames[i - 1].minY)
        }
    }

    func testStackedFramesClampToScreenBounds() {
        let sizes = [NSSize(width: 360, height: 100)]
        let anchor = NSRect(x: 1900, y: 1070, width: 0, height: 0)
        let screen = NSRect(x: 0, y: 0, width: 1920, height: 1080)

        let frames = AugmentPanel.stackedFrames(sizes: sizes, anchorRect: anchor, screenVisibleFrame: screen)

        XCTAssertEqual(frames.count, 1)
        let frame = frames[0]
        XCTAssertGreaterThanOrEqual(frame.minX, screen.minX)
        XCTAssertLessThanOrEqual(frame.maxX, screen.maxX)
        XCTAssertGreaterThanOrEqual(frame.minY, screen.minY)
        XCTAssertLessThanOrEqual(frame.maxY, screen.maxY)
    }

    func testCardIsInteractiveForControlKind() {
        XCTAssertTrue(AugmentPanel.cardIsInteractive(kind: "control", hasOptions: false))
    }

    func testCardIsInteractiveWithOptions() {
        XCTAssertTrue(AugmentPanel.cardIsInteractive(kind: "explanation", hasOptions: true))
    }

    func testCardIsNotInteractiveForExplanationWithoutOptions() {
        XCTAssertFalse(AugmentPanel.cardIsInteractive(kind: "explanation", hasOptions: false))
    }

    func testCardIsNotInteractiveForAnnotationWithoutOptions() {
        XCTAssertFalse(AugmentPanel.cardIsInteractive(kind: "annotation", hasOptions: false))
    }

    func testLongAnswerUsesScrollableContentInsteadOfClippingText() {
        let content = Array(repeating: "This is a complete sentence with enough words to wrap.", count: 80)
            .joined(separator: " ")

        let layout = AugmentPanel.contentLayout(content: content)

        XCTAssertTrue(layout.isScrollable)
        XCTAssertGreaterThan(layout.naturalHeight, layout.visibleHeight)
        XCTAssertEqual(layout.visibleHeight, AugmentPanel.maximumVisibleContentHeight)
    }

    func testWorkInterventionCardIncludesFeedbackOptions() {
        let panel = AugmentPanel()
        let acceptCalled = expectation(description: "accept called")
        let rejectCalled = expectation(description: "reject called")

        panel.onAccept = { acceptCalled.fulfill() }
        panel.onReject = { rejectCalled.fulfill() }

        let size = AugmentPanel.measure(content: "Critical: something is wrong", options: ["Correct", "Follow-up"])
        panel.showWorkIntervention(
            content: "Critical: something is wrong\n\nThe issue is in the login function",
            diagnosis: "Function lacks error handling",
            strongerAlternative: "Wrap in do/catch block",
            options: ["Show me the fix", "Explain more"],
            feedbackKind: .intervention,
            frame: NSRect(x: 100, y: 100, width: size.width, height: size.height)
        )

        panel.onAccept?()
        panel.onReject?()

        wait(for: [acceptCalled, rejectCalled], timeout: 1.0)
    }

    func testActionProposalCardIncludesApproveControl() {
        let panel = AugmentPanel()
        let approveCalled = expectation(description: "approve called")

        panel.onApproveAction = { approveCalled.fulfill() }

        let size = AugmentPanel.measure(content: "Proposed: Replace the function", options: ["Approve Action"])
        panel.showWorkIntervention(
            content: "Proposed: Replace the login function with error-handled version",
            diagnosis: "Function lacks error handling",
            strongerAlternative: nil,
            options: [],
            feedbackKind: .actionProposal,
            frame: NSRect(x: 100, y: 100, width: size.width, height: size.height)
        )

        panel.onApproveAction?()
        wait(for: [approveCalled], timeout: 1.0)
    }

    func testFeedbackCallbacksAreIndependent() {
        let panel = AugmentPanel()
        var acceptFired = false
        var rejectFired = false
        var correctFired = false
        var followUpFired = false

        panel.onAccept = { acceptFired = true }
        panel.onReject = { rejectFired = true }
        panel.onCorrect = { _ in correctFired = true }
        panel.onFollowUp = { _ in followUpFired = true }

        panel.onAccept?()
        XCTAssertTrue(acceptFired)
        XCTAssertFalse(rejectFired)
        XCTAssertFalse(correctFired)
        XCTAssertFalse(followUpFired)

        panel.onReject?()
        XCTAssertTrue(rejectFired)

        panel.onCorrect?("actually, the issue is X")
        XCTAssertTrue(correctFired)

        panel.onFollowUp?("can you elaborate?")
        XCTAssertTrue(followUpFired)
    }

    func testDismissDoesNotInferAcceptance() {
        let panel = AugmentPanel()
        var feedbackReceived = false

        panel.onAccept = { feedbackReceived = true }
        panel.onReject = { feedbackReceived = true }

        let size = AugmentPanel.measure(content: "Test content", options: nil)
        panel.showWorkIntervention(
            content: "Test",
            diagnosis: "Test issue",
            strongerAlternative: nil,
            options: nil,
            feedbackKind: .intervention,
            frame: NSRect(x: 100, y: 100, width: size.width, height: size.height)
        )

        panel.dismiss()

        XCTAssertFalse(feedbackReceived)
    }
}
