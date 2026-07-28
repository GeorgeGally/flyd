import CoreGraphics
import XCTest
@testable import FlydMacAdapter

final class ShortcutRoutingTests: XCTestCase {
    private func tap(_ state: inout ShortcutRoutingState, at time: TimeInterval) -> ShortcutRouteEvent {
        _ = ShortcutRouter.route(eventType: .flagsChanged, flags: [.maskSecondaryFn], state: &state, now: time)
        return ShortcutRouter.route(eventType: .flagsChanged, flags: [], state: &state, now: time + 0.05)
    }

    func testDoubleTapFnRoutesToText() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), .none)
        XCTAssertEqual(tap(&state, at: 0.2), .textTapped)
    }

    func testSingleFnTapDoesNothing() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), .none)
    }

    func testSlowSecondTapDoesNotTriggerText() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), .none)
        XCTAssertEqual(tap(&state, at: 1.0), .none)
    }

    func testThirdTapAfterDoubleTapStartsFreshChain() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), .none)
        XCTAssertEqual(tap(&state, at: 0.2), .textTapped)
        XCTAssertEqual(tap(&state, at: 0.4), .none)
    }

    func testControlOptionNoLongerRoutesToText() {
        var state = ShortcutRoutingState()

        let pressed = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [.maskControl, .maskAlternate],
            state: &state
        )
        XCTAssertEqual(pressed, .none)

        let released = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [],
            state: &state
        )
        XCTAssertEqual(released, .none)
    }

    func testFunctionControlRoutesToVoiceOnPressAndRelease() {
        var state = ShortcutRoutingState()

        let pressed = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [.maskControl, .maskSecondaryFn],
            state: &state
        )
        XCTAssertEqual(pressed, .voicePressed)

        let released = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [],
            state: &state
        )
        XCTAssertEqual(released, .voiceReleased)
    }

    func testFnFirstVoiceChordStillRoutesToVoice() {
        var state = ShortcutRoutingState()

        let fnDown = ShortcutRouter.route(eventType: .flagsChanged, flags: [.maskSecondaryFn], state: &state, now: 0.0)
        XCTAssertEqual(fnDown, .none)

        let controlJoined = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [.maskControl, .maskSecondaryFn],
            state: &state,
            now: 0.1
        )
        XCTAssertEqual(controlJoined, .voicePressed)

        let released = ShortcutRouter.route(eventType: .flagsChanged, flags: [], state: &state, now: 0.5)
        XCTAssertEqual(released, .voiceReleased)
    }

    func testFnTapThenVoiceChordDoesNotFireText() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), .none)

        let pressed = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [.maskControl, .maskSecondaryFn],
            state: &state,
            now: 0.2
        )
        XCTAssertEqual(pressed, .voicePressed)

        let released = ShortcutRouter.route(eventType: .flagsChanged, flags: [], state: &state, now: 0.4)
        XCTAssertEqual(released, .voiceReleased)

        // The fn release inside the voice chord must not chain into a text tap.
        XCTAssertEqual(tap(&state, at: 0.5), .none)
    }

    func testVoiceChordIsInactiveWhenEitherKeyIsReleased() {
        XCTAssertTrue(ShortcutRouter.isVoiceChordActive(flags: [.maskControl, .maskSecondaryFn]))
        XCTAssertFalse(ShortcutRouter.isVoiceChordActive(flags: [.maskControl]))
        XCTAssertFalse(ShortcutRouter.isVoiceChordActive(flags: [.maskSecondaryFn]))
        XCTAssertFalse(ShortcutRouter.isVoiceChordActive(flags: []))
    }

    func testChordWithAllThreeModifiersRoutesToNone() {
        var state = ShortcutRoutingState()

        let event = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [.maskControl, .maskAlternate, .maskSecondaryFn],
            state: &state
        )

        XCTAssertEqual(event, .none)
    }
}
