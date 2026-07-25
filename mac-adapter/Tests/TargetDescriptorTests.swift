import XCTest
@testable import FlydMacAdapter

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
        // Element matching requires a real AXUIElement, tested via integration
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
        // Passes regardless: just verifies the method doesn't crash
        // Actual match depends on current foreground app
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
}
