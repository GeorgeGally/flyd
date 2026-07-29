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
        // Anchor near the top-right corner so the naive frame would fall off-screen.
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
}
