import XCTest
@testable import FlydMacAdapter

final class FocusedTextTargetTests: XCTestCase {
    private func classify(_ probe: FocusedTextTarget.Probe) -> FocusedTextTarget {
        FocusedTextTarget.classify(probe)
    }

    func testTextFieldsAndTextAreasTakeTheText() {
        for role in ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"] {
            XCTAssertEqual(classify(.init(lookup: .found, role: role)), .textInput, role)
        }
    }

    func testEditableWebContentTakesTheText() {
        XCTAssertEqual(classify(.init(lookup: .found, role: "AXGroup", valueSettable: true)), .textInput)
        XCTAssertEqual(classify(.init(lookup: .found, role: "AXStaticText", insideEditable: true)), .textInput)
    }

    func testNothingFocusedMeansNoTextField() {
        XCTAssertEqual(classify(.init(lookup: .nothingFocused, bundleId: "com.apple.finder")), .noTextInput)
        XCTAssertEqual(classify(.init(lookup: .found, role: "AXWindow", bundleId: "com.apple.Preview")), .noTextInput)
    }

    func testReadingAPageOrBrowsingAListIsNoTextField() {
        XCTAssertEqual(classify(.init(lookup: .found, role: "AXWebArea", lazyAccessibility: true)), .noTextInput)
        XCTAssertEqual(classify(.init(lookup: .found, role: "AXOutline")), .noTextInput)
        XCTAssertEqual(classify(.init(lookup: .found, role: "AXButton")), .noTextInput)
    }

    func testLazyAccessibilityAppsWithNoAnswerStillGetThePaste() {
        XCTAssertEqual(classify(.init(lookup: .nothingFocused, lazyAccessibility: true)), .unknown)
        XCTAssertEqual(classify(.init(lookup: .found, role: "AXWindow", lazyAccessibility: true)), .unknown)
    }

    func testUnreadableOrUnfamiliarFocusStillGetsThePaste() {
        XCTAssertEqual(classify(.init(lookup: .failed)), .unknown)
        XCTAssertEqual(classify(.init(lookup: .found, role: "AXGroup")), .unknown)
        XCTAssertEqual(classify(.init(lookup: .found, role: nil)), .unknown)
    }

    func testTerminalsAlwaysTakeTheText() {
        XCTAssertEqual(classify(.init(lookup: .nothingFocused, bundleId: "com.cmuxterm.app")), .textInput)
        XCTAssertEqual(classify(.init(lookup: .found, role: "AXGroup", bundleId: "net.kovidgoyal.kitty")), .textInput)
    }

    func testNoTargetAppMeansUnknown() {
        XCTAssertEqual(FocusedTextTarget.current(pid: nil), .unknown)
    }
}
