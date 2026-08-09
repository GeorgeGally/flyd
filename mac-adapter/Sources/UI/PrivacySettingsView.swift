import SwiftUI

struct PrivacySettingsView: View {
    @ObservedObject private var viewModel = PrivacySettingsViewModel()
    @State private var window: NSWindow?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Settings")
                .font(.headline)
                .padding(.bottom, 12)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    replyModeSection
                    Divider()
                    retentionSection
                    Divider()
                    feedbackCaptureSection
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
                    window?.close()
                }
                .keyboardShortcut(.escape)
            }
            .padding(.top, 8)
        }
        .padding()
        .frame(width: 480, height: 560)
        .background(WindowAccessor(window: $window))
    }

    private var replyModeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Reply Mode")
                .font(.subheadline)
                .fontWeight(.semibold)

            Text("How Flyd responds to voice invocations (fn+⌃). Text shortcuts (double-tap fn) always resolve silently.")
                .font(.caption)
                .foregroundColor(.secondary)

            Picker("Reply Mode", selection: $viewModel.replyMode) {
                ForEach(OverlayConfig.ReplyMode.allCases, id: \.self) { mode in
                    Text(mode.displayName).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .onChange(of: viewModel.replyMode) { _, newValue in
                viewModel.setReplyMode(newValue)
            }

            Text(viewModel.replyMode.explanation)
                .font(.caption)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var retentionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Retention Mode")
                .font(.subheadline)
                .fontWeight(.semibold)

            Text("Controls what Flyd remembers. Passive context stays ephemeral except for explicit negative feedback captured from enabled chat inputs.")
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

    private var feedbackCaptureSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Learn when I reject a Flyd answer elsewhere", isOn: $viewModel.foregroundFeedbackCapture)
                .font(.subheadline)
                .fontWeight(.semibold)
                .onChange(of: viewModel.foregroundFeedbackCapture) { _, enabled in
                    viewModel.setForegroundFeedbackCapture(enabled)
                }

            Text("In ChatGPT, Codex, and OpenCode input fields, Flyd locally captures complaint-like text and links an explicit rejection to a recent Flyd turn. Ambiguous terminal text stays pending and never becomes trusted memory. Disabled in Private retention and Incognito modes.")
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

            Text("Sensitive data patterns are redacted before Flyd receives context.")
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
    @Published var replyMode: OverlayConfig.ReplyMode = .text
    @Published var retention: OverlayConfig.RetentionMode = .balanced
    @Published var excludedApps: [String] = []
    @Published var newExcludedApp: String = ""
    @Published var redactionRules: [OverlayConfig.RedactionRule] = []
    @Published var incognito: Bool = false
    @Published var foregroundFeedbackCapture: Bool = true

    init() {
        refresh()
        NotificationCenter.default.addObserver(
            forName: .flydConfigDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.refresh()
        }
    }

    func refresh() {
        let config = ConfigManager.shared.config
        replyMode = config.replyMode
        retention = config.retention
        excludedApps = config.excludedApps
        redactionRules = config.redactionRules
        incognito = config.incognito
        foregroundFeedbackCapture = config.foregroundFeedbackCapture
    }

    func setReplyMode(_ mode: OverlayConfig.ReplyMode) {
        ConfigManager.shared.setReplyMode(mode)
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

    func setForegroundFeedbackCapture(_ enabled: Bool) {
        ConfigManager.shared.setForegroundFeedbackCapture(enabled)
    }
}
