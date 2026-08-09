import XCTest
@testable import FlydMacAdapter

final class StartupInvocationPolicyTests: XCTestCase {
    func testRequestsInvocationOnlyForExplicitAcceptanceArgument() {
        XCTAssertTrue(
            StartupInvocationPolicy.shouldInvoke(
                arguments: ["FlydMacAdapter", "--invoke-on-launch"]
            )
        )
        XCTAssertFalse(
            StartupInvocationPolicy.shouldInvoke(arguments: ["FlydMacAdapter"])
        )
        XCTAssertFalse(
            StartupInvocationPolicy.shouldInvoke(
                arguments: ["FlydMacAdapter", "--permission-diagnostic"]
            )
        )
    }

    func testAcceptanceInvocationAllowsTimeToFocusTheTargetApp() {
        XCTAssertEqual(StartupInvocationPolicy.acceptanceFocusDelay, 10)
    }
}
