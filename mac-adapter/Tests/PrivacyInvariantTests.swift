import XCTest
@testable import FlydMacAdapter

final class PrivacyInvariantTests: XCTestCase {
    override func setUp() {
        super.setUp()
        PrivacyInvariants.learnConsentEnabled = false
        PrivacyInvariants.learnEventsEmittedWhileDisabled = 0
        PrivacyInvariants.activeLearnSourceIds = []
        PrivacyInvariants.revokedLearnSourcesStillEmitting = []
        PrivacyInvariants.erasureResidualPayloadCount = 0
    }

    // MARK: - PRESENT invariants unchanged

    func testAllFifteenInvariantsAreDeclared() {
        XCTAssertEqual(PrivacyInvariants.all.count, 15)
        XCTAssertEqual(PrivacyInvariants.all.map(\.id), Array(1...15))
    }

    func testPresentInvariantsKeepOriginalIdsAndDescriptions() {
        let eleven = PrivacyInvariants.all.first { $0.id == 11 }
        XCTAssertEqual(
            eleven?.description,
            "PRESENT state only sends bounded complaint text to Flyd Core on localhost; no external network traffic"
        )
    }

    // MARK: - LEARN invariants hold in the default (off) state

    func testLearnInvariantsPassInDefaultOffState() {
        let results = PrivacyInvariants.verifyAll()
        for (id, passed, detail) in results where id >= 12 {
            XCTAssertTrue(passed, "LEARN invariant \(id) failed in default state: \(detail)")
        }
    }

    // MARK: - Invariant 12: LEARN off by default

    func testEventWhileLearnDisabledFails() {
        PrivacyInvariants.learnEventsEmittedWhileDisabled = 1
        let (passed, _) = PrivacyInvariants.verifyLearnOffByDefault()
        XCTAssertFalse(passed)
    }

    func testEventsWhileLearnEnabledPass() {
        PrivacyInvariants.learnConsentEnabled = true
        PrivacyInvariants.learnEventsEmittedWhileDisabled = 0
        let (passed, _) = PrivacyInvariants.verifyLearnOffByDefault()
        XCTAssertTrue(passed)
    }

    // MARK: - Invariant 13: no sensitive sources

    func testSensitiveSourceFails() {
        PrivacyInvariants.activeLearnSourceIds = ["calendar.metadata", "screen.raw_text"]
        let (passed, _) = PrivacyInvariants.verifyNoSensitiveLearnSources()
        XCTAssertFalse(passed)
    }

    func testLowSensitivitySourcesPass() {
        PrivacyInvariants.activeLearnSourceIds = ["calendar.metadata", "repository.activity"]
        let (passed, _) = PrivacyInvariants.verifyNoSensitiveLearnSources()
        XCTAssertTrue(passed)
    }

    // MARK: - Invariant 14: revocation stops capture

    func testRevokedSourceStillEmittingFails() {
        PrivacyInvariants.revokedLearnSourcesStillEmitting = ["calendar.metadata"]
        let (passed, _) = PrivacyInvariants.verifyRevocationStopsCapture()
        XCTAssertFalse(passed)
    }

    // MARK: - Invariant 15: erasure completeness

    func testResidualPayloadAfterErasureFails() {
        PrivacyInvariants.erasureResidualPayloadCount = 2
        let (passed, _) = PrivacyInvariants.verifyErasureCompleteness()
        XCTAssertFalse(passed)
    }

    // MARK: - Mic only during explicit user action: one session owns it

    /// Every kind of session returns Flyd to present when it ends; every mic session turns
    /// capture off, while text (which never starts capture) leaves it alone.
    func testEndingAnySessionTurnsTheMicOffAndReturnsToPresent() {
        for kind in [InvocationSessionKind.text, .voice, .dictation, .live] {
            var stops = 0
            let flyd = FlydState(mic: MicSession(stopCapture: { stops += 1 }))
            let session = flyd.begin(kind)!
            XCTAssertEqual(flyd.mode, kind == .live ? .live : .invoked, "\(kind)")
            XCTAssertEqual(flyd.invocationId, session.id, "\(kind)")

            flyd.end(session)

            XCTAssertEqual(stops, kind == .text ? 0 : 1, "\(kind)")
            XCTAssertNil(flyd.mic.holder, "\(kind)")
            XCTAssertEqual(flyd.mode, .present, "\(kind)")
            XCTAssertEqual(flyd.phase, .idle, "\(kind)")
            XCTAssertNil(flyd.invocationId, "\(kind)")
        }
    }

    /// A second session can't start while one holds the mic.
    func testASessionIsRefusedWhileAnotherHoldsTheMic() {
        let flyd = FlydState(mic: MicSession(stopCapture: {}))
        let live = flyd.begin(.live)!
        XCTAssertNil(flyd.begin(.dictation))
        XCTAssertNil(flyd.begin(.voice))
        XCTAssertNil(flyd.begin(.text))
        XCTAssertEqual(flyd.invocationId, live.id)
    }

    /// A late LIVE teardown (its session already ended) can't reset push-to-talk that
    /// began after it: the hold keeps its mic and stays listening, so its release is seen.
    func testAStaleLiveEndLeavesAVoiceHoldListening() {
        var stops = 0
        let flyd = FlydState(mic: MicSession(stopCapture: { stops += 1 }))
        let live = flyd.begin(.live)!
        flyd.end(live)
        let voice = flyd.begin(.voice)!

        flyd.end(live)
        flyd.transition(to: .idle, session: live)

        XCTAssertEqual(stops, 1)
        XCTAssertEqual(flyd.mic.holder, voice)
        XCTAssertEqual(flyd.mode, .invoked)
        XCTAssertEqual(flyd.phase, .listening)
    }

    /// A cancelled text invocation finishing late (its resolve/executing/present writes)
    /// can't move the phase of the voice hold that replaced it.
    func testACancelledInvocationFinishingLateCannotMoveTheNextSessionsPhase() {
        let flyd = FlydState(mic: MicSession(stopCapture: {}))
        let text = flyd.begin(.text)!
        flyd.transition(to: .resolving, session: text)
        flyd.end(text)
        let voice = flyd.begin(.voice)!

        flyd.transition(to: .executing, session: text)
        flyd.end(text)

        XCTAssertEqual(flyd.invocationId, voice.id)
        XCTAssertEqual(flyd.phase, .listening)
        flyd.transition(to: .transcribing, session: voice)
        XCTAssertEqual(flyd.phase, .transcribing, "the holder still moves its own phase")
    }

    /// Dictation's capture stops at release while its session runs on through
    /// transcription; only the holder can stop capture.
    func testOnlyTheHolderCanStopCaptureMidSession() {
        var stops = 0
        let flyd = FlydState(mic: MicSession(stopCapture: { stops += 1 }))
        let stale = InvocationSessionToken(kind: .dictation)
        let dictation = flyd.begin(.dictation)!

        flyd.mic.stopCapture(for: stale)
        XCTAssertEqual(stops, 0)
        flyd.mic.stopCapture(for: dictation)
        XCTAssertEqual(stops, 1)
        XCTAssertEqual(flyd.mic.holder, dictation, "the session outlives its capture")
        XCTAssertEqual(flyd.invocationId, dictation.id)
    }
}
