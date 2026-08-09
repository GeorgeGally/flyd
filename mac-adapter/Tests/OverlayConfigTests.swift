import XCTest
@testable import FlydMacAdapter

final class OverlayConfigTests: XCTestCase {
    func testOlderConfigEnablesForegroundFeedbackCaptureByDefault() throws {
        let data = Data(#"{"retention":"balanced","incognito":false}"#.utf8)
        let config = try JSONDecoder().decode(OverlayConfig.self, from: data)

        XCTAssertTrue(config.foregroundFeedbackCapture)
    }

    func testForegroundFeedbackCaptureCanBeDisabled() throws {
        let data = Data(#"{"retention":"balanced","foregroundFeedbackCapture":false}"#.utf8)
        let config = try JSONDecoder().decode(OverlayConfig.self, from: data)

        XCTAssertFalse(config.foregroundFeedbackCapture)
    }

    func testForegroundFeedbackPayloadUsesCoreWireKeys() throws {
        let payload = FlydClient.ForegroundFeedbackPayload(
            version: 1,
            capturedAt: "2026-08-09T01:00:00Z",
            source: "chatgpt",
            authorship: "direct_input",
            application: FlydClient.AppPayload(bundleId: "com.openai.chat", name: "ChatGPT"),
            windowTitle: "Flyd review",
            browserURL: nil,
            text: "Flyd's answer was bad."
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any])

        XCTAssertEqual(object["captured_at"] as? String, "2026-08-09T01:00:00Z")
        XCTAssertEqual(object["window_title"] as? String, "Flyd review")
        XCTAssertEqual(object["authorship"] as? String, "direct_input")
    }
}
