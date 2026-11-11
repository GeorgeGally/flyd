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
        var state = ShortcutRoutingState()
        let fn: CGEventFlags = [.maskSecondaryFn]
        func edge(_ flags: CGEventFlags, at time: TimeInterval) -> [ShortcutRouteEvent] {
            ShortcutRouter.route(eventType: .flagsChanged, flags: flags, state: &state, now: time)
        }

        XCTAssertEqual(edge(fn, at: 0.0), [.dictationStart])
        ShortcutRouter.endDictation(state: &state) // start refused
        XCTAssertEqual(edge([], at: 0.05), [])
        XCTAssertEqual(edge(fn, at: 3.0), [.dictationStart])
    }

    /// The refusal can land after the tap's release (the start runs on the next main-queue
    /// turn); the next tap still starts fresh.
    func testRefusalArrivingAfterReleaseStillFreesTheNextTap() {
        var state = ShortcutRoutingState()
        let fn: CGEventFlags = [.maskSecondaryFn]
        func edge(_ flags: CGEventFlags, at time: TimeInterval) -> [ShortcutRouteEvent] {
            ShortcutRouter.route(eventType: .flagsChanged, flags: flags, state: &state, now: time)
        }

        XCTAssertEqual(edge(fn, at: 0.0), [.dictationStart])
        XCTAssertEqual(edge([], at: 0.05), [])
        ShortcutRouter.endDictation(state: &state) // start refused
        XCTAssertEqual(edge(fn, at: 3.0), [.dictationStart])
    }
}
