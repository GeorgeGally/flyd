import XCTest
@testable import FlydMacAdapter

final class ReplacementGateTests: XCTestCase {

    func testReplaceTextAlwaysRequiresConfirmation() {
        XCTAssertTrue(ReplacementGate.requiresConfirmation(
            kind: "replace_text",
            existingValue: "Hello",
            selectedText: "",
            newText: "Hi"
        ))
        XCTAssertTrue(ReplacementGate.requiresConfirmation(
            kind: "replace_text",
            existingValue: "",
            selectedText: "",
            newText: "New"
        ))
    }

    func testReplaceSelectionGatesOnPercentage() {
        // Replacing 80% of existing content
        XCTAssertTrue(ReplacementGate.requiresConfirmation(
            kind: "replace_selection",
            existingValue: "AAAAABBBBB",
            selectedText: "AAAAABBBB",
            newText: "X"
        ))

        // Replacing 50% of existing content
        XCTAssertFalse(ReplacementGate.requiresConfirmation(
            kind: "replace_selection",
            existingValue: "AAAAABBBBB",
            selectedText: "AAAAA",
            newText: "X"
        ))

        // Replacing exactly 75% — should NOT trigger (gate is >75%, not >=75%)
        XCTAssertFalse(ReplacementGate.requiresConfirmation(
            kind: "replace_selection",
            existingValue: "ABC",
            selectedText: "AB",
            newText: "X"
        ))
    }

    func testReplaceSelectionEmptyValue() {
        XCTAssertFalse(ReplacementGate.requiresConfirmation(
            kind: "replace_selection",
            existingValue: "",
            selectedText: "anything",
            newText: "new"
        ))
    }

    func testInsertTextNeverRequiresConfirmation() {
        XCTAssertFalse(ReplacementGate.requiresConfirmation(
            kind: "insert_text",
            existingValue: "huge content here that would be 100% if it were replace",
            selectedText: "",
            newText: "new"
        ))
    }

    func testUnknownKindDoesNotRequireConfirmation() {
        XCTAssertFalse(ReplacementGate.requiresConfirmation(
            kind: "click",
            existingValue: "huge content",
            selectedText: "",
            newText: ""
        ))
    }

    func testEdgeCase75PercentExactly() {
        // 75% exactly — should NOT trigger (strict >75%)
        XCTAssertFalse(ReplacementGate.requiresConfirmation(
            kind: "replace_selection",
            existingValue: "ABCD",
            selectedText: "ABC",
            newText: "X"
        ))
        // 76% — should trigger
        XCTAssertTrue(ReplacementGate.requiresConfirmation(
            kind: "replace_selection",
            existingValue: "ABCDEFGHIJKLMNOPQRSTUVWXY",
            selectedText: "ABCDEFGHIJKLMNOPQRS",
            newText: "X"
        ))
    }
}
