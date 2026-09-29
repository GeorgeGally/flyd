import CoreGraphics
import XCTest
@testable import FlydMacAdapter

final class KeyEventFilterTests: XCTestCase {
    private let fn = KeyEventFilter.fnKeyCode
    private let escape = ShortcutRouter.escapeKeyCode
    private let control: CGKeyCode = 59

    private func drops(_ filter: inout KeyEventFilter, _ type: CGEventType, _ keyCode: CGKeyCode, _ flags: CGEventFlags, _ routed: [ShortcutRouteEvent] = []) -> Bool {
        filter.shouldDrop(eventType: type, keyCode: keyCode, flags: flags, routed: routed)
    }

    func testSwallowsFnAlonePressAndRelease() {
        var filter = KeyEventFilter()

        XCTAssertEqual(drops(&filter, .flagsChanged, fn, [.maskSecondaryFn]), true)
        XCTAssertEqual(drops(&filter, .flagsChanged, fn, []), true)
    }

    func testPassesFnThatJoinsAChord() {
        var filter = KeyEventFilter()

        XCTAssertEqual(drops(&filter, .flagsChanged, control, [.maskControl]), false)
        XCTAssertEqual(drops(&filter, .flagsChanged, fn, [.maskControl, .maskSecondaryFn]), false)
        XCTAssertEqual(drops(&filter, .flagsChanged, fn, [.maskControl]), false)
        XCTAssertEqual(drops(&filter, .flagsChanged, control, []), false)
    }

    func testReleaseOfAPassedThroughFnPressAlsoPasses() {
        var filter = KeyEventFilter()

        XCTAssertEqual(drops(&filter, .flagsChanged, fn, [.maskCommand, .maskSecondaryFn]), false)
        XCTAssertEqual(drops(&filter, .flagsChanged, 55, [.maskSecondaryFn]), false)
        XCTAssertEqual(drops(&filter, .flagsChanged, fn, []), false)
    }

    func testPassesOrdinaryKeys() {
        var filter = KeyEventFilter()

        XCTAssertEqual(drops(&filter, .keyDown, 9, [.maskCommand]), false)
        XCTAssertEqual(drops(&filter, .keyUp, 9, [.maskCommand]), false)
    }

    func testSwallowsEscapeOnlyWhenItCancelledADictation() {
        var filter = KeyEventFilter()

        XCTAssertEqual(drops(&filter, .keyDown, escape, [], [.dictationCancel]), true)
        XCTAssertEqual(drops(&filter, .keyUp, escape, []), true)
        XCTAssertEqual(drops(&filter, .keyDown, escape, [], []), false)
        XCTAssertEqual(drops(&filter, .keyUp, escape, []), false)
    }
}
