import XCTest
@testable import FlydMacAdapter

final class RequestTimeoutPolicyTests: XCTestCase {
    func testManifestAllowsModelResolutionToFinish() {
        XCTAssertEqual(RequestTimeoutPolicy.timeout(for: "/manifest"), 180)
    }

    func testOtherPostRequestsKeepTheDefaultTimeout() {
        XCTAssertEqual(
            RequestTimeoutPolicy.timeout(for: "/work-intelligence/action/approve"),
            60
        )
    }

    func testRepositoryActionSubmissionUsesTheDefaultShortRequestTimeout() {
        XCTAssertEqual(
            RequestTimeoutPolicy.timeout(for: "/work-intelligence/repository-action"),
            60
        )
    }
}
