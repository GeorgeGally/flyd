import XCTest
@testable import FlydMacAdapter

final class TextInserterTests: XCTestCase {
    func testRestoresClipboardWhenNothingWroteAfterPaste() {
        XCTAssertTrue(TextInserter.shouldRestore(pasted: true, changeCountAfterWrite: 41, changeCountNow: 41))
    }

    func testKeepsClipboardWhenSomeoneWroteAfterPaste() {
        XCTAssertFalse(TextInserter.shouldRestore(pasted: true, changeCountAfterWrite: 41, changeCountNow: 42))
    }

    func testKeepsDictatedTextOnClipboardWhenPasteFailed() {
        XCTAssertFalse(TextInserter.shouldRestore(pasted: false, changeCountAfterWrite: 41, changeCountNow: 41))
    }

    func testPastesIntoTheAppThatWasFrontmostAtStop() {
        XCTAssertEqual(TextInserter.route(secureInputEnabled: false, targetPid: 812, frontmostPid: 812), .paste)
    }

    func testCopiesInsteadWhenSecureInputIsOn() {
        XCTAssertEqual(
            TextInserter.route(secureInputEnabled: true, targetPid: 812, frontmostPid: 812),
            .copyOnly(.secureInput)
        )
    }

    func testCopiesInsteadWhenGeorgeSwitchedApps() {
        XCTAssertEqual(
            TextInserter.route(secureInputEnabled: false, targetPid: 812, frontmostPid: 97),
            .copyOnly(.targetChanged)
        )
    }

    func testTypingSendsNewlinesAsShiftReturn() {
        XCTAssertEqual(
            TextInserter.typingPlan(for: "run the tests\nthen commit"),
            [.text("run the tests"), .shiftReturn, .text("then commit")]
        )
    }

    func testTypingSplitsLongLinesWithoutBreakingEmoji() {
        XCTAssertEqual(
            TextInserter.typingPlan(for: "abcdefghijklmno👍🏽xyz"),
            [.text("abcdefghijklmno👍🏽"), .text("xyz")]
        )
    }
}
