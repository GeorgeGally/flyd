import AppKit
import XCTest
@testable import FlydMacAdapter

final class DictationPillTests: XCTestCase {
    func testSitsBottomCentreOfTheVisibleFrame() {
        let frame = DictationPill.frame(width: 100, in: NSRect(x: 0, y: 25, width: 1440, height: 875))
        XCTAssertEqual(frame, NSRect(x: 670, y: 53, width: 100, height: 34))
    }

    func testNeverWiderThanTheScreen() {
        let frame = DictationPill.frame(width: 900, in: NSRect(x: 1440, y: 0, width: 600, height: 400))
        XCTAssertEqual(frame, NSRect(x: 1468, y: 28, width: 544, height: 34))
    }

    func testTellsGeorgeWhereTheTextWentWhenItWasNotPasted() {
        XCTAssertEqual(DictationController.pillPhase(for: .pasted), .inserted)
        XCTAssertEqual(DictationController.pillPhase(for: .typed), .inserted)
        XCTAssertEqual(
            DictationController.pillPhase(for: .copiedOnly(reason: .targetChanged)),
            .copied("Copied — paste with ⌘V")
        )
        XCTAssertEqual(
            DictationController.pillPhase(for: .copiedOnly(reason: .secureInput)),
            .copied("Secure input is on — copied instead")
        )
    }
}
