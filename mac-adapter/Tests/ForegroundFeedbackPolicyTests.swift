import XCTest
@testable import FlydMacAdapter

final class ForegroundFeedbackPolicyTests: XCTestCase {
    func testRecognizesDirectChatGPTInput() {
        let context = ForegroundFeedbackPolicy.captureContext(
            bundleId: "com.openai.chat",
            applicationName: "ChatGPT",
            browserURL: nil,
            windowTitle: "Flyd review",
            elementRole: "AXTextArea"
        )

        XCTAssertEqual(context?.source, .chatgpt)
        XCTAssertEqual(context?.authorship, .directInput)
    }

    func testRecognizesChatGPTInABrowserInput() {
        let context = ForegroundFeedbackPolicy.captureContext(
            bundleId: "com.google.Chrome",
            applicationName: "Google Chrome",
            browserURL: "https://chatgpt.com/c/example",
            windowTitle: "Flyd review — ChatGPT",
            elementRole: "AXTextArea"
        )

        XCTAssertEqual(context?.source, .chatgpt)
        XCTAssertEqual(context?.authorship, .directInput)
    }

    func testRecognizesOpenCodeDesktopInput() {
        let context = ForegroundFeedbackPolicy.captureContext(
            bundleId: "ai.opencode.desktop",
            applicationName: "OpenCode",
            browserURL: nil,
            windowTitle: "flyd",
            elementRole: "AXTextField"
        )

        XCTAssertEqual(context?.source, .opencode)
        XCTAssertEqual(context?.authorship, .directInput)
    }

    func testTreatsOpenCodeTerminalContentAsAmbiguous() {
        let context = ForegroundFeedbackPolicy.captureContext(
            bundleId: "com.apple.Terminal",
            applicationName: "Terminal",
            browserURL: nil,
            windowTitle: "opencode — flyd",
            elementRole: "AXTextArea"
        )

        XCTAssertEqual(context?.source, .opencode)
        XCTAssertEqual(context?.authorship, .ambiguousTerminal)
    }

    func testRejectsUnrelatedAppsAndNonEditableElements() {
        XCTAssertNil(ForegroundFeedbackPolicy.captureContext(
            bundleId: "com.apple.TextEdit",
            applicationName: "TextEdit",
            browserURL: nil,
            windowTitle: "notes",
            elementRole: "AXTextArea"
        ))
        XCTAssertNil(ForegroundFeedbackPolicy.captureContext(
            bundleId: "com.openai.chat",
            applicationName: "ChatGPT",
            browserURL: nil,
            windowTitle: "Flyd review",
            elementRole: "AXStaticText"
        ))
    }

    func testOnlySelectsComplaintLikeTextForCapture() {
        XCTAssertTrue(ForegroundFeedbackPolicy.isComplaint("Flyd's last answer was bad and generic."))
        XCTAssertTrue(ForegroundFeedbackPolicy.isComplaint("That response was completely useless."))
        XCTAssertFalse(ForegroundFeedbackPolicy.isComplaint("Flyd uses a TypeScript runtime."))
        XCTAssertFalse(ForegroundFeedbackPolicy.isComplaint("This answer explains the architecture."))
    }
}
