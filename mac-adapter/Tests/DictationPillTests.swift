import AppKit
import XCTest
@testable import FlydMacAdapter

final class DictationPillTests: XCTestCase {
    private let macBook = NSRect(x: 0, y: 0, width: 1512, height: 982)
    private let notch = NSRect(x: 656, y: 950, width: 200, height: 32)

    func testGrowsWingsEitherSideOfTheNotch() {
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, messageWidth: nil)
        XCTAssertEqual(frame, NSRect(x: 598, y: 950, width: 316, height: 32))
    }

    func testDropsAMessageStripBelowTheNotch() {
        let frame = DictationPill.islandFrame(screen: macBook, notch: notch, messageWidth: 300)
        XCTAssertEqual(frame, NSRect(x: 592, y: 920, width: 328, height: 62))
    }

    func testSitsTopCentreOnScreensWithoutANotch() {
        let frame = DictationPill.islandFrame(screen: NSRect(x: 1440, y: 0, width: 1920, height: 1080), notch: nil, messageWidth: nil)
        XCTAssertEqual(frame, NSRect(x: 2342, y: 1048, width: 116, height: 32))
    }

    func testNeverWiderThanTheScreen() {
        let frame = DictationPill.islandFrame(screen: NSRect(x: 0, y: 0, width: 300, height: 500), notch: nil, messageWidth: 400)
        XCTAssertEqual(frame, NSRect(x: 0, y: 438, width: 300, height: 62))
    }

    func testShowsAQuestionOnOneLineCutAtAWord() {
        XCTAssertEqual(DictationPill.quoted("  what time is it in London  "), "what time is it in London")
        XCTAssertEqual(
            DictationPill.quoted("what should I work on next given everything that is going on with CleanX and the launch this week"),
            "what should I work on next given everything that is going on…"
        )
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
        XCTAssertEqual(
            DictationController.pillPhase(for: .copiedOnly(reason: .noTextField)),
            .notice("Copied to clipboard")
        )
    }

    func testDropsRecordingsThatAreTooShortOrSilent() {
        XCTAssertEqual(SpeechGate.heardSpeech(duration: 2.0, peakLevel: 0.6), true)
        XCTAssertEqual(SpeechGate.heardSpeech(duration: 0.2, peakLevel: 0.6), false)
        XCTAssertEqual(SpeechGate.heardSpeech(duration: 4.0, peakLevel: 0.05), false)
    }
}
