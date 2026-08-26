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
}
