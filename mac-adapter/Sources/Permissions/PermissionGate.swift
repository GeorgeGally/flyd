import AppKit
import ApplicationServices
import AVFoundation
import Foundation
import IOKit.hid

final class PermissionGate {
    static let shared = PermissionGate()

    enum Permission: CaseIterable, Identifiable {
        case accessibility
        case keyboardShortcut
        case screenRecording
        case microphone

        var id: String { displayName }

        var displayName: String {
            switch self {
            case .accessibility: return "Accessibility"
            case .keyboardShortcut: return "Keyboard Shortcut"
            case .screenRecording: return "Screen Recording"
            case .microphone: return "Microphone"
            }
        }

        var explanation: String {
            switch self {
            case .accessibility:
                return "Lets Flyd understand the field, page, or app you are working in."
            case .keyboardShortcut:
                return "Lets Flyd hear its keyboard shortcuts from any app. Flyd does not record what you type."
            case .screenRecording:
                return "Lets Flyd look once when app context is not enough. Never in the background."
            case .microphone:
                return "Lets Flyd hear your request while you hold the shortcut."
            }
        }

        var grantInstructions: String {
            switch self {
            case .accessibility:
                return "Flyd will ask macOS to add it to Accessibility, then open Settings so you can turn it on."
            case .keyboardShortcut:
                return "Flyd will ask macOS to allow the Control + Option shortcut."
            case .screenRecording:
                return "Flyd will ask macOS to add it to Screen Recording, then open Settings so you can turn it on."
            case .microphone:
                return "Allow microphone access when macOS asks, or turn on Flyd in Microphone."
            }
        }

        var isRequired: Bool {
            switch self {
            case .accessibility, .keyboardShortcut:
                return true
            case .screenRecording, .microphone:
                return false
            }
        }
    }

    var hasAccessibility: Bool {
        AXIsProcessTrusted()
    }

    var hasKeyboardShortcut: Bool {
        IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) == kIOHIDAccessTypeGranted
    }

    var hasScreenRecording: Bool {
        let granted = CGPreflightScreenCaptureAccess()
        return granted
    }

    var hasMicrophone: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    func status(for permission: Permission) -> Bool {
        switch permission {
        case .accessibility: return hasAccessibility
        case .keyboardShortcut: return hasKeyboardShortcut
        case .screenRecording: return hasScreenRecording
        case .microphone: return hasMicrophone
        }
    }

    func snapshot() -> PermissionSnapshot {
        PermissionSnapshot(
            bundleURL: Bundle.main.bundleURL.path,
            bundleIdentifier: Bundle.main.bundleIdentifier ?? "none",
            executableURL: Bundle.main.executableURL?.path ?? "none",
            processIdentifier: ProcessInfo.processInfo.processIdentifier,
            accessibility: hasAccessibility,
            keyboardShortcut: hasKeyboardShortcut,
            screenRecording: hasScreenRecording,
            microphone: hasMicrophone,
            capturedAt: Date()
        )
    }

    func writeDiagnosticSnapshot() {
        let snapshot = snapshot()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601

        let directoryURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".flyd/overlay", isDirectory: true)
        let fileURL = directoryURL.appendingPathComponent("permission-diagnostic.json")

        do {
            try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            let data = try encoder.encode(snapshot)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            print("[Flyd] Could not write permission diagnostic: \(error.localizedDescription)")
        }
    }

    func allRequiredGranted() -> Bool {
        hasAccessibility && hasKeyboardShortcut
    }

    func requestKeyboardShortcutPermission(_ completion: @escaping () -> Void = {}) {
        if hasKeyboardShortcut {
            completion()
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            _ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
            DispatchQueue.main.async(execute: completion)
        }
    }

    func requestScreenCapturePermission() {
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
        }
    }

    func requestMicrophonePermission(_ completion: @escaping () -> Void = {}) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            completion()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { _ in
                DispatchQueue.main.async(execute: completion)
            }
        case .denied, .restricted:
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
            completion()
        @unknown default:
            completion()
        }
    }

    func openSoundInputSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.sound?input")!)
    }

    func openSystemSettings(for permission: Permission) {
        switch permission {
        case .accessibility:
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            AXIsProcessTrustedWithOptions(options)
        case .keyboardShortcut:
            requestKeyboardShortcutPermission()
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")!)
        case .screenRecording:
            requestScreenCapturePermission()
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
        case .microphone:
            requestMicrophonePermission()
        }
    }
}

struct PermissionSnapshot: Encodable {
    let bundleURL: String
    let bundleIdentifier: String
    let executableURL: String
    let processIdentifier: Int32
    let accessibility: Bool
    let keyboardShortcut: Bool
    let screenRecording: Bool
    let microphone: Bool
    let capturedAt: Date
}
