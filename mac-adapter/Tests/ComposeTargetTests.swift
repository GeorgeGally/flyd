import XCTest
@testable import FlydMacAdapter

final class ComposeTargetTests: XCTestCase {

    func testUsesResolutionIdWhenBoundDossierExists() {
        let resolutionId = "A1B2C3D4-1111-2222-3333-ABCDEF123456"
        let url = ComposeTarget.url(
            serverValue: "http://127.0.0.1:3000/surface",
            resolutionId: resolutionId,
            directAvailable: true
        )

        XCTAssertEqual(
            url,
            "http://127.0.0.1:3000/surface/a1b2c3d4-1111-2222-3333-abcdef123456"
        )
    }

    func testPreservesSafeCoreTargetWhenBoundDossierIsUnavailable() {
        let url = ComposeTarget.url(
            serverValue: "http://127.0.0.1:3000/surface/abcdef12",
            resolutionId: "a1b2c3d4-1111-2222-3333-abcdef123456",
            directAvailable: false
        )

        XCTAssertEqual(url, "http://127.0.0.1:3000/surface/abcdef12")
    }

    func testRejectsExternalOrCredentialedTargets() {
        XCTAssertEqual(
            ComposeTarget.url(
                serverValue: "https://evil.example/surface/abcdef12",
                resolutionId: "invalid",
                directAvailable: false
            ),
            "http://127.0.0.1:3000/surface"
        )
        XCTAssertEqual(
            ComposeTarget.url(
                serverValue: "http://user:pass@127.0.0.1:3000/surface/abcdef12",
                resolutionId: "invalid",
                directAvailable: false
            ),
            "http://127.0.0.1:3000/surface"
        )
    }

    func testDirectURLRejectsUnsafeResolutionIds() {
        XCTAssertNil(ComposeTarget.directURL(resolutionId: "not-a-uuid"))
        XCTAssertNil(ComposeTarget.directURL(resolutionId: "../../private"))
    }
}
