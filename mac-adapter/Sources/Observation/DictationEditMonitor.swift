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

    private struct Tracked {
        let target: DictationContextCapture
        let invocationId: String
        let inserted: String
        let prefix: String
        let suffix: String
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
        tracked = Tracked(target: target, invocationId: invocationId, inserted: text,
            prefix: String(value[..<range.lowerBound]), suffix: String(value[range.upperBound...]))
        for name in [Notification.Name.focusedElementValueDidChange, .focusedElementDidChange,
                     .foregroundAppDidChange, .flydConfigDidChange] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) {
                [weak self] _ in self?.changed()
            })
        }
        let work = DispatchWorkItem { [weak self] in self?.stop() }
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
        guard let tracked, allowed(tracked.target.bundleId), tracked.target.isStillFocused() else { stop(); return }
        settle?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.captureEdit() }
        settle = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: work)
    }

    private func captureEdit() {
        guard let tracked, allowed(tracked.target.bundleId), tracked.target.isStillFocused(),
              let element = tracked.target.capturedElement(),
              let value = DictationContextCapture.text(element, kAXValueAttribute),
              let after = Self.editedSpan(value: value, prefix: tracked.prefix, suffix: tracked.suffix) else { stop(); return }
        guard after != tracked.inserted else { return }
        stop()
        Task {
            await FlydClient.shared.sendDictationCorrection(before: tracked.inserted, after: after,
                invocationId: tracked.invocationId, bundleId: tracked.target.bundleId, scope: tracked.target.correctionScope())
        }
    }

    static func editedSpan(value: String, prefix: String, suffix: String) -> String? {
        guard value.count <= 8000, value.hasPrefix(prefix), value.hasSuffix(suffix),
              value.count >= prefix.count + suffix.count else { return nil }
        return String(value.dropFirst(prefix.count).dropLast(suffix.count))
    }

    func stop() {
        expiry?.cancel(); settle?.cancel(); expiry = nil; settle = nil; tracked = nil
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
    }
}
