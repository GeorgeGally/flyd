import AppKit
import XCTest
@testable import FlydMacAdapter

final class DictationPillTests: XCTestCase {
    private let macBook = NSRect(x: 0, y: 0, width: 1512, height: 982)
    private let notch = NSRect(x: 656, y: 950, width: 200, height: 32)

    func testGrowsWingsEitherSideOfTheNotch() {
        // Notch 200 + two 86pt wings + two 8pt shoulders.
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, card: nil)
        XCTAssertEqual(frame, NSRect(x: 562, y: 950, width: 388, height: 32))
    }

    func testOpensACardBelowTheNotchForAMessage() {
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, card: NSSize(width: 500, height: 120))
        XCTAssertEqual(frame, NSRect(x: 494, y: 830, width: 524, height: 152))
    }

    func testShortMessagesKeepTheWingsWidth() {
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, card: NSSize(width: 200, height: 90))
        XCTAssertEqual(frame.width, 388 - 2 * 8 + 2 * 12)
        XCTAssertEqual(frame.midX, notch.midX)
    }

    func testLongMessagesWrapRatherThanWidenPastTheCardLimit() {
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, card: NSSize(width: 2000, height: 120))
        XCTAssertEqual(frame.width, DictationPill.maxCardWidth + 2 * DictationPill.cardShoulder)
    }

    func testSitsTopCentreOnScreensWithoutANotch() {
        let frame = DictationPill.islandFrame(screen: NSRect(x: 1440, y: 0, width: 1920, height: 1080), notch: nil, card: nil)
        XCTAssertEqual(frame, NSRect(x: 2306, y: 1046, width: 188, height: 34))
    }

    func testNeverWiderThanTheScreen() {
        let frame = DictationPill.islandFrame(screen: NSRect(x: 0, y: 0, width: 300, height: 500), notch: nil, card: NSSize(width: 400, height: 90))
        XCTAssertEqual(frame, NSRect(x: 0, y: 376, width: 300, height: 124))
    }

    func testCanvasHoldsTheLargestCardAndItsShadow() {
        let canvas = DictationPill.canvasFrame(screen: macBook, notch: notch)
        let largest = DictationPill.islandFrame(
            screen: macBook, notch: notch,
            card: NSSize(width: DictationPill.maxCardWidth, height: DictationPill.maxCardHeight)
        )
        XCTAssertTrue(canvas.contains(largest))
        XCTAssertEqual(canvas.maxY, macBook.maxY)
        XCTAssertGreaterThan(largest.minY, canvas.minY)
        XCTAssertEqual(canvas.midX, notch.midX)
    }

    func testCardTextIsReadableAtAGlance() {
        XCTAssertGreaterThanOrEqual(DictationPill.titleFont.pointSize, 22)
        XCTAssertGreaterThanOrEqual(DictationPill.bodyFont.pointSize, 19)
        XCTAssertGreaterThanOrEqual(DictationPill.metaFont.pointSize, 14)
        XCTAssertGreaterThan(DictationPill.titleFont.pointSize, DictationPill.bodyFont.pointSize)
    }

    func testCardSizeWrapsTextInPadding() {
        let size = DictationPill.cardSize(
            meta: NSSize(width: 30, height: 17),
            title: NSSize(width: 300, height: 28),
            body: NSSize(width: 340, height: 46)
        )
        XCTAssertEqual(size.width, 340 + 2 * DictationPill.cardPadding)
        XCTAssertEqual(size.height, 6 + 17 + 8 + 28 + 4 + 46 + 24)
    }

    func testCardFitsThreeTitleLines() {
        let threeLines = 3 * DictationPill.lineHeight(DictationPill.titleFont)
        let size = DictationPill.cardSize(meta: NSSize(width: 30, height: 17), title: NSSize(width: 400, height: threeLines), body: nil)
        XCTAssertLessThanOrEqual(size.height, DictationPill.maxCardHeight)
    }

    func testMessagesSplitIntoTitleAndBody() {
        XCTAssertNil(DictationPill.message(for: .listening))
        XCTAssertNil(DictationPill.message(for: .inserted))
        XCTAssertEqual(
            DictationPill.message(for: .notice("Copied — paste with ⌘V")),
            DictationPill.Message(meta: "Flyd", title: "Copied — paste with ⌘V", body: nil)
        )
        XCTAssertEqual(
            DictationPill.message(for: .failed("Voice setup needs attention\nOpen Flyd settings to reconnect the microphone")),
            DictationPill.Message(meta: "Flyd", title: "Voice setup needs attention", body: "Open Flyd settings to reconnect the microphone")
        )
        XCTAssertEqual(
            DictationPill.message(for: .thinking("what time is it in London")),
            DictationPill.Message(meta: "You asked", title: "what time is it in London", body: nil)
        )
    }

    func testMessagesStayLongEnoughToReadButNoLonger() {
        XCTAssertNil(DictationPill.holdDuration(for: .listening))
        XCTAssertNil(DictationPill.holdDuration(for: .thinking("anything")))
        XCTAssertEqual(DictationPill.holdDuration(for: .inserted), 1.4)
        XCTAssertEqual(DictationPill.holdDuration(for: .notice("No speech")), 1.4)
        let long = DictationPill.holdDuration(for: .failed("The microphone stopped before Flyd heard anything, so try holding the keys a little longer")) ?? 0
        XCTAssertGreaterThan(long, 3)
        XCTAssertEqual(DictationPill.holdDuration(for: .notice(String(repeating: "word ", count: 200))), 6)
    }

    func testIslandOutlinesShareTheirShapeSoTheySpring() {
        let collapsed = DictationPill.islandPath(in: notch, shoulder: 0, cornerRadius: 9)
        let card = DictationPill.islandPath(in: NSRect(x: 0, y: 0, width: 520, height: 150), shoulder: 12, cornerRadius: 30)
        XCTAssertEqual(Self.elementCount(collapsed), Self.elementCount(card))
        XCTAssertEqual(card.boundingBoxOfPath.maxY, 150)
        XCTAssertEqual(card.boundingBoxOfPath.minY, 0)
    }

    private static func elementCount(_ path: CGPath) -> Int {
        var count = 0
        path.applyWithBlock { _ in count += 1 }
        return count
    }

    func testShowsAQuestionCutAtAWord() {
        XCTAssertEqual(DictationPill.quoted("  what time is it in London  "), "what time is it in London")
        let long = "what should I work on next given everything that is going on with CleanX and the launch this week, "
            + "and also the invoices that are still waiting on me from last month"
        let quoted = DictationPill.quoted(long)
        XCTAssertTrue(quoted.hasSuffix("…"))
        XCTAssertLessThanOrEqual(quoted.count, DictationPill.questionLimit + 1)
        XCTAssertTrue(long.hasPrefix(String(quoted.dropLast())))
    }

    func testCollapsesIntoTheNotch() {
        XCTAssertEqual(DictationPill.collapsedFrame(screen: macBook, notch: notch), notch)
    }

    func testTellsGeorgeWhereTheTextWentWhenItWasNotPasted() {
        XCTAssertEqual(DictationController.pillPhase(for: .pasted), .inserted)
        XCTAssertEqual(DictationController.pillPhase(for: .typed), .inserted)
        XCTAssertEqual(
            DictationController.pillPhase(for: .copiedOnly(reason: .targetChanged)),
            .notice("Copied — paste with ⌘V")
        )
        XCTAssertEqual(
            DictationController.pillPhase(for: .copiedOnly(reason: .secureInput)),
            .notice("Secure input is on — copied instead")
        )
    }

    func testDropsRecordingsThatAreTooShortOrSilent() {
        XCTAssertEqual(SpeechGate.heardSpeech(duration: 2.0, peakLevel: 0.6), true)
        XCTAssertEqual(SpeechGate.heardSpeech(duration: 0.2, peakLevel: 0.6), false)
        XCTAssertEqual(SpeechGate.heardSpeech(duration: 4.0, peakLevel: 0.05), false)
    }
}
