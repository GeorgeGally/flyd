import XCTest
@testable import FlydMacAdapter

final class EnvironmentStateTests: XCTestCase {
    func testFallbackEnvironmentKeepsVoiceQuestionAnswerableWithoutFocusedElement() {
        let env = EnvironmentState.fallback(
            application: EnvironmentState.ApplicationInfo(bundleId: "com.example.app", name: "Example"),
            reason: "Focused element unavailable"
        )

        XCTAssertEqual(env.application.bundleId, "com.example.app")
        XCTAssertEqual(env.focusedElement.ref, "el_01")
        XCTAssertEqual(env.focusedElement.role, "AXUnknown")
        XCTAssertEqual(env.focusedElement.description, "Focused element unavailable")
        XCTAssertEqual(env.selection, "")
        XCTAssertEqual(env.sufficiency.rawValue, EnvironmentState.SufficiencyLevel.partial.rawValue)
    }

    func testNewFieldsAreNilInFallback() {
        let env = EnvironmentState.fallback(
            application: EnvironmentState.ApplicationInfo(bundleId: "com.example.app", name: "Example"),
            reason: "Focused element unavailable"
        )

        XCTAssertNil(env.documentPath)
        XCTAssertNil(env.browserURL)
        XCTAssertNil(env.displayID)
        XCTAssertNil(env.screenshotBounds)
    }

    func testApplicationInfoCodableRoundtrip() throws {
        let info = EnvironmentState.ApplicationInfo(bundleId: "com.test.app", name: "Test App")
        let data = try JSONEncoder().encode(info)
        let decoded = try JSONDecoder().decode(EnvironmentState.ApplicationInfo.self, from: data)
        XCTAssertEqual(decoded.bundleId, "com.test.app")
        XCTAssertEqual(decoded.name, "Test App")
    }

    func testFocusedElementInfoCodableRoundtrip() throws {
        let info = EnvironmentState.FocusedElementInfo(
            ref: "el_01",
            role: "AXTextField",
            description: "Search field",
            value: "query",
            placeholder: "Search...",
            selectedText: "que"
        )
        let data = try JSONEncoder().encode(info)
        let decoded = try JSONDecoder().decode(EnvironmentState.FocusedElementInfo.self, from: data)
        XCTAssertEqual(decoded.role, "AXTextField")
        XCTAssertEqual(decoded.selectedText, "que")
    }
}
