import XCTest
@testable import FlydMacAdapter

final class DictationContextTests: XCTestCase {
    func testOldSettingsPreservePrivacyAndKeepLearningOff() throws {
        let config = try JSONDecoder().decode(OverlayConfig.self, from: Data(
            #"{"incognito":true,"retention":"private","excludedApps":["secret.app"]}"#.utf8))
        XCTAssertTrue(config.incognito)
        XCTAssertEqual(config.retention, .private)
        XCTAssertEqual(config.excludedApps, ["secret.app"])
        XCTAssertTrue(config.dictationContext)
        XCTAssertFalse(config.dictationCorrectionLearning)
    }

    func testNewSettingsRoundTrip() throws {
        let config = OverlayConfig(dictationContext: false, dictationCorrectionLearning: true)
        let decoded = try JSONDecoder().decode(OverlayConfig.self, from: JSONEncoder().encode(config))
        XCTAssertFalse(decoded.dictationContext)
        XCTAssertTrue(decoded.dictationCorrectionLearning)
    }

    func testOnlyTheInsertedSpanIsObserved() {
        XCTAssertEqual(DictationEditMonitor.editedSpan(value: "Before Ask Flyd After", prefix: "Before ", suffix: " After"), "Ask Flyd")
        XCTAssertNil(DictationEditMonitor.editedSpan(value: "Changed Ask Flyd After", prefix: "Before ", suffix: " After"))
        XCTAssertNil(DictationEditMonitor.editedSpan(value: "Before Ask Flyd Elsewhere", prefix: "Before ", suffix: " After"))
        XCTAssertEqual(DictationEditMonitor.editedSpan(value: "你好 Flyd 🌲", prefix: "你好 ", suffix: " 🌲"), "Flyd")
        XCTAssertNil(DictationEditMonitor.editedSpan(value: String(repeating: "x", count: 8001), prefix: "", suffix: ""))
    }
}
