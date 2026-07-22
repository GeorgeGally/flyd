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

    func execute(operation: ResolvedOperation, fingerprint: InvocationFingerprint) async -> ExecutionResult {
        guard InvocationStateMachine.shared.verifyPreExecution() else {
            return ExecutionResult(success: false, error: "Target no longer available — app or window changed")
        }

        let element = resolveElement(ref: operation.target, expectedRole: "AXTextArea")
        guard let element else {
            return ExecutionResult(success: false, error: "Target no longer available — element not found")
        }

        switch operation.kind {
        case "insert_text":
            return await insertText(element, text: operation.text)
        case "replace_text":
            return await replaceText(element, text: operation.text)
        case "replace_selection":
            return await replaceSelection(element, text: operation.text)
        default:
            return ExecutionResult(success: false, error: "Unknown operation kind: \(operation.kind)")
        }
    }

    private func insertText(_ element: AXUIElement, text: String) async -> ExecutionResult {
        AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
        return ExecutionResult(success: true, error: nil)
    }

    private func replaceText(_ element: AXUIElement, text: String) async -> ExecutionResult {
        AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
        return ExecutionResult(success: true, error: nil)
    }

    private func replaceSelection(_ element: AXUIElement, text: String) async -> ExecutionResult {
        AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
        return ExecutionResult(success: true, error: nil)
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
