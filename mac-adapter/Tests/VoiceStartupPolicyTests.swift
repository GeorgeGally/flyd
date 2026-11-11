import XCTest
@testable import FlydMacAdapter

final class VoiceStartupPolicyTests: XCTestCase {
    func testConnectionFailureMessageUsesProductLanguage() {
        XCTAssertEqual(
            VoiceStartupPolicy.message(forTranscriptionError: "Transcription connection error: Could not connect to the server"),
            "Voice failed - try again"
        )
    }

    func testNonConnectionFailureUsesVoiceErrorMessage() {
        XCTAssertEqual(
            VoiceStartupPolicy.message(forTranscriptionError: "No speech detected"),
            "Voice error - try again"
        )
    }

    func testInvalidApiKeyMessageIsActionable() {
        XCTAssertEqual(
            VoiceStartupPolicy.message(forTranscriptionError: "Voice setup needs a valid API key"),
            "Voice setup needs a valid API key"
        )
    }

    func testMissingAudioModelAccessMessageIsActionable() {
        XCTAssertEqual(
            VoiceStartupPolicy.message(forTranscriptionError: "Voice setup needs audio model access"),
            "Voice is not active for this key yet"
        )
        XCTAssertEqual(
            VoiceStartupPolicy.message(forTranscriptionError: "Voice is not active for this key yet"),
            "Voice is not active for this key yet"
        )
    }

    func testEstablishedSocketDisconnectDoesNotSayCoreIsStarting() {
        XCTAssertEqual(
            VoiceStartupPolicy.message(forTranscriptionError: "Transcription connection error: Socket is not connected"),
            "Voice failed - try again"
        )
    }

    func testUserFacingMessagesDoNotMentionCore() {
        let messages = [
            VoiceStartupPolicy.message(forTranscriptionError: "Transcription connection error: Could not connect to the server"),
            VoiceStartupPolicy.message(forTranscriptionError: "Transcription connection error: Socket is not connected"),
            VoiceStartupPolicy.message(forTranscriptionError: "No speech detected"),
        ]

        XCTAssertFalse(messages.contains { $0.localizedCaseInsensitiveContains("core") })
    }

    func testReleaseWhileListeningFinishesRecording() {
        XCTAssertEqual(
            VoiceStartupPolicy.actionOnShortcutRelease(
                phase: .listening
            ),
            .finishRecording
        )
    }

    func testWorkSessionRevisionPersistenceAcrossTurns() {
        let machine = InvocationStateMachine.shared
        machine.cancel()

        let session1 = machine.ensureWorkSession()
        let initialRev = session1.revision
        XCTAssertFalse(session1.sessionId.isEmpty)

        let session2 = machine.ensureWorkSession()
        XCTAssertEqual(session1.sessionId, session2.sessionId)

        let rev2 = machine.incrementWorkSessionRevision()
        XCTAssertEqual(rev2, initialRev + 1)

        let session3 = machine.ensureWorkSession()
        XCTAssertEqual(session3.revision, initialRev + 1)
        XCTAssertEqual(session3.sessionId, session1.sessionId)
    }

    // MARK: - Voice status follows Core's health

    func testFirstHealthyAnswerFetchesVoiceStatus() {
        var watch = CoreHealthWatch()
        XCTAssertEqual(watch.observe(healthy: true), .fetch(generation: 1))
    }

    func testUnchangedHealthDoesNotRefetch() {
        var watch = CoreHealthWatch()
        _ = watch.observe(healthy: true)
        XCTAssertNil(watch.observe(healthy: true))
        XCTAssertNil(watch.observe(healthy: true))
    }

    /// Core down at launch, up later: voice status is fetched when it comes up instead of
    /// staying whatever launch saw.
    func testCoreComingUpAfterLaunchFetchesVoiceStatus() {
        var watch = CoreHealthWatch()
        XCTAssertEqual(watch.observe(healthy: false), .clear(generation: 1))
        XCTAssertNil(watch.observe(healthy: false))
        XCTAssertEqual(watch.observe(healthy: true), .fetch(generation: 2))
    }

    /// A restart (down, then up) refetches, so a fixed voice setup is seen without
    /// relaunching the app.
    func testCoreRestartRefetchesVoiceStatus() {
        var watch = CoreHealthWatch()
        _ = watch.observe(healthy: true)
        XCTAssertEqual(watch.observe(healthy: false), .clear(generation: 2))
        XCTAssertEqual(watch.observe(healthy: true), .fetch(generation: 3))
    }

    /// A fetch that finishes after Core's health changed again is dropped.
    func testAFetchOutlivedByAHealthChangeIsStale() {
        var watch = CoreHealthWatch()
        guard case .fetch(let generation)? = watch.observe(healthy: true) else {
            return XCTFail("expected a fetch")
        }
        _ = watch.observe(healthy: false)
        XCTAssertFalse(watch.isCurrent(generation))
    }
}
