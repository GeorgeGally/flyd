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
}
