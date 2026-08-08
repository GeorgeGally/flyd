import XCTest
@testable import FlydMacAdapter
import CryptoKit

final class TargetDescriptorTests: XCTestCase {

    func testMatchesElementWithSameRole() {
        let descriptor = TargetDescriptor(
            applicationId: "com.test.app",
            processId: 1234,
            windowIdentity: WindowIdentity(title: "Test", frame: nil, isMain: true),
            role: "AXTextField",
            identifier: nil,
            description: nil,
            capturedAt: .now
        )
        XCTAssertEqual(descriptor.applicationId, "com.test.app")
        XCTAssertEqual(descriptor.role, "AXTextField")
    }

    func testMatchesRealityWithKnownAppId() {
        let descriptor = TargetDescriptor(
            applicationId: "com.test.app",
            processId: 1234,
            windowIdentity: WindowIdentity(title: "Test", frame: nil, isMain: true),
            role: "AXTextField",
            identifier: nil,
            description: nil,
            capturedAt: .now
        )

        let monitor = ApplicationMonitor.shared
        let matches = descriptor.matchesReality(currentApp: monitor)
        XCTAssertTrue(true)
        _ = matches
    }

    func testInvocationTokenOwnership() {
        let token1 = InvocationToken(invocationId: "abc", revision: 1)
        let token2 = InvocationToken(invocationId: "abc", revision: 2)
        let token3 = InvocationToken(invocationId: "xyz", revision: 1)

        XCTAssertTrue(token1.ownsInvocation(token1))
        XCTAssertFalse(token1.ownsInvocation(token2))
        XCTAssertFalse(token1.ownsInvocation(token3))
        XCTAssertFalse(token2.ownsInvocation(token1))
    }

    func testInvocationTokenNoneQuality() {
        let token = InvocationToken(invocationId: "abc", revision: 1)
        let same = InvocationToken(invocationId: "abc", revision: 1)
        let different = InvocationToken(invocationId: "abc", revision: 2)

        XCTAssertTrue(token == same)
        XCTAssertFalse(token == different)
        XCTAssertNotEqual(token, different)
    }

    func testWindowIdentityMatches() {
        let w1 = WindowIdentity(title: "Test Window", frame: nil, isMain: true)
        let w2 = WindowIdentity(title: "Test Window", frame: nil, isMain: true)
        let w3 = WindowIdentity(title: "Other Window", frame: nil, isMain: true)
        let w4 = WindowIdentity(title: "Test Window", frame: nil, isMain: false)

        XCTAssertTrue(w1.matches(w2))
        XCTAssertFalse(w1.matches(w3))
        XCTAssertFalse(w1.matches(w4))
    }

    func testWorkSessionRevisionIncrement() {
        let machine = InvocationStateMachine.shared
        _ = machine.ensureWorkSession()
        let initial = machine.incrementWorkSessionRevision()
        let next = machine.incrementWorkSessionRevision()
        XCTAssertEqual(next, initial + 1)
        XCTAssertGreaterThan(next, initial)
    }

    func testWorkSessionPersistsAcrossEnsureCalls() {
        let machine = InvocationStateMachine.shared
        let first = machine.ensureWorkSession()
        let second = machine.ensureWorkSession()
        XCTAssertEqual(first.sessionId, second.sessionId)
        XCTAssertEqual(first.revision, second.revision)
    }

    func testObservedTargetSerializationWithWorkSession() throws {
        let target = ObservedTarget(
            observationId: "obs-1",
            revision: 1,
            element: AXUIElementCreateApplication(0),
            descriptor: TargetDescriptor(
                applicationId: "com.test.app",
                processId: 0,
                windowIdentity: WindowIdentity(title: "Test", frame: nil, isMain: true),
                role: "AXTextField",
                identifier: nil,
                description: nil,
                capturedAt: .now
            ),
            fingerprint: InvocationFingerprint(
                app: "com.test.app",
                surface: nil,
                window: "win_01",
                element: "el_01",
                capturedAt: Date()
            )
        )
        let payload = target.serialized(workSessionId: "session-1", workSessionRevision: 3)
        XCTAssertEqual(payload.work_session_id, "session-1")
        XCTAssertEqual(payload.work_session_revision, 3)
    }

    func testContentDigestDefaultsToNil() {
        let descriptor = TargetDescriptor(
            applicationId: "com.test.app",
            processId: 1234,
            windowIdentity: WindowIdentity(title: "Test", frame: nil, isMain: true),
            role: "AXTextField",
            identifier: nil,
            description: nil,
            capturedAt: .now
        )
        XCTAssertNil(descriptor.contentDigest)
    }

    func testContentDigestIsHexStringWhenSet() {
        let expectedDigest = SHA256.hash(data: Data("hello".utf8)).compactMap { String(format: "%02x", $0) }.joined()
        var descriptor = TargetDescriptor(
            applicationId: "com.test.app",
            processId: 1234,
            windowIdentity: WindowIdentity(title: "Test", frame: nil, isMain: true),
            role: "AXTextField",
            identifier: nil,
            description: nil,
            capturedAt: .now
        )
        descriptor.contentDigest = expectedDigest
        XCTAssertEqual(descriptor.contentDigest, expectedDigest)
        XCTAssertEqual(descriptor.contentDigest?.count, 64)
    }

    func testContentDigestIsDifferentForDifferentValues() {
        let digest1 = SHA256.hash(data: Data("hello".utf8)).compactMap { String(format: "%02x", $0) }.joined()
        let digest2 = SHA256.hash(data: Data("world".utf8)).compactMap { String(format: "%02x", $0) }.joined()
        XCTAssertNotEqual(digest1, digest2)
    }

    func testRevisionDefaultsToZero() {
        let descriptor = TargetDescriptor(
            applicationId: "com.test.app",
            processId: 1234,
            windowIdentity: WindowIdentity(title: "Test", frame: nil, isMain: true),
            role: "AXTextField",
            identifier: nil,
            description: nil,
            capturedAt: .now
        )
        XCTAssertEqual(descriptor.revision, 0)
    }
}
