import Foundation

enum ForegroundFeedbackSource: String, Codable {
    case chatgpt
    case opencode
    case codex
}

enum ForegroundFeedbackAuthorship: String, Codable {
    case directInput = "direct_input"
    case ambiguousTerminal = "ambiguous_terminal"
}

struct ForegroundFeedbackCaptureContext {
    let source: ForegroundFeedbackSource
    let authorship: ForegroundFeedbackAuthorship
}

enum ForegroundFeedbackPolicy {
    private static let editableRoles: Set<String> = [
        "AXTextArea",
        "AXTextField",
        "AXComboBox",
    ]

    private static let terminalBundleIds: Set<String> = [
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "com.mitchellh.ghostty",
        "net.kovidgoyal.kitty",
        "com.github.wez.wezterm",
    ]

    static func captureContext(
        bundleId: String,
        applicationName: String,
        browserURL: String?,
        windowTitle: String,
        elementRole: String
    ) -> ForegroundFeedbackCaptureContext? {
        guard editableRoles.contains(elementRole) else { return nil }

        let app = "\(bundleId) \(applicationName)".lowercased()
        let surface = "\(browserURL ?? "") \(windowTitle)".lowercased()

        if app.contains("openai.chat") || applicationName.lowercased() == "chatgpt" || surface.contains("chatgpt.com") || surface.contains("chatgpt") {
            return ForegroundFeedbackCaptureContext(source: .chatgpt, authorship: .directInput)
        }
        if app.contains("openai.codex") || applicationName.lowercased().contains("codex") {
            return ForegroundFeedbackCaptureContext(source: .codex, authorship: .directInput)
        }
        if app.contains("opencode") || applicationName.lowercased().contains("opencode") {
            return ForegroundFeedbackCaptureContext(source: .opencode, authorship: .directInput)
        }
        if terminalBundleIds.contains(bundleId), surface.contains("opencode") {
            return ForegroundFeedbackCaptureContext(source: .opencode, authorship: .ambiguousTerminal)
        }
        return nil
    }

    static func isComplaint(_ text: String) -> Bool {
        let normalized = text.lowercased()
        let objects = ["flyd", "answer", "response", "reply", "output", "memory", "model"]
        let negatives = [
            "bad", "generic", "useless", "wrong", "unhelpful", "terrible", "awful",
            "broken", "failing", "hallucinated", "untrustworthy", "not useful",
            "doesn't work", "doesn’t work", "can't do", "can’t do", "cannot do",
        ]
        return objects.contains(where: normalized.contains)
            && negatives.contains(where: normalized.contains)
    }
}
