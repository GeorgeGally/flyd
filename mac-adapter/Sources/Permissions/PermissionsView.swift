import SwiftUI

struct PermissionsView: View {
    @ObservedObject private var viewModel = PermissionsViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Flyd needs Accessibility to work.")
                .font(.headline)

            Text("Screen Recording and Microphone are optional for advanced features. Flyd never observes without your explicit invocation.")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Divider()

            ForEach(PermissionGate.Permission.allCases, id: \.self) { permission in
                PermissionRow(
                    permission: permission,
                    granted: viewModel.status(for: permission),
                    onGrant: {
                        if permission == .screenRecording {
                            viewModel.requestScreenCapture()
                        }
                        PermissionGate.shared.openSystemSettings(for: permission)
                    }
                )
            }

            Spacer()

            HStack {
                if viewModel.status(for: .accessibility) {
                    Button("Continue") {
                        if let window = NSApplication.shared.windows.first(where: { $0.title.contains("Permissions") }) {
                            window.close()
                        }
                    }
                    .keyboardShortcut(.return)
                } else {
                    Text("Grant Accessibility permission to continue.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Button("Quit Flyd") {
                    NSApplication.shared.terminate(nil)
                }
            }
        }
        .padding()
        .frame(width: 400, height: 320)
    }
}

private class PermissionsViewModel: ObservableObject {
    private var timer: Timer?

    init() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.objectWillChange.send()
        }
    }

    func status(for permission: PermissionGate.Permission) -> Bool {
        PermissionGate.shared.status(for: permission)
    }

    func requestScreenCapture() {
        PermissionGate.shared.requestScreenCapturePermission()
    }
}

private struct PermissionRow: View {
    let permission: PermissionGate.Permission
    let granted: Bool
    let onGrant: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: granted ? "checkmark.circle.fill" : "circle")
                .foregroundColor(granted ? .green : .secondary)
                .font(.title3)

            VStack(alignment: .leading, spacing: 4) {
                Text(permission.displayName)
                    .font(.body)
                    .fontWeight(.medium)

                Text(permission.explanation)
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


