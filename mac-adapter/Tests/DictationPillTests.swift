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

    func testGrowsOutToTheRightOfTheNotchAndHangsBelowTheMenuBarForAMessage() {
        // Anchored at the notch's left edge (less its shoulder), flush with the top, the strip beyond the notch.
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, strip: NSSize(width: 400, height: 120))
        XCTAssertEqual(frame, NSRect(x: 648, y: 982 - 120, width: 200 + 400 + 2 * 8, height: 120))
    }

    func testEveryMessageGetsTheSameStrip() {
        let short = DictationPill.stripLayout(for: .init(meta: "Reply", title: "PR 92 is green.", body: nil), maxWidth: 1000)
        let long = DictationPill.stripLayout(for: .init(meta: "Needs you", title: String(repeating: "a much longer message ", count: 20), body: nil), maxWidth: 1000)
        let notice = DictationPill.stripLayout(for: .init(meta: "Flyd", title: "Voice setup needs attention", body: "Open Flyd settings"), maxWidth: 1000)
        XCTAssertEqual(short.size, NSSize(width: DictationPill.stripWidth, height: DictationPill.stripHeight))
        XCTAssertEqual(long.size, short.size)
        XCTAssertEqual(notice.size, short.size)
        XCTAssertGreaterThan(DictationPill.stripHeight, notch.height)
    }

    func testTheStripNeverRunsPastTheRoomBesideTheNotch() {
        let layout = DictationPill.stripLayout(for: .init(meta: "Reply", title: "PR 92 is green.", body: nil), maxWidth: 420)
        XCTAssertEqual(layout.size.width, 420)
        XCTAssertEqual(layout.size.height, DictationPill.stripHeight)
    }

    func testLongMessagesTruncateAtAWordOnTwoLines() {
        let title = "The island now hangs a larger message beside the notch, and the conversation view keeps every outcome, decision and ask in its summary."
        let layout = DictationPill.stripLayout(for: .init(meta: "Reply", title: title, body: nil), maxWidth: 1000)
        let shown = layout.title.text.string
        XCTAssertTrue(shown.hasSuffix("…"))
        XCTAssertTrue(title.hasPrefix(String(shown.dropLast())))
        XCTAssertTrue(title.dropFirst(shown.count - 1).first == " " || title.dropFirst(shown.count - 1).first == ",")
        XCTAssertEqual(layout.title.size.height, 2 * DictationPill.lineHeight(DictationPill.titleFont))
    }

    func testTwoLineMessagesBreakEvenly() {
        let layout = DictationPill.stripLayout(for: .init(meta: "Needs you", title: "Merge the island type change now, or hold it for the morning build?", body: nil), maxWidth: 1000)
        XCTAssertEqual(layout.title.size.height, 2 * DictationPill.lineHeight(DictationPill.titleFont))
        // Balanced: narrower than the strip's text width, rather than a full line and a short one.
        XCTAssertLessThan(layout.title.size.width, DictationPill.stripWidth - 2 * DictationPill.stripInset - 40)
    }

    func testSitsTopCentreOnScreensWithoutANotch() {
        let frame = DictationPill.islandFrame(screen: NSRect(x: 1440, y: 0, width: 1920, height: 1080), notch: nil, strip: nil)
        XCTAssertEqual(frame, NSRect(x: 2306, y: 1046, width: 188, height: 34))
    }

    func testNeverWiderThanTheScreen() {
        let frame = DictationPill.islandFrame(screen: NSRect(x: 0, y: 0, width: 300, height: 500), notch: nil, strip: NSSize(width: 400, height: 34))
        XCTAssertEqual(frame, NSRect(x: 127, y: 466, width: 173, height: 34))
    }

    func testCanvasHoldsTheWingsTheStripAndItsShadow() {
        let canvas = DictationPill.canvasFrame(screen: macBook, notch: notch)
        let compact = DictationPill.islandFrame(screen: macBook, notch: notch, strip: nil)
        let strip = DictationPill.islandFrame(screen: macBook, notch: notch,
                                              strip: NSSize(width: DictationPill.stripWidth, height: DictationPill.stripHeight))
        XCTAssertTrue(canvas.contains(compact))
        XCTAssertTrue(canvas.contains(strip))
        XCTAssertEqual(canvas.maxY, macBook.maxY)
        XCTAssertGreaterThan(strip.minY, canvas.minY)
    }

    func testMessageTypeIsLargeAndTheSameSizeForEveryMessage() {
        XCTAssertGreaterThanOrEqual(DictationPill.titleFont.pointSize, 28)
        let short = DictationPill.stripLayout(for: .init(meta: "Reply", title: "Done.", body: nil), maxWidth: 1000)
        let long = DictationPill.stripLayout(for: .init(meta: "Reply", title: String(repeating: "word ", count: 80), body: nil), maxWidth: 1000)
        for layout in [short, long] {
            let font = layout.title.text.attribute(.font, at: 0, effectiveRange: nil) as? NSFont
            XCTAssertEqual(font?.pointSize, DictationPill.titleFont.pointSize)
        }
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
        let step = CGPoint(x: notch.maxX, y: notch.minY)
        let collapsed = DictationPill.islandPath(in: notch, shoulder: 0, cornerRadius: 9, step: step)
        let wings = DictationPill.islandPath(in: NSRect(x: 562, y: 950, width: 388, height: 32), shoulder: 8, cornerRadius: 15, step: step)
        let strip = DictationPill.islandPath(in: NSRect(x: 648, y: 862, width: 828, height: 120), shoulder: 8, cornerRadius: 22, step: step)
        XCTAssertEqual(Self.elementCount(collapsed), Self.elementCount(strip))
        XCTAssertEqual(Self.elementCount(wings), Self.elementCount(strip))
        XCTAssertEqual(strip.boundingBoxOfPath.maxY, 982)
        XCTAssertEqual(strip.boundingBoxOfPath.minY, 862)
    }

    func testThePartOverTheNotchStaysNotchHeightBesideTheStrip() {
        let step = CGPoint(x: notch.maxX, y: notch.minY)
        let strip = DictationPill.islandPath(in: NSRect(x: 648, y: 862, width: 828, height: 120), shoulder: 8, cornerRadius: 22, step: step)
        // Under the notch, below the menu bar: outside the island.
        XCTAssertFalse(strip.contains(CGPoint(x: notch.midX, y: notch.minY - 20)))
        // The notch itself and the strip beside it: inside.
        XCTAssertTrue(strip.contains(CGPoint(x: notch.midX, y: notch.midY)))
        XCTAssertTrue(strip.contains(CGPoint(x: notch.maxX + 100, y: 900)))
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
