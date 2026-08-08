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

    func testShiftFunctionControlRoutesToDictationOnPressAndRelease() {
        var state = ShortcutRoutingState()

        let pressed = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [.maskShift, .maskControl, .maskSecondaryFn],
            state: &state
        )
        XCTAssertEqual(pressed, .dictationPressed)

        let released = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [],
            state: &state
        )
        XCTAssertEqual(released, .dictationReleased)
    }

    func testConversationAndDictationChordsAreExclusive() {
        XCTAssertTrue(ShortcutRouter.isVoiceChordActive(flags: [.maskControl, .maskSecondaryFn]))
        XCTAssertFalse(ShortcutRouter.isVoiceChordActive(flags: [.maskShift, .maskControl, .maskSecondaryFn]))
        XCTAssertTrue(ShortcutRouter.isDictationChordActive(flags: [.maskShift, .maskControl, .maskSecondaryFn]))
        XCTAssertFalse(ShortcutRouter.isDictationChordActive(flags: [.maskControl, .maskSecondaryFn]))
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

    private func ctrlPress(_ state: inout ShortcutRoutingState, at time: TimeInterval) -> ShortcutRouteEvent {
        let result = ShortcutRouter.route(eventType: .flagsChanged, flags: [.maskControl], state: &state, now: time)
        _ = ShortcutRouter.route(eventType: .flagsChanged, flags: [], state: &state, now: time + 0.02)
        return result
    }

    func testTripleCtrlTapRoutesToLiveToggle() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(ctrlPress(&state, at: 0.0), .none)
        XCTAssertEqual(ctrlPress(&state, at: 0.15), .none)
        XCTAssertEqual(ctrlPress(&state, at: 0.30), .liveToggle)
    }

    func testSlowCtrlPressesDoNotToggle() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(ctrlPress(&state, at: 0.0), .none)
        XCTAssertEqual(ctrlPress(&state, at: 0.15), .none)
        XCTAssertEqual(ctrlPress(&state, at: 1.0), .none)
    }

    func testQuadCtrlPressFiresOnThird() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(ctrlPress(&state, at: 0.0), .none)
        XCTAssertEqual(ctrlPress(&state, at: 0.15), .none)
        XCTAssertEqual(ctrlPress(&state, at: 0.30), .liveToggle)
        XCTAssertEqual(ctrlPress(&state, at: 0.45), .none)
    }

    func testCtrlWithShiftDoesNotCount() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(ctrlPress(&state, at: 0.0), .none)
        let shiftCtrl = ShortcutRouter.route(
            eventType: .flagsChanged,
            flags: [.maskControl, .maskShift],
            state: &state,
            now: 0.15
        )
        XCTAssertEqual(shiftCtrl, .none)
        XCTAssertEqual(ctrlPress(&state, at: 0.30), .none)
    }

    func testCoordinatorPhaseTransitions() {
        let coordinator = WorkInteractionCoordinator.shared

        coordinator.beginSession(sessionId: "test-session", revision: 1)
        XCTAssertEqual(coordinator.phase, .grounding)
        XCTAssertTrue(coordinator.isActive)

        coordinator.cancelActiveInvocation()
        XCTAssertEqual(coordinator.phase, .idle)
        XCTAssertFalse(coordinator.isActive)
    }
}
