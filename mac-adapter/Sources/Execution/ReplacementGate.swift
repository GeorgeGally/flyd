import Foundation

struct ReplacementGate {

    static func requiresConfirmation(kind: String, existingValue: String, selectedText: String, newText: String) -> Bool {
        switch kind {
        case "replace_text":
            return true

        case "replace_selection":
            guard !existingValue.isEmpty else { return false }
            let selectionLen = Double(selectedText.count)
            let totalLen = Double(existingValue.count)
            return (selectionLen / totalLen) > 0.75

        case "insert_text":
            return false

        default:
            return false
        }
    }
}
