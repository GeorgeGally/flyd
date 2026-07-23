import AppKit
import ApplicationServices

final class PermissionsViewController: NSViewController {
    private var accessibilityStatus: NSTextField!
    private var screenRecordingStatus: NSTextField!
    private var microphoneStatus: NSTextField!
    private var continueButton: NSButton!
    private var timer: Timer?

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 400, height: 280))
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        let titleLabel = NSTextField(labelWithString: "Flyd needs Accessibility to work.")
        titleLabel.font = .boldSystemFont(ofSize: 14)
        titleLabel.frame = NSRect(x: 20, y: 240, width: 360, height: 20)
        view.addSubview(titleLabel)

        let subtitleLabel = NSTextField(wrappingLabelWithString: "Screen Recording and Microphone are optional. Flyd never observes without your explicit invocation.")
        subtitleLabel.font = .systemFont(ofSize: 11)
        subtitleLabel.textColor = .secondaryLabelColor
        subtitleLabel.frame = NSRect(x: 20, y: 210, width: 360, height: 30)
        view.addSubview(subtitleLabel)

        var y = addPermissionRow(y: 175, label: "Accessibility", explanation: "Reads the focused element and nearby context in any app.", tag: 0)
        y = addPermissionRow(y: y, label: "Screen Recording", explanation: "Captures screenshots when accessibility context is insufficient.", tag: 1)
        y = addPermissionRow(y: y, label: "Microphone", explanation: "Required for future voice mode. Not used yet.", tag: 2)

        continueButton = NSButton(frame: NSRect(x: 20, y: y - 30, width: 360, height: 28))
        continueButton.title = "Continue"
        continueButton.bezelStyle = .rounded
        continueButton.isEnabled = false
        continueButton.target = self
        continueButton.action = #selector(continueTapped)
        view.addSubview(continueButton)

        let quitButton = NSButton(frame: NSRect(x: 320, y: y - 30, width: 60, height: 28))
        quitButton.title = "Quit"
        quitButton.bezelStyle = .inline
        quitButton.target = self
        quitButton.action = #selector(quitTapped)
        view.addSubview(quitButton)

        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            DispatchQueue.main.async { self?.refresh() }
        }
    }

    @discardableResult
    private func addPermissionRow(y: CGFloat, label: String, explanation: String, tag: Int) -> CGFloat {
        let statusLabel = NSTextField(labelWithString: "○")
        statusLabel.font = .systemFont(ofSize: 16)
        statusLabel.frame = NSRect(x: 20, y: y + 18, width: 20, height: 20)
        view.addSubview(statusLabel)

        let nameLabel = NSTextField(labelWithString: label)
        nameLabel.font = .boldSystemFont(ofSize: 12)
        nameLabel.frame = NSRect(x: 44, y: y + 38, width: 200, height: 16)
        view.addSubview(nameLabel)

        let descLabel = NSTextField(wrappingLabelWithString: explanation)
        descLabel.font = .systemFont(ofSize: 10)
        descLabel.textColor = .secondaryLabelColor
        descLabel.frame = NSRect(x: 44, y: y + 20, width: 220, height: 20)
        view.addSubview(descLabel)

        let grantButton = NSButton(frame: NSRect(x: 300, y: y + 22, width: 80, height: 22))
        grantButton.title = "Grant"
        grantButton.bezelStyle = .rounded
        grantButton.controlSize = .small
        grantButton.tag = tag
        grantButton.target = self
        grantButton.action = #selector(grantTapped(_:))
        view.addSubview(grantButton)

        switch tag {
        case 0: accessibilityStatus = statusLabel; grantButton.isHidden = true
        case 1: screenRecordingStatus = statusLabel
        case 2: microphoneStatus = statusLabel
        default: break
        }

        return y - 60
    }

    @objc private func grantTapped(_ sender: NSButton) {
        switch sender.tag {
        case 0:
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            AXIsProcessTrustedWithOptions(options)
        case 1:
            PermissionGate.shared.requestScreenCapturePermission()
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
        case 2:
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
        default: break
        }
    }

    private func refresh() {
        let gate = PermissionGate.shared
        accessibilityStatus?.stringValue = gate.hasAccessibility ? "●" : "○"
        accessibilityStatus?.textColor = gate.hasAccessibility ? .systemGreen : .secondaryLabelColor
        screenRecordingStatus?.stringValue = gate.hasScreenRecording ? "●" : "○"
        screenRecordingStatus?.textColor = gate.hasScreenRecording ? .systemGreen : .secondaryLabelColor
        microphoneStatus?.stringValue = gate.hasMicrophone ? "●" : "○"
        microphoneStatus?.textColor = gate.hasMicrophone ? .systemGreen : .secondaryLabelColor
        continueButton?.isEnabled = gate.hasAccessibility
    }

    @objc private func continueTapped() {
        timer?.invalidate()
        view.window?.close()
    }

    @objc private func quitTapped() {
        NSApplication.shared.terminate(nil)
    }
}
