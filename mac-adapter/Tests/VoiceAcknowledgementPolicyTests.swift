import XCTest
@testable import FlydMacAdapter

final class VoiceAcknowledgementPolicyTests: XCTestCase {
    func testConversationReleaseAcknowledgesOncePerInvocation() {
        var gate = VoiceAcknowledgementGate()

        XCTAssertTrue(gate.claim(invocationId: "conversation-1", purpose: .conversation))
        XCTAssertFalse(gate.claim(invocationId: "conversation-1", purpose: .conversation))
    }

    func testDictationReleaseNeverAcknowledges() {
        var gate = VoiceAcknowledgementGate()

        XCTAssertFalse(gate.claim(invocationId: "dictation-1", purpose: .dictation))
    }

    func testNewConversationCanAcknowledgeAfterPreviousTurn() {
        var gate = VoiceAcknowledgementGate()

        XCTAssertTrue(gate.claim(invocationId: "conversation-1", purpose: .conversation))
        XCTAssertTrue(gate.claim(invocationId: "conversation-2", purpose: .conversation))
    }
}

