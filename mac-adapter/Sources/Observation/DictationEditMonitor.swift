import AppKit
import ApplicationServices
import Carbon.HIToolbox

/// Observe only an explicitly inserted span. Unknown attribution stops learning.
final class DictationEditMonitor {
    static let shared = DictationEditMonitor()
    private var observers: [NSObjectProtocol] = []
    private var expiry: DispatchWorkItem?
    private var settle: DispatchWorkItem?
    private var tracked: Tracked?
    /// Also piggyback a finalized edit on the next start, before Core reads vocabulary.
    private var pendingCorrection: [String: Any]?
    private var privacyObserver: NSObjectProtocol?

    private init() {
        privacyObserver = NotificationCenter.default.addObserver(forName: .flydConfigDidChange, object: nil, queue: .main) {
            [weak self] _ in self?.pendingCorrection = nil
        }
    }

    private struct Tracked {
        let target: DictationContextCapture
        let invocationId: String
        let inserted: String
        let prefix: String
        let suffix: String
        let observedAt: String
    }

    static func expectedValue(text: String, target: DictationContextCapture) -> String? {
        guard target.isStillFocused(), let element = target.capturedElement(),
              let value = DictationContextCapture.text(element, kAXValueAttribute),
              value.count <= 8000 else { return nil }
        var rawRange: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rawRange) == .success,
              let rawRange, CFGetTypeID(rawRange) == AXValueGetTypeID() else { return nil }
        var range = CFRange()
        guard AXValueGetValue(rawRange as! AXValue, .cfRange, &range),
              range.location >= 0, range.length >= 0,
              range.location + range.length <= (value as NSString).length else { return nil }
        return (value as NSString).replacingCharacters(in: NSRange(location: range.location, length: range.length), with: text)
    }

    func track(text: String, target: DictationContextCapture, invocationId: String, expectedValue: String) {
        stop()
        guard allowed(target.bundleId), target.isStillFocused(),
              let element = target.capturedElement(),
              let value = DictationContextCapture.text(element, kAXValueAttribute),
              value == expectedValue,
              value.count <= 8000,
              let range = value.range(of: text),
              value.range(of: text, range: range.upperBound..<value.endIndex) == nil else { return }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        tracked = Tracked(target: target, invocationId: invocationId, inserted: text,
            prefix: String(value[..<range.lowerBound]), suffix: String(value[range.upperBound...]),
            observedAt: formatter.string(from: Date()))
        for name in [Notification.Name.focusedElementValueDidChange, .focusedElementDidChange,
                     .foregroundAppDidChange, .flydConfigDidChange] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) {
                [weak self] _ in self?.changed()
            })
        }
        let work = DispatchWorkItem { [weak self] in
            self?.captureEdit()
            self?.stop()
        }
        expiry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: work)
    }

    private func allowed(_ bundleId: String) -> Bool {
        let config = ConfigManager.shared.config
        return config.dictationCorrectionLearning && !config.incognito &&
            config.retention != .private && !ConfigManager.shared.isBundleExcluded(bundleId) &&
            !IsSecureEventInputEnabled()
    }

    private func changed() {
        guard let tracked else { return }
        guard allowed(tracked.target.bundleId) else { stop(commit: false); return }
        guard tracked.target.isStillFocused() else { stop(); return }
        settle?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.captureEdit() }
        settle = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: work)
    }

    private func captureEdit() {
        guard let tracked, allowed(tracked.target.bundleId), tracked.target.isStillFocused(),
              let element = tracked.target.capturedElement(),
              let value = DictationContextCapture.text(element, kAXValueAttribute),
              let after = Self.editedSpan(value: value, prefix: tracked.prefix, suffix: tracked.suffix),
              !after.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { stop(commit: false); return }
    }

    static func editedSpan(value: String, prefix: String, suffix: String) -> String? {
        guard value.count <= 8000, value.hasPrefix(prefix), value.hasSuffix(suffix),
              value.count >= prefix.count + suffix.count else { return nil }
        return String(value.dropFirst(prefix.count).dropLast(suffix.count))
    }

    @discardableResult
    func stop(commit: Bool = true, send: Bool = true) -> [String: Any]? {
        let final = tracked
        // Read the captured element itself, including on a focus boundary. A
        // stale debounce snapshot must never override an undo or a cleared field.
        let after: String? = {
            guard commit, let final, allowed(final.target.bundleId),
                  let element = final.target.capturedElement(),
                  DictationContextCapture.text(element, kAXSubroleAttribute) != "AXSecureTextField",
                  let value = DictationContextCapture.text(element, kAXValueAttribute) else { return nil }
            return Self.finalCorrection(original: final.inserted, value: value, prefix: final.prefix, suffix: final.suffix)
        }()
        expiry?.cancel(); settle?.cancel(); expiry = nil; settle = nil; tracked = nil
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
        if commit, let final, let after, allowed(final.target.bundleId) {
            pendingCorrection = ["before": final.inserted, "after": after, "invocationId": final.invocationId,
                "bundleId": final.target.bundleId, "scope": final.target.correctionScope(), "observedAt": final.observedAt]
            if send {
                Task { @MainActor [weak self] in
                    guard let self, self.allowed(final.target.bundleId) else { return }
                    await FlydClient.shared.sendDictationCorrection(before: final.inserted, after: after,
                        invocationId: final.invocationId, bundleId: final.target.bundleId, scope: final.target.correctionScope(), observedAt: final.observedAt)
                }
            }
        }
        if !commit { pendingCorrection = nil }
        if !send {
            defer { pendingCorrection = nil }
            guard let pendingCorrection, let bundleId = pendingCorrection["bundleId"] as? String,
                  allowed(bundleId) else { return nil }
            return pendingCorrection
        }
        return nil
    }

    static func finalCorrection(original: String, value: String, prefix: String, suffix: String) -> String? {
        guard let edited = editedSpan(value: value, prefix: prefix, suffix: suffix),
              !edited.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, edited != original else { return nil }
        return edited
    }
}
