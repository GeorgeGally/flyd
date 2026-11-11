import CoreGraphics
import XCTest
@testable import FlydMacAdapter

final class MicSessionTests: XCTestCase {
    func testOneSessionHoldsTheMicAtATime() {
        var machine = MicSessionMachine()

        let live = machine.begin(.live)
        XCTAssertNotNil(live)
        XCTAssertNil(machine.begin(.dictation), "a start while the mic is held is refused")
        XCTAssertEqual(machine.holder, live)
    }

    func testOnlyTheHoldersTokenEndsTheSession() {
        var machine = MicSessionMachine()
        let first = machine.begin(.voice)!
        XCTAssertTrue(machine.beginEnding(first))
        machine.finish(first)

        let second = machine.begin(.live)!
        XCTAssertFalse(machine.beginEnding(first), "a stale token cannot end the next session")
        XCTAssertEqual(machine.phase, .active(second))
    }

    func testStartsAreRefusedWhileEnding() {
        var machine = MicSessionMachine()
        let token = machine.begin(.dictation)!
        XCTAssertTrue(machine.beginEnding(token))

        XCTAssertNil(machine.begin(.voice))
        machine.finish(token)
        XCTAssertNotNil(machine.begin(.voice))
    }

    func testEndingAlwaysTurnsTheMicOffOnce() {
        var stops = 0
        let mic = MicSession(stopCapture: { stops += 1 })

        let token = mic.begin(.live)!
        mic.end(token)
        mic.end(token)

        XCTAssertEqual(stops, 1)
        XCTAssertNil(mic.holder)
        XCTAssertNotNil(mic.begin(.dictation), "the mic is free again after a session ends")
    }

    func testAStaleEndLeavesTheCurrentSessionsMicOn() {
        var stops = 0
        let mic = MicSession(stopCapture: { stops += 1 })

        let voice = mic.begin(.voice)!
        mic.end(voice)
        let live = mic.begin(.live)!
        mic.end(voice)

        XCTAssertEqual(stops, 1)
        XCTAssertEqual(mic.holder, live)
    }

    /// An fn tap that dictation refused: the router is told, so the next tap starts a
    /// dictation instead of being swallowed as "stop".
    func testRefusedDictationTapIsNotEatenByTheNextTap() {
        let machine = InvocationStateMachine()
        machine.onDictationStart = { false }
        let fn: CGEventFlags = [.maskSecondaryFn]
        func edge(_ flags: CGEventFlags, at time: TimeInterval) -> [ShortcutRouteEvent] {
            ShortcutRouter.route(eventType: .flagsChanged, flags: flags, state: &machine.shortcutRoutingState, now: time)
        }

        XCTAssertEqual(edge(fn, at: 0.0), [.dictationStart])
        machine.startDictationGesture()
        XCTAssertEqual(edge([], at: 0.05), [])
        XCTAssertEqual(edge(fn, at: 3.0), [.dictationStart])
    }

    /// The refusal can land after the tap's release (the start runs on the next main-queue
    /// turn); the next tap still starts fresh.
    func testRefusalArrivingAfterReleaseStillFreesTheNextTap() {
        let machine = InvocationStateMachine()
        machine.onDictationStart = { false }
        let fn: CGEventFlags = [.maskSecondaryFn]
        func edge(_ flags: CGEventFlags, at time: TimeInterval) -> [ShortcutRouteEvent] {
            ShortcutRouter.route(eventType: .flagsChanged, flags: flags, state: &machine.shortcutRoutingState, now: time)
        }

        XCTAssertEqual(edge(fn, at: 0.0), [.dictationStart])
        XCTAssertEqual(edge([], at: 0.05), [])
        machine.startDictationGesture()
        XCTAssertEqual(edge(fn, at: 3.0), [.dictationStart])
    }

    /// A started dictation keeps the gesture, so the next tap stops it.
    func testStartedDictationTapIsStoppedByTheNextTap() {
        let machine = InvocationStateMachine()
        machine.onDictationStart = { true }
        let fn: CGEventFlags = [.maskSecondaryFn]
        func edge(_ flags: CGEventFlags, at time: TimeInterval) -> [ShortcutRouteEvent] {
            ShortcutRouter.route(eventType: .flagsChanged, flags: flags, state: &machine.shortcutRoutingState, now: time)
        }

        XCTAssertEqual(edge(fn, at: 0.0), [.dictationStart])
        machine.startDictationGesture()
        XCTAssertEqual(edge([], at: 0.05), [])
        XCTAssertEqual(edge(fn, at: 3.0) + edge([], at: 3.05), [.dictationStop])
    }

    /// A dropped LIVE bridge ends the session: the mic goes off once, the session is
    /// failed and Flyd is back in present. Before, `.failed` left the mic held.
    func testADroppedLiveBridgeTurnsTheMicOff() {
        for dropped in [LiveAudioBridge.ConnectionState.failed, .disconnected] {
            var stops = 0
            let mic = MicSession(stopCapture: { stops += 1 })
            let controller = LiveSessionController(mic: mic)
            let token = controller.claimMic()!
            FlydState.shared.transition(to: .live)

            controller.handleBridgeState(dropped, for: token)

            XCTAssertNil(mic.holder, "\(dropped)")
            XCTAssertEqual(stops, 1, "\(dropped)")
            XCTAssertEqual(controller.state, .failed, "\(dropped)")
            XCTAssertEqual(FlydState.shared.mode, .present, "\(dropped)")
        }
    }

    /// Connection progress keeps the session and its mic.
    func testAConnectingLiveBridgeKeepsTheMic() {
        var stops = 0
        let mic = MicSession(stopCapture: { stops += 1 })
        let controller = LiveSessionController(mic: mic)
        let token = controller.claimMic()!

        controller.handleBridgeState(.ready, for: token)
        controller.handleBridgeState(.active, for: token)

        XCTAssertEqual(mic.holder, token)
        XCTAssertEqual(stops, 0)
        XCTAssertEqual(controller.state, .active)
    }

    /// An event for a session that already ended does not touch the next one.
    func testAStaleBridgeEventLeavesTheNextSessionAlone() {
        var stops = 0
        let mic = MicSession(stopCapture: { stops += 1 })
        let controller = LiveSessionController(mic: mic)
        let first = controller.claimMic()!
        controller.handleBridgeState(.failed, for: first)
        let second = controller.claimMic()!

        controller.handleBridgeState(.failed, for: first)

        XCTAssertEqual(mic.holder, second)
        XCTAssertEqual(stops, 1)
        XCTAssertEqual(controller.state, .connecting)
    }
}
