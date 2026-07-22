import SwiftUI

struct PrivacySettingsView: View {
    @ObservedObject private var viewModel = PrivacySettingsViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Privacy Settings")
                .font(.headline)
                .padding(.bottom, 12)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    retentionSection
                    Divider()
                    excludedAppsSection
                    Divider()
                    redactionSection
                    Divider()
                    incognitoSection
                    Divider()
                    privacyInvariantsSection
                }
                .padding(.bottom, 16)
            }

            HStack {
                Spacer()
                Button("Close") {
                    NSApplication.shared.keyWindow?.close()
                }
                .keyboardShortcut(.return)
            }
            .padding(.top, 8)
        }
        .padding()
        .frame(width: 480, height: 560)
    }

    private var retentionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Retention Mode")
                .font(.subheadline)
                .fontWeight(.semibold)

            Text("Controls what Flyd remembers. PRESENT observations are never stored — full stop.")
                .font(.caption)
                .foregroundColor(.secondary)

            Picker("Retention", selection: $viewModel.retention) {
                ForEach(OverlayConfig.RetentionMode.allCases, id: \.self) { mode in
                    Text(mode.displayName).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: viewModel.retention) { _, newValue in
                viewModel.setRetention(newValue)
            }

            Text(viewModel.retention.explanation)
                .font(.caption)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var excludedAppsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("App Exclusions")
                .font(.subheadline)
                .fontWeight(.semibold)

            Text("Flyd will not observe or invoke in these applications.")
                .font(.caption)
                .foregroundColor(.secondary)

            if viewModel.excludedApps.isEmpty {
                Text("No apps excluded.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.vertical, 4)
            } else {
                ForEach(viewModel.excludedApps, id: \.self) { app in
                    HStack {
                        Text(app)
                            .font(.caption)
                        Spacer()
                        Button("Remove") {
                            viewModel.removeExcludedApp(app)
                        }
                        .controlSize(.small)
                    }
                }
            }

            HStack {
                TextField("Bundle ID (e.g., com.apple.mail)", text: $viewModel.newExcludedApp)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.small)

                Button("Add") {
                    viewModel.addExcludedApp()
                }
                .controlSize(.small)
                .disabled(viewModel.newExcludedApp.isEmpty)
            }
        }
    }

    private var redactionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Redaction Rules")
                .font(.subheadline)
                .fontWeight(.semibold)

            Text("Sensitive data patterns are redacted from captured context before sending to Flyd Core.")
                .font(.caption)
                .foregroundColor(.secondary)

            ForEach(viewModel.redactionRules) { rule in
                Toggle(rule.description, isOn: Binding(
                    get: { rule.enabled },
                    set: { viewModel.setRedaction(rule.id, enabled: $0) }
                ))
                .font(.caption)
            }
        }
    }

    private var incognitoSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Incognito Mode", isOn: $viewModel.incognito)
                .font(.subheadline)
                .fontWeight(.semibold)
                .onChange(of: viewModel.incognito) { _, newValue in
                    viewModel.setIncognito(newValue)
                }

            Text("When enabled, all invocations are fully ephemeral. No memory, no audit, no learning. Overrides retention settings.")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }

    private var privacyInvariantsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Enforced Privacy Invariants")
                .font(.subheadline)
                .fontWeight(.semibold)

            Text("These are architectural constraints — not configurable. They apply regardless of your retention settings. Incognito mode adds additional runtime restrictions on top of these.")
                .font(.caption)
                .foregroundColor(.secondary)

            let results = PrivacyInvariants.verifyAll()
            ForEach(results, id: \.0) { (id, passed, description) in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: passed ? "checkmark.shield.fill" : "xmark.shield.fill")
                        .foregroundColor(passed ? .green : .red)
                        .font(.caption)

                    Text("#\(id): \(description)")
                        .font(.caption2)
                        .foregroundColor(passed ? .secondary : .red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

private class PrivacySettingsViewModel: ObservableObject {
    @Published var retention: OverlayConfig.RetentionMode = .balanced
    @Published var excludedApps: [String] = []
    @Published var newExcludedApp: String = ""
    @Published var redactionRules: [OverlayConfig.RedactionRule] = []
    @Published var incognito: Bool = false

    init() {
        let config = ConfigManager.shared.config
        retention = config.retention
        excludedApps = config.excludedApps
        redactionRules = config.redactionRules
        incognito = config.incognito
    }

    func setRetention(_ mode: OverlayConfig.RetentionMode) {
        ConfigManager.shared.setRetention(mode)
    }

    func addExcludedApp() {
        guard !newExcludedApp.isEmpty else { return }
        ConfigManager.shared.excludeApp(newExcludedApp)
        excludedApps = ConfigManager.shared.config.excludedApps
        newExcludedApp = ""
    }

    func removeExcludedApp(_ bundleId: String) {
        ConfigManager.shared.removeExcludedApp(bundleId)
        excludedApps = ConfigManager.shared.config.excludedApps
    }

    func setRedaction(_ id: String, enabled: Bool) {
        ConfigManager.shared.setRedactionRule(id, enabled: enabled)
        redactionRules = ConfigManager.shared.config.redactionRules
    }

    func setIncognito(_ enabled: Bool) {
        ConfigManager.shared.setIncognito(enabled)
    }
}
