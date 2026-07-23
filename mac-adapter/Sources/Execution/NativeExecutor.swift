import AppKit
import ApplicationServices

final class NativeExecutor {
    static let shared = NativeExecutor()

    private var activeInvocationRefs: [String: AXUIElement] = [:]

    func registerElement(ref: String, element: AXUIElement) {
        activeInvocationRefs[ref] = element
    }

    func resolveElement(ref: String, expectedRole: String?) -> AXUIElement? {
        guard let stored = activeInvocationRefs[ref] else {
            return attemptReResolution(ref: ref, expectedRole: expectedRole)
        }

        var roleValue: CFTypeRef?
        let roleResult = AXUIElementCopyAttributeValue(stored, kAXRoleAttribute as CFString, &roleValue)

        if roleResult == .success,
           let role = roleValue as? String,
           expectedRole == nil || role == expectedRole {
            return stored
        }

        return attemptReResolution(ref: ref, expectedRole: expectedRole)
    }

    private func attemptReResolution(ref: String, expectedRole: String?) -> AXUIElement? {
        guard ref == "el_01" else { return nil }
        guard let inspector = AccessibilityInspector.shared as AccessibilityInspector? else { return nil }
        let focused = inspector.captureFocusedElement()

        if let expectedRole, focused?.role != expectedRole {
            return nil
        }

        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)

        var focusedRef: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedRef)
        guard result == .success, let element = focusedRef else { return nil }
        return (element as! AXUIElement)
    }

    static let safeEditableRoles: Set<String> = [
        "AXTextArea",
        "AXTextField",
        "AXSearchField",
    ]

    private func isEditable(_ element: AXUIElement) -> Bool {
        var roleValue: CFTypeRef?
        let roleResult = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue)
        guard roleResult == .success, let role = roleValue as? String else { return false }

        guard Self.safeEditableRoles.contains(role) else { return false }

        var enabledValue: CFTypeRef?
        let enabledResult = AXUIElementCopyAttributeValue(element, kAXEnabledAttribute as CFString, &enabledValue)
        if enabledResult == .success, let enabled = enabledValue as? Bool, !enabled { return false }

        return true
    }

    func execute(operation: ResolvedOperation, fingerprint: InvocationFingerprint) async -> ExecutionResult {
        let element = resolveElement(ref: operation.target, expectedRole: nil)
        guard let element else {
            return ExecutionResult(success: false, error: "Target no longer available — element not found")
        }

        guard isEditable(element) else {
            return ExecutionResult(success: false, error: "Element is not an editable text field")
        }

        switch operation.kind {
        case "insert_text":
            return insertText(element, text: operation.text)
        case "replace_text":
            return replaceText(element, text: operation.text)
        case "replace_selection":
            return replaceSelection(element, text: operation.text)
        default:
            return ExecutionResult(success: false, error: "Unknown operation kind: \(operation.kind)")
        }
    }

    private func insertText(_ element: AXUIElement, text: String) -> ExecutionResult {
        var range: CFTypeRef?
        let rangeResult = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &range)
        guard rangeResult == .success else {
            let setResult = AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
            return ExecutionResult(success: setResult == .success, error: setResult != .success ? "AX error: \(setResult.rawValue)" : nil)
        }
        let setResult = AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
        return ExecutionResult(success: setResult == .success, error: setResult != .success ? "AX error: \(setResult.rawValue)" : nil)
    }

    private func replaceText(_ element: AXUIElement, text: String) -> ExecutionResult {
        let setResult = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
        return ExecutionResult(success: setResult == .success, error: setResult != .success ? "AX error: \(setResult.rawValue)" : nil)
    }

    private func replaceSelection(_ element: AXUIElement, text: String) -> ExecutionResult {
        let setResult = AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
        return ExecutionResult(success: setResult == .success, error: setResult != .success ? "AX error: \(setResult.rawValue)" : nil)
    }

    func clearInvocationRefs() {
        activeInvocationRefs.removeAll()
    }
}

struct ResolvedOperation {
    let target: String
    let kind: String
    let text: String
}

struct ExecutionResult {
    let success: Bool
    let error: String?
}
