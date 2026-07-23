import SwiftUI

struct PermissionsView: View {
    @StateObject private var viewModel = PermissionsViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Flyd needs Accessibility to work.")
                .font(.headline)

            Text("Screen Recording and Microphone are optional. Flyd never observes without your explicit invocation.")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Divider()

            PermissionRow(
                label: "Accessibility",
                explanation: "Allows Flyd to read the focused element and nearby context in any application.",
                granted: viewModel.accessibilityGranted,
                onGrant: { PermissionGate.shared.openSystemSettings(for: .accessibility) }
            )

            PermissionRow(
                label: "Screen Recording",
                explanation: "Allows Flyd to capture screenshots when accessibility context is insufficient.",
                granted: viewModel.screenRecordingGranted,
                onGrant: {
                    PermissionGate.shared.requestScreenCapturePermission()
                    PermissionGate.shared.openSystemSettings(for: .screenRecording)
                }
            )

            PermissionRow(
                label: "Microphone",
                explanation: "Required for future voice mode. Not used yet.",
                granted: viewModel.microphoneGranted,
                onGrant: { PermissionGate.shared.openSystemSettings(for: .microphone) }
            )

            Spacer()

            HStack {
                if viewModel.accessibilityGranted {
                    Button("Continue") {
                        if let window = NSApplication.shared.windows.first(where: {
                            $0.title.contains("Permissions")
                        }) {
                            window.close()
                        }
                    }
                    .keyboardShortcut(.return)
                } else {
                    Text("Open System Settings → Privacy & Security → Accessibility and enable Flyd.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Button("Quit") {
                    NSApplication.shared.terminate(nil)
                }
            }
        }
        .padding()
        .frame(width: 420, height: 320)
    }
}

private class PermissionsViewModel: ObservableObject {
    @Published var accessibilityGranted = false
    @Published var screenRecordingGranted = false
    @Published var microphoneGranted = false
    private var timer: Timer?

    init() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    func refresh() {
        let g = PermissionGate.shared
        accessibilityGranted = g.hasAccessibility
        screenRecordingGranted = g.hasScreenRecording
        microphoneGranted = g.hasMicrophone
    }
}

private struct PermissionRow: View {
    let label: String
    let explanation: String
    let granted: Bool
    let onGrant: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: granted ? "checkmark.circle.fill" : "circle")
                .foregroundColor(granted ? .green : .secondary)
                .font(.title3)

            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.body)
                    .fontWeight(.medium)
                Text(explanation)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            if !granted {
                Button("Grant") { onGrant() }
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }
}
