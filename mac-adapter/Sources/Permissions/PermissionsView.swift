import SwiftUI

struct PermissionsView: View {
    @ObservedObject private var viewModel = PermissionsViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Flyd needs these permissions to work.")
                .font(.headline)

            Text("Each permission enables a specific capability. Flyd never observes without your explicit invocation.")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Divider()

            ForEach(PermissionGate.Permission.allCases, id: \.self) { permission in
                PermissionRow(
                    permission: permission,
                    granted: viewModel.status(for: permission)
                )
            }

            Spacer()

            HStack {
                Text("Press ⌃⌥ anytime to ask Flyd something.")
                    .font(.caption)
                    .foregroundColor(.secondary)

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
    func status(for permission: PermissionGate.Permission) -> Bool {
        PermissionGate.shared.status(for: permission)
    }
}

private struct PermissionRow: View {
    let permission: PermissionGate.Permission
    let granted: Bool

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
                Button("Grant") {
                    PermissionGate.shared.openSystemSettings(for: permission)
                }
                .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }
}


