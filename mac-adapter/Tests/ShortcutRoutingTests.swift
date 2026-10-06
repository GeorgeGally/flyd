import CoreGraphics
import XCTest
@testable import FlydMacAdapter

final class ShortcutRoutingTests: XCTestCase {
    private let fn: CGEventFlags = [.maskSecondaryFn]
    private let ctrlFn: CGEventFlags = [.maskControl, .maskSecondaryFn]

    private func flags(_ flags: CGEventFlags, _ state: inout ShortcutRoutingState, at time: TimeInterval) -> [ShortcutRouteEvent] {
        ShortcutRouter.route(eventType: .flagsChanged, flags: flags, state: &state, now: time)
    }

    private func key(_ keyCode: CGKeyCode, _ state: inout ShortcutRoutingState, at time: TimeInterval) -> [ShortcutRouteEvent] {
        ShortcutRouter.route(eventType: .keyDown, flags: [], keyCode: keyCode, state: &state, now: time)
    }

    /// fn down at `time`, up 0.05 s later; returns every event the two edges produced.
    private func tap(_ state: inout ShortcutRoutingState, at time: TimeInterval) -> [ShortcutRouteEvent] {
        flags(fn, &state, at: time) + flags([], &state, at: time + 0.05)
    }

    func testTapStartsDictationAndNextTapStopsIt() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), [.dictationStart])
        XCTAssertEqual(tap(&state, at: 3.0), [.dictationStop])
        XCTAssertEqual(tap(&state, at: 5.0), [.dictationStart])
    }

    func testHoldIsPushToTalk() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(flags(fn, &state, at: 0.0), [.dictationStart])
        XCTAssertEqual(flags([], &state, at: 2.5), [.dictationStop])
        XCTAssertEqual(tap(&state, at: 4.0), [.dictationStart])
    }

    func testDoubleTapCancelsTheRecordingAndOpensTextOnRelease() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), [.dictationStart])
        XCTAssertEqual(flags(fn, &state, at: 0.2), [.dictationCancel])
        XCTAssertEqual(flags([], &state, at: 0.25), [.textTapped])
        XCTAssertEqual(tap(&state, at: 1.0), [.dictationStart])
    }

    /// The captain's Fn+Control often begins with Fn a moment early, soon after an
    /// earlier Fn tap; that must be talking to Flyd, never the text bar.
    func testControlJoiningASecondFnPressIsTalkingToFlydNotTheTextBar() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), [.dictationStart])
        XCTAssertEqual(flags(fn, &state, at: 0.2), [.dictationCancel])
        XCTAssertEqual(flags(ctrlFn, &state, at: 0.24), [.voicePressed])
        XCTAssertEqual(flags([], &state, at: 1.5), [.voiceReleased])
        XCTAssertEqual(tap(&state, at: 3.0), [.dictationStart])
    }

    func testFnControlNeverOpensTheTextBar() {
        var state = ShortcutRoutingState()
        var events: [ShortcutRouteEvent] = []
        // Every ordering of the two keys, quick and slow, repeated.
        for start in stride(from: 0.0, to: 6.0, by: 1.5) {
            events += flags(fn, &state, at: start)
            events += flags(ctrlFn, &state, at: start + 0.02)
            events += flags([.maskControl], &state, at: start + 0.4)
            events += flags([], &state, at: start + 0.42)
            events += flags([.maskControl], &state, at: start + 0.6)
            events += flags(ctrlFn, &state, at: start + 0.62)
            events += flags(fn, &state, at: start + 1.0)
            events += flags([], &state, at: start + 1.02)
        }
        XCTAssertFalse(events.contains(.textTapped))
        XCTAssertEqual(events.filter { $0 == .voicePressed }.count, 8)
    }

    func testSecondTapJustOutsideTheWindowStopsInstead() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), [.dictationStart])
        XCTAssertEqual(tap(&state, at: 0.5), [.dictationStop])
    }

    func testControlJoiningFnCancelsDictationAndStartsConversation() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(flags(fn, &state, at: 0.0), [.dictationStart])
        XCTAssertEqual(flags(ctrlFn, &state, at: 0.1), [.dictationCancel, .voicePressed])
        XCTAssertEqual(flags([], &state, at: 0.6), [.voiceReleased])
        XCTAssertEqual(tap(&state, at: 1.0), [.dictationStart])
    }

    func testKeyPressedWhileFnHeldCancelsDictation() {
        var state = ShortcutRoutingState()
        let leftArrow: CGKeyCode = 123

        XCTAssertEqual(flags(fn, &state, at: 0.0), [.dictationStart])
        XCTAssertEqual(key(leftArrow, &state, at: 0.1), [.dictationCancel])
        XCTAssertEqual(flags([], &state, at: 0.2), [])
        XCTAssertEqual(tap(&state, at: 1.0), [.dictationStart])
    }

    func testOtherModifierJoiningFnCancelsDictation() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(flags(fn, &state, at: 0.0), [.dictationStart])
        XCTAssertEqual(flags([.maskSecondaryFn, .maskCommand], &state, at: 0.1), [.dictationCancel])
        XCTAssertEqual(flags(fn, &state, at: 0.2), [])
        XCTAssertEqual(flags([], &state, at: 0.3), [])
    }

    func testEscapeCancelsHandsFreeDictation() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), [.dictationStart])
        XCTAssertEqual(key(ShortcutRouter.escapeKeyCode, &state, at: 2.0), [.dictationCancel])
        XCTAssertEqual(tap(&state, at: 3.0), [.dictationStart])
    }

    func testTypingDuringHandsFreeDictationKeepsRecording() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), [.dictationStart])
        XCTAssertEqual(key(0, &state, at: 1.0), [])
        XCTAssertEqual(tap(&state, at: 2.0), [.dictationStop])
    }

    func testDictationEndedElsewhereLetsTheNextTapStartFresh() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), [.dictationStart])
        ShortcutRouter.endDictation(state: &state)
        XCTAssertEqual(tap(&state, at: 300.0), [.dictationStart])
    }

    func testFunctionControlRoutesToVoiceOnPressAndRelease() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(flags([.maskControl], &state, at: 0.0), [])
        XCTAssertEqual(flags(ctrlFn, &state, at: 0.1), [.voicePressed])
        XCTAssertEqual(flags([.maskControl], &state, at: 0.8), [.voiceReleased])
        XCTAssertEqual(flags([], &state, at: 0.9), [])
    }

    func testVoiceChordDuringHandsFreeDictationCancelsIt() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(tap(&state, at: 0.0), [.dictationStart])
        XCTAssertEqual(flags([.maskControl], &state, at: 1.0), [])
        XCTAssertEqual(flags(ctrlFn, &state, at: 1.1), [.dictationCancel, .voicePressed])
        XCTAssertEqual(flags([], &state, at: 1.5), [.voiceReleased])
    }

    func testShiftControlFnNoLongerDictates() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(flags([.maskShift], &state, at: 0.0), [])
        XCTAssertEqual(flags([.maskShift, .maskControl], &state, at: 0.05), [])
        XCTAssertEqual(flags([.maskShift, .maskControl, .maskSecondaryFn], &state, at: 0.1), [])
        XCTAssertEqual(flags([], &state, at: 0.5), [])
    }

    func testControlOptionDoesNotRoute() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(flags([.maskControl, .maskAlternate], &state, at: 0.0), [])
        XCTAssertEqual(flags([], &state, at: 0.1), [])
    }

    func testVoiceChordIsInactiveWhenEitherKeyIsReleased() {
        XCTAssertTrue(ShortcutRouter.isVoiceChordActive(flags: ctrlFn))
        XCTAssertFalse(ShortcutRouter.isVoiceChordActive(flags: [.maskShift, .maskControl, .maskSecondaryFn]))
        XCTAssertFalse(ShortcutRouter.isVoiceChordActive(flags: [.maskControl]))
        XCTAssertFalse(ShortcutRouter.isVoiceChordActive(flags: fn))
        XCTAssertFalse(ShortcutRouter.isVoiceChordActive(flags: []))
    }

    private func ctrlPress(_ state: inout ShortcutRoutingState, at time: TimeInterval) -> [ShortcutRouteEvent] {
        flags([.maskControl], &state, at: time) + flags([], &state, at: time + 0.02)
    }

    func testTripleCtrlTapRoutesToLiveToggle() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(ctrlPress(&state, at: 0.0), [])
        XCTAssertEqual(ctrlPress(&state, at: 0.15), [])
        XCTAssertEqual(ctrlPress(&state, at: 0.30), [.liveToggle])
    }

    func testSlowCtrlPressesDoNotToggle() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(ctrlPress(&state, at: 0.0), [])
        XCTAssertEqual(ctrlPress(&state, at: 0.15), [])
        XCTAssertEqual(ctrlPress(&state, at: 1.0), [])
    }

    func testQuadCtrlPressFiresOnThird() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(ctrlPress(&state, at: 0.0), [])
        XCTAssertEqual(ctrlPress(&state, at: 0.15), [])
        XCTAssertEqual(ctrlPress(&state, at: 0.30), [.liveToggle])
        XCTAssertEqual(ctrlPress(&state, at: 0.45), [])
    }

    func testCtrlWithShiftDoesNotCount() {
        var state = ShortcutRoutingState()

        XCTAssertEqual(ctrlPress(&state, at: 0.0), [])
        XCTAssertEqual(flags([.maskControl, .maskShift], &state, at: 0.15), [])
        XCTAssertEqual(ctrlPress(&state, at: 0.30), [])
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
