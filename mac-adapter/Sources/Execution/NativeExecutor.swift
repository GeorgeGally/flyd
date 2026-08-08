import AppKit
import ApplicationServices
import CryptoKit

final class NativeExecutor {
    static let shared = NativeExecutor()

    private var activeTargets: [String: (element: AXUIElement, descriptor: TargetDescriptor)] = [:]

    func registerElement(ref: String, element: AXUIElement) {
        guard let descriptor = TargetDescriptor.capture(
            from: AccessibilityInspector.shared,
            app: ApplicationMonitor.shared
        ) else { return }
        activeTargets[ref] = (element, descriptor)
    }

    func registerObservedElement(ref: String, element: AXUIElement, descriptor: TargetDescriptor) {
        activeTargets[ref] = (element, descriptor)
    }

    func resolveElement(ref: String) -> AXUIElement? {
        guard let stored = activeTargets[ref] else { return nil }

        var roleValue: CFTypeRef?
        let roleResult = AXUIElementCopyAttributeValue(stored.element, kAXRoleAttribute as CFString, &roleValue)
        guard roleResult == .success, let _ = roleValue as? String else { return nil }

        guard stored.descriptor.matchesElement(stored.element) else { return nil }
        guard stored.descriptor.matchesReality(currentApp: ApplicationMonitor.shared) else { return nil }

        return stored.element
    }

    func currentTargetDescriptor(for ref: String) -> TargetDescriptor? {
        activeTargets[ref]?.descriptor
    }

    func currentElementDescriptor(for ref: String) -> (element: AXUIElement, role: String, value: String, selectedText: String)? {
        guard let stored = activeTargets[ref] else { return nil }

        var roleValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(stored.element, kAXRoleAttribute as CFString, &roleValue) == .success,
              let role = roleValue as? String else { return nil }

        var valueRef: CFTypeRef?
        let value = (AXUIElementCopyAttributeValue(stored.element, kAXValueAttribute as CFString, &valueRef) == .success)
            ? (valueRef as? String ?? "") : ""

        var selRef: CFTypeRef?
        let selected = (AXUIElementCopyAttributeValue(stored.element, kAXSelectedTextAttribute as CFString, &selRef) == .success)
            ? (selRef as? String ?? "") : ""

        return (stored.element, role, value, selected)
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

    func requiresReplacementConfirmation(kind: String, text: String) -> Bool {
        guard let descriptor = currentElementDescriptor(for: "el_01") else { return false }
        return ReplacementGate.requiresReplacementConfirmation(
            kind: kind,
            existingValue: descriptor.value,
            selectedText: descriptor.selectedText,
            newText: text
        )
    }

    func verifyObservedTarget(_ target: ObservedTarget) -> Bool {
        let currentAppId = ApplicationMonitor.shared.foregroundApp?.bundleId ?? ""
        if currentAppId != target.descriptor.applicationId { return false }
        return target.descriptor.matchesElement(target.element)
    }

    func execute(operation: ResolvedOperation, fingerprint: InvocationFingerprint) async -> ExecutionResult {
        return await execute(operation: operation, fingerprint: fingerprint, recordUndo: true)
    }

    func execute(operation: ResolvedOperation, fingerprint: InvocationFingerprint, recordUndo: Bool) async -> ExecutionResult {
        if let grantInvalidReason = validateActionGrant(for: operation.target) {
            return ExecutionResult(success: false, error: grantInvalidReason)
        }

        let element = resolveElement(ref: operation.target)
        guard let element else {
            return ExecutionResult(success: false, error: "Target no longer available — element not found")
        }

        guard isEditable(element) else {
            return ExecutionResult(success: false, error: "Element is not an editable text field")
        }

        var preValueRef: CFTypeRef?
        var preValue: String?
        var preDigest: String?
        if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &preValueRef) == .success {
            preValue = preValueRef as? String
            if let preValue {
                preDigest = SHA256.hash(data: Data(preValue.utf8)).compactMap { String(format: "%02x", $0) }.joined()
            }
        }

        let storedDigest = activeTargets[operation.target]?.descriptor.contentDigest

        if recordUndo, let descriptor = activeTargets[operation.target]?.descriptor {
            if let priorValue = preValue {
                UndoManager.shared.register(
                    target: descriptor,
                    element: element,
                    previousValue: priorValue,
                    operationKind: operation.kind,
                    targetRef: operation.target,
                    invocationId: FlydState.shared.invocationId ?? ""
                )
            }
        }

        let result: ExecutionResult
        switch operation.kind {
        case "insert_text":
            result = insertText(element, text: operation.text)
        case "replace_text":
            result = replaceText(element, text: operation.text)
        case "replace_selection":
            result = replaceSelection(element, text: operation.text)
        default:
            result = ExecutionResult(success: false, error: "Unknown operation kind: \(operation.kind)")
        }

        let verification = reReadAfterExecution(
            element: element,
            preValue: preValue,
            preDigest: preDigest ?? storedDigest,
            executionSucceeded: result.success
        )

        return ExecutionResult(
            success: result.success,
            error: result.error,
            verificationEvidence: verification
        )
    }

    private func validateActionGrant(for target: String) -> String? {
        let coordinator = WorkInteractionCoordinator.shared
        guard let pending = coordinator.pendingAction else {
            return nil
        }

        if let storedDescriptor = activeTargets[target]?.descriptor,
           storedDescriptor.revision != coordinator.sessionRevision {
            return "Action grant invalidated: Work Session revision mismatch"
        }

        if let storedDigest = activeTargets[target]?.descriptor.contentDigest,
           let grantDigest = pending.targetFingerprint.fieldValueDigest,
           storedDigest != grantDigest {
            return "Target has drifted: field value no longer matches approved fingerprint"
        }

        return nil
    }

    private func reReadAfterExecution(element: AXUIElement, preValue: String?, preDigest: String?, executionSucceeded: Bool) -> VerificationEvidence? {
        guard executionSucceeded else { return nil }

        var postValueRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &postValueRef) == .success else {
            return nil
        }
        let postValue = postValueRef as? String

        let postDigest: String?
        if let postValue {
            postDigest = SHA256.hash(data: Data(postValue.utf8)).compactMap { String(format: "%02x", $0) }.joined()
        } else {
            postDigest = nil
        }

        let changed = preDigest != postDigest || preValue != postValue

        return VerificationEvidence(
            preValueDigest: preDigest,
            postValue: postValue,
            postValueDigest: postDigest,
            changed: changed
        )
    }

    func undoLast(for invocationId: String) -> Bool {
        guard let undo = UndoManager.shared.undo(for: invocationId) else { return false }
        guard undo.target.matchesReality(currentApp: ApplicationMonitor.shared) else {
            return false
        }
        guard undo.target.matchesElement(undo.element) else {
            return false
        }

        switch undo.operationKind {
        case "replace_text", "replace_selection", "insert_text":
            let setResult = AXUIElementSetAttributeValue(undo.element, kAXValueAttribute as CFString, undo.previousValue as CFTypeRef)
            if setResult == .success {
                UndoManager.shared.consume(for: invocationId)
                return true
            }
            return false

        default:
            return false
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
        activeTargets.removeAll()
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
    var verificationEvidence: VerificationEvidence? = nil
}

struct VerificationEvidence {
    let preValueDigest: String?
    let postValue: String?
    let postValueDigest: String?
    let changed: Bool
}
