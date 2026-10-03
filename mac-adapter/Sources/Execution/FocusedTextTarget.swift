import AppKit
import ApplicationServices

/// Whether the app George is dictating into has a text input focused. Dictation pastes
/// only into a text input; with nothing editable focused the words stay on the clipboard.
/// When the accessibility tree cannot say either way, dictation pastes as before.
enum FocusedTextTarget: Equatable {
    case textInput
    case noTextInput
    case unknown

    enum Lookup: Equatable {
        case found
        case nothingFocused
        case failed
    }

    struct Probe: Equatable {
        var lookup: Lookup
        var role: String? = nil
        var valueSettable = false
        var insideEditable = false
        var bundleId: String? = nil
        /// Chromium and Electron build their accessibility tree lazily, so an empty answer
        /// from them does not mean nothing editable is focused.
        var lazyAccessibility = false
    }

    static let textRoles: Set<String> = [
        "AXTextField",
        "AXTextArea",
        "AXSearchField",
        "AXComboBox",
    ]

    /// Focused roles that are never somewhere to type: lists, buttons, pages being read.
    static let nonTextRoles: Set<String> = [
        "AXWebArea",
        "AXButton",
        "AXCheckBox",
        "AXRadioButton",
        "AXPopUpButton",
        "AXMenuButton",
        "AXList",
        "AXOutline",
        "AXTable",
        "AXRow",
        "AXCell",
        "AXImage",
        "AXStaticText",
        "AXLink",
        "AXScrollArea",
        "AXBrowser",
        "AXSlider",
        "AXTabGroup",
        "AXToolbar",
    ]

    /// Terminals draw their own text views and often expose no text role, but always take typing.
    static let terminalBundleIds: Set<String> = [
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "com.mitchellh.ghostty",
        "com.cmuxterm.app",
        "net.kovidgoyal.kitty",
        "com.github.wez.wezterm",
        "org.alacritty",
        "dev.warp.Warp-Stable",
    ]

    static let chromiumBundlePrefixes = [
        "com.google.Chrome",
        "com.brave.Browser",
        "com.microsoft.edgemac",
        "company.thebrowser.Browser",
        "com.vivaldi.Vivaldi",
        "com.operasoftware.Opera",
    ]

    static func classify(_ probe: Probe) -> FocusedTextTarget {
        if let bundleId = probe.bundleId, terminalBundleIds.contains(bundleId) { return .textInput }

        switch probe.lookup {
        case .failed:
            return .unknown
        case .nothingFocused:
            return probe.lazyAccessibility ? .unknown : .noTextInput
        case .found:
            if let role = probe.role, textRoles.contains(role) { return .textInput }
            if probe.valueSettable || probe.insideEditable { return .textInput }
            if probe.role == "AXWindow" { return probe.lazyAccessibility ? .unknown : .noTextInput }
            if let role = probe.role, nonTextRoles.contains(role) { return .noTextInput }
            return .unknown
        }
    }

    static func current(pid: pid_t?) -> FocusedTextTarget {
        guard let pid else { return .unknown }
        return classify(probe(pid: pid))
    }

    private static func probe(pid: pid_t) -> Probe {
        let app = AXUIElementCreateApplication(pid)
        // A hung app must not stall the paste on the main thread.
        AXUIElementSetMessagingTimeout(app, 0.25)
        let bundleId = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier

        var manualAccessibility: DarwinBoolean = false
        let isElectron = AXUIElementIsAttributeSettable(app, "AXManualAccessibility" as CFString, &manualAccessibility) == .success
        let isChromium = bundleId.map { id in chromiumBundlePrefixes.contains { id.hasPrefix($0) } } ?? false

        var probe = Probe(lookup: .failed, bundleId: bundleId, lazyAccessibility: isElectron || isChromium)

        var focusedRef: CFTypeRef?
        switch AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focusedRef) {
        case .success:
            guard let focusedRef, CFGetTypeID(focusedRef) == AXUIElementGetTypeID() else {
                probe.lookup = .nothingFocused
                return probe
            }
            let focused = focusedRef as! AXUIElement
            probe.lookup = .found

            var roleRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(focused, kAXRoleAttribute as CFString, &roleRef) == .success {
                probe.role = roleRef as? String
            }
            var settable: DarwinBoolean = false
            if AXUIElementIsAttributeSettable(focused, kAXValueAttribute as CFString, &settable) == .success {
                probe.valueSettable = settable.boolValue
            }
            var editableAncestor: CFTypeRef?
            probe.insideEditable = AXUIElementCopyAttributeValue(focused, "AXEditableAncestor" as CFString, &editableAncestor) == .success
                && editableAncestor != nil
        case .noValue:
            probe.lookup = .nothingFocused
        default:
            probe.lookup = .failed
        }
        return probe
    }
}
