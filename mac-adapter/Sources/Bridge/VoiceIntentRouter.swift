import Foundation

struct VoiceIntentRouter {

    static func isPlainDictation(_ transcript: String) -> Bool {
        let trimmed = transcript.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return false }

        let lower = trimmed.lowercased()

        if lower.hasPrefix("what ") || lower.hasPrefix("how ") ||
           lower.hasPrefix("why ") || lower.hasPrefix("who ") ||
           lower.hasPrefix("when ") || lower.hasPrefix("where ") ||
           lower.hasPrefix("can ") || lower.hasPrefix("could ") ||
           lower.hasPrefix("is ") || lower.hasPrefix("are ") ||
           lower.hasPrefix("do ") || lower.hasPrefix("does ") ||
           lower.hasPrefix("which ") || lower.hasPrefix("will ") {
            return false
        }

        let commandPrefixes = [
            "reply", "answer", "respond",
            "rewrite", "rephrase", "paraphrase",
            "translate", "convert",
            "fix", "correct", "change", "replace", "edit", "modify",
            "explain", "describe", "summarize", "analyze",
            "search", "find", "look up", "look for",
            "tell me", "show me",
            "send", "compose", "draft",
            "run", "execute", "build",
            "open", "close",
        ]

        for prefix in commandPrefixes {
            if lower.hasPrefix(prefix) { return false }
        }

        return true
    }

    static func hasSelectedText(_ transcript: String) -> Bool {
        let lower = transcript.lowercased()
        return lower.contains("this") || lower.contains("that ") ||
               lower.contains("the selection") || lower.contains("selected text")
    }
}
