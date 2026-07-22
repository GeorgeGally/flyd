import SwiftUI

struct AuditTrailView: View {
    @ObservedObject private var viewModel = AuditTrailViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Invocation History")
                    .font(.headline)

                Spacer()

                Text("\(viewModel.records.count) records")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.bottom, 12)

            if viewModel.records.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.title)
                        .foregroundColor(.secondary)
                    Text("No invocation records yet.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Text("Records appear here after you use Flyd. Only meaning is stored — no raw screen content, AX trees, or user text.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(width: 300)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(viewModel.records) { record in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(record.formattedDate)
                                .font(.caption)
                                .fontWeight(.medium)

                            Spacer()

                            HStack(spacing: 4) {
                                Circle()
                                    .fill(record.statusColor)
                                    .frame(width: 6, height: 6)
                                Text(record.statusLabel)
                                    .font(.caption2)
                                    .foregroundColor(record.statusColor)
                            }
                        }

                        Text("Sources: \(record.contextSources.joined(separator: ", "))")
                            .font(.caption2)
                            .foregroundColor(.secondary)

                        if let error = record.errorMessage {
                            Text(error)
                                .font(.caption2)
                                .foregroundColor(.red)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listStyle(.plain)
            }

            HStack {
                Text("Audit records are stored locally. Retention: \(retentionDays) days.")
                    .font(.caption2)
                    .foregroundColor(.secondary)

                Spacer()

                Button("Close") {
                    NSApplication.shared.keyWindow?.close()
                }
                .keyboardShortcut(.return)
            }
            .padding(.top, 8)
        }
        .padding()
        .frame(width: 500, height: 400)
    }

    private var retentionDays: Int {
        ConfigManager.shared.auditRetentionDays
    }
}

struct AuditRecordViewModel: Identifiable {
    let id: String
    let invocationId: String
    let timestamp: Date
    let contextSources: [String]
    let errorMessage: String?
    let statusLabel: String
    let statusColor: Color

    var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: timestamp)
    }
}

private class AuditTrailViewModel: ObservableObject {
    @Published var records: [AuditRecordViewModel] = []

    init() {
        loadRecords()
    }

    func loadRecords() {
        let auditDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".flyd/overlay/audit")

        guard let files = try? FileManager.default.contentsOfDirectory(
            at: auditDir,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: .skipsHiddenFiles
        ) else { return }

        let decoder = JSONDecoder()

        records = files
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> AuditRecordViewModel? in
                guard let data = try? Data(contentsOf: url),
                      let record = try? decoder.decode(RawAuditRecord.self, from: data) else { return nil }

                let status: String
                let color: Color
                if record.error != nil {
                    status = "Error"
                    color = .red
                } else if record.contextSources.contains("cancelled") {
                    status = "Cancelled"
                    color = .orange
                } else {
                    status = "Completed"
                    color = .green
                }

                return AuditRecordViewModel(
                    id: record.invocationId,
                    invocationId: record.invocationId,
                    timestamp: record.timestamp,
                    contextSources: record.contextSources,
                    errorMessage: record.error,
                    statusLabel: status,
                    statusColor: color
                )
            }
            .sorted { $0.timestamp > $1.timestamp }
    }
}

private struct RawAuditRecord: Codable {
    let invocationId: String
    let timestamp: Date
    let contextSources: [String]
    let error: String?
}
