import AppKit
import XCTest
@testable import FlydMacAdapter

final class DictationPillTests: XCTestCase {
    private let macBook = NSRect(x: 0, y: 0, width: 1512, height: 982)
    private let notch = NSRect(x: 656, y: 950, width: 200, height: 32)

    func testGrowsWingsEitherSideOfTheNotch() {
        // Notch 200 + two 86pt wings + two 8pt shoulders.
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, strip: nil)
        XCTAssertEqual(frame, NSRect(x: 562, y: 950, width: 388, height: 32))
    }

    func testGrowsOutToTheRightOfTheNotchForAMessage() {
        // Anchored at the notch's left edge (less its shoulder), notch height, 400pt strip beyond the notch.
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, strip: 400)
        XCTAssertEqual(frame, NSRect(x: 648, y: 950, width: 200 + 400 + 2 * 8, height: 32))
    }

    func testLongMessagesTruncateRatherThanWidenPastTheStripLimit() {
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, strip: 2000)
        XCTAssertEqual(frame.width, notch.width + DictationPill.maxStripWidth + 2 * DictationPill.compactShoulder)
        XCTAssertEqual(frame.height, notch.height)
    }

    func testSitsTopCentreOnScreensWithoutANotch() {
        let frame = DictationPill.islandFrame(screen: NSRect(x: 1440, y: 0, width: 1920, height: 1080), notch: nil, strip: nil)
        XCTAssertEqual(frame, NSRect(x: 2306, y: 1046, width: 188, height: 34))
    }

    func testNeverWiderThanTheScreen() {
        let frame = DictationPill.islandFrame(screen: NSRect(x: 0, y: 0, width: 300, height: 500), notch: nil, strip: 400)
        XCTAssertEqual(frame, NSRect(x: 127, y: 466, width: 173, height: 34))
    }

    func testCanvasHoldsTheWingsTheWidestStripAndItsShadow() {
        let canvas = DictationPill.canvasFrame(screen: macBook, notch: notch)
        let compact = DictationPill.islandFrame(screen: macBook, notch: notch, strip: nil)
        let widest = DictationPill.islandFrame(screen: macBook, notch: notch, strip: DictationPill.maxStripWidth)
        XCTAssertTrue(canvas.contains(compact))
        XCTAssertTrue(canvas.contains(widest))
        XCTAssertEqual(canvas.maxY, macBook.maxY)
        XCTAssertGreaterThan(widest.minY, canvas.minY)
    }

    func testStripTextIsReadableAtAGlanceAndFitsTheNotchHeight() {
        XCTAssertGreaterThanOrEqual(DictationPill.titleFont.pointSize, 19)
        XCTAssertGreaterThanOrEqual(DictationPill.bodyFont.pointSize, 19)
        XCTAssertGreaterThanOrEqual(DictationPill.metaFont.pointSize, 14)
        XCTAssertLessThanOrEqual(DictationPill.lineHeight(DictationPill.titleFont), notch.height)
    }

    func testStripWidthWrapsTheLineInPadding() {
        XCTAssertEqual(DictationPill.stripWidth(text: 300), 300 + 2 * DictationPill.stripPadding + 9 + 8)
        XCTAssertEqual(DictationPill.stripWidth(text: 5000), DictationPill.maxStripWidth)
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
        let strip = DictationPill.islandPath(in: NSRect(x: 0, y: 0, width: 616, height: 32), shoulder: 8, cornerRadius: 15)
        XCTAssertEqual(Self.elementCount(collapsed), Self.elementCount(strip))
        XCTAssertEqual(strip.boundingBoxOfPath.maxY, 32)
        XCTAssertEqual(strip.boundingBoxOfPath.minY, 0)
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

    func testConversationStatusReadsInTheCardWhenItHasWords() {
        XCTAssertNil(DictationPill.message(for: .status("", .working)))
        XCTAssertNil(DictationPill.message(for: .status("Sent", .sent)))
        XCTAssertEqual(
            DictationPill.message(for: .status("PR 68 is green and ready to merge.", .reply)),
            DictationPill.Message(meta: "Reply", title: "PR 68 is green and ready to merge.", body: nil)
        )
        XCTAssertEqual(
            DictationPill.message(for: .status("Needs you: Merge it?", .decision)),
            DictationPill.Message(meta: "Needs you", title: "Merge it?", body: nil)
        )
        XCTAssertEqual(DictationPill.holdDuration(for: .status("Merge it?", .decision)), 10)
        XCTAssertNil(DictationPill.holdDuration(for: .status("", .working)))
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
