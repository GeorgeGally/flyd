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
        XCTAssertEqual(TextInserter.route(secureTyping: .off, targetPid: 812, frontmostPid: 812), .paste)
    }

    func testCopiesInsteadIntoAPasswordBox() {
        XCTAssertEqual(
            TextInserter.route(secureTyping: .passwordField, targetPid: 812, frontmostPid: 812),
            .copyOnly(.secureInput)
        )
    }

    func testPastesWhenAnotherAppHoldsSecureTyping() {
        XCTAssertEqual(TextInserter.route(secureTyping: .heldElsewhere, targetPid: 812, frontmostPid: 812), .paste)
    }

    func testSecureTypingIsOnlyAPasswordBoxWhenTheFieldIsOneOrCannotBeRead() {
        XCTAssertEqual(TextInserter.secureTyping(enabled: false, focusedSubrole: .none), .off)
        XCTAssertEqual(TextInserter.secureTyping(enabled: true, focusedSubrole: .some("AXSecureTextField")), .passwordField)
        XCTAssertEqual(TextInserter.secureTyping(enabled: true, focusedSubrole: .none), .passwordField)
        XCTAssertEqual(TextInserter.secureTyping(enabled: true, focusedSubrole: .some(nil)), .heldElsewhere)
        XCTAssertEqual(TextInserter.secureTyping(enabled: true, focusedSubrole: .some("AXTextArea")), .heldElsewhere)
    }

    func testCopiesInsteadWhenGeorgeSwitchedApps() {
        XCTAssertEqual(
            TextInserter.route(secureTyping: .off, targetPid: 812, frontmostPid: 97),
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
