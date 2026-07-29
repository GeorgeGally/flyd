import XCTest
@testable import FlydMacAdapter

final class DictationTargetPolicyTests: XCTestCase {
    func testAllowsOnlyKnownEditableAccessibilityRoles() {
        XCTAssertTrue(DictationTargetPolicy.canInsert(into: "AXTextArea"))
        XCTAssertTrue(DictationTargetPolicy.canInsert(into: "AXTextField"))
        XCTAssertTrue(DictationTargetPolicy.canInsert(into: "AXSearchField"))
    }

    func testRejectsWindowsAndUnknownTargets() {
        XCTAssertFalse(DictationTargetPolicy.canInsert(into: "AXWindow"))
        XCTAssertFalse(DictationTargetPolicy.canInsert(into: "AXUnknown"))
    }
}
