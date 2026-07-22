import AppKit
import ApplicationServices

final class PermissionGate {
    static let shared = PermissionGate()

    enum Permission: CaseIterable, Identifiable {
        case accessibility
        case screenRecording
        case microphone

        var id: String { displayName }

        var displayName: String {
            switch self {
            case .accessibility: return "Accessibility"
            case .screenRecording: return "Screen Recording"
            case .microphone: return "Microphone"
            }
        }

        var explanation: String {
            switch self {
            case .accessibility:
                return "Allows Flyd to read the focused element and nearby context in any application. Needed to understand what you're looking at."
            case .screenRecording:
                return "Allows Flyd to capture a screenshot when accessibility context is insufficient. Only during invocation, never in the background."
            case .microphone:
                return "Required for voice mode (LIVE). Not needed for text-based invocation."
            }
        }

        var grantInstructions: String {
            switch self {
            case .accessibility:
                return "Open System Settings → Privacy & Security → Accessibility, then enable Flyd."
            case .screenRecording:
                return "Open System Settings → Privacy & Security → Screen Recording, then enable Flyd."
            case .microphone:
                return "Open System Settings → Privacy & Security → Microphone, then enable Flyd."
            }
        }
    }

    var hasAccessibility: Bool {
        AXIsProcessTrusted()
    }

    var hasScreenRecording: Bool {
        if #available(macOS 15.0, *) {
            return false
        }
        return CGPreflightScreenCaptureAccess()
    }

    var hasMicrophone: Bool {
        false
    }

    func status(for permission: Permission) -> Bool {
        switch permission {
        case .accessibility: return hasAccessibility
        case .screenRecording: return hasScreenRecording
        case .microphone: return hasMicrophone
        }
    }

    func allRequiredGranted() -> Bool {
        hasAccessibility && hasScreenRecording
    }

    func openSystemSettings(for permission: Permission) {
        switch permission {
        case .accessibility:
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
        case .screenRecording:
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
        case .microphone:
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
        }
    }
}
