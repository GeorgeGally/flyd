import SwiftUI

/// Settings wears the Setup screens' look: big title over a grey subtitle, each setting on a
/// white rounded card, one blue button in the footer.
struct PrivacySettingsView: View {
    @ObservedObject private var viewModel = PrivacySettingsViewModel()
    @State private var window: NSWindow?

    var body: some View {
        VStack(spacing: 0) {
            SetupIntro(
                title: "Settings",
                subtitle: "How Flyd replies, what it remembers, and what it never sees."
            )
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 52)
            .padding(.top, 44)
            .padding(.bottom, 22)

            ScrollView {
                VStack(spacing: 14) {
                    replyModeSection
                    retentionSection
                    feedbackCaptureSection
                    excludedAppsSection
                    redactionSection
                    incognitoSection
                    privacyInvariantsSection
                }
                .padding(.horizontal, 52)
                .padding(.vertical, 8)
            }

            HStack {
                Spacer()
                Button("Close") {
                    window?.close()
                }
                .buttonStyle(PrimaryButtonStyle(isEnabled: true))
                .keyboardShortcut(.escape)
            }
            .padding(.horizontal, 52)
            .padding(.vertical, 26)
        }
        .frame(minWidth: 560, idealWidth: 680, maxWidth: .infinity, minHeight: 480, idealHeight: 760, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .background(WindowAccessor(window: $window))
    }

    private var replyModeSection: some View {
        SettingsCard {
            SettingText(
                title: "Reply Mode",
                detail: "How Flyd responds to voice invocations (fn+⌃). Text shortcuts (double-tap fn) always resolve silently."
            )

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

            SettingDetail(viewModel.replyMode.explanation)
        }
    }

    private var retentionSection: some View {
        SettingsCard {
            SettingText(
                title: "Retention Mode",
                detail: "Controls what Flyd remembers. Passive context stays ephemeral except for explicit negative feedback captured from enabled chat inputs."
            )

            Picker("Retention", selection: $viewModel.retention) {
                ForEach(OverlayConfig.RetentionMode.allCases, id: \.self) { mode in
                    Text(mode.displayName).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .onChange(of: viewModel.retention) { _, newValue in
                viewModel.setRetention(newValue)
            }

            SettingDetail(viewModel.retention.explanation)
        }
    }

    @ViewBuilder
    private var feedbackCaptureSection: some View {
        SettingToggleRow(
            title: "Use nearby text to recognise names",
            detail: "During dictation only, relevant terms from selected and nearby text help recognition. The context is discarded after the invocation.",
            isOn: $viewModel.dictationContext
        )
        .onChange(of: viewModel.dictationContext) { _, enabled in
            ConfigManager.shared.setDictationContext(enabled)
        }

        SettingToggleRow(
            title: "Learn vocabulary from dictation edits",
            detail: "Tracks only inserted text for up to 30 seconds in supported fields. Clear spelling fixes become hints; three independent eligible fixes activate a contextual rule. Stores the changed terms and up to two neighbouring words per side. Inspect, reject or view local recurrence reports with flyd learning. Learned words go to the transcription service. Disabled in Private and Incognito modes.",
            isOn: $viewModel.dictationCorrectionLearning
        )
        .onChange(of: viewModel.dictationCorrectionLearning) { _, enabled in
            ConfigManager.shared.setDictationCorrectionLearning(enabled)
        }

        SettingToggleRow(
            title: "Learn when I reject a Flyd answer elsewhere",
            detail: "In ChatGPT, Codex, and OpenCode input fields, Flyd locally captures complaint-like text and links an explicit rejection to a recent Flyd turn. Ambiguous terminal text stays pending and never becomes trusted memory. Disabled in Private retention and Incognito modes.",
            isOn: $viewModel.foregroundFeedbackCapture
        )
        .onChange(of: viewModel.foregroundFeedbackCapture) { _, enabled in
            viewModel.setForegroundFeedbackCapture(enabled)
        }
    }

    private var excludedAppsSection: some View {
        SettingsCard {
            SettingText(
                title: "App Exclusions",
                detail: "Flyd will not observe or invoke in these applications."
            )

            if viewModel.excludedApps.isEmpty {
                SettingDetail("No apps excluded.")
            } else {
                VStack(spacing: 8) {
                    ForEach(viewModel.excludedApps, id: \.self) { app in
                        HStack(spacing: 12) {
                            Text(app)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Color.primary)
                            Spacer(minLength: 12)
                            Button("Remove") {
                                viewModel.removeExcludedApp(app)
                            }
                            .buttonStyle(SecondaryButtonStyle(width: 92))
                        }
                    }
                }
            }

            HStack(spacing: 12) {
                TextField("Bundle ID (e.g., com.apple.mail)", text: $viewModel.newExcludedApp)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.large)

                Button("Add") {
                    viewModel.addExcludedApp()
                }
                .buttonStyle(SecondaryButtonStyle(width: 76))
                .disabled(viewModel.newExcludedApp.isEmpty)
                .opacity(viewModel.newExcludedApp.isEmpty ? 0.5 : 1)
            }
        }
    }

    private var redactionSection: some View {
        SettingsCard {
            SettingText(
                title: "Redaction Rules",
                detail: "Sensitive data patterns are redacted before Flyd receives context."
            )

            VStack(spacing: 10) {
                ForEach(viewModel.redactionRules) { rule in
                    HStack(spacing: 12) {
                        Text(rule.description)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.primary)
                        Spacer(minLength: 12)
                        Toggle(rule.description, isOn: Binding(
                            get: { rule.enabled },
                            set: { viewModel.setRedaction(rule.id, enabled: $0) }
                        ))
                        .toggleStyle(.switch)
                        .controlSize(.small)
                        .labelsHidden()
                    }
                }
            }
        }
    }

    private var incognitoSection: some View {
        SettingToggleRow(
            title: "Incognito Mode",
            detail: "When enabled, all invocations are fully ephemeral. No memory, no audit, no learning. Overrides retention settings.",
            isOn: $viewModel.incognito
        )
        .onChange(of: viewModel.incognito) { _, newValue in
            viewModel.setIncognito(newValue)
        }
    }

    private var privacyInvariantsSection: some View {
        SettingsCard {
            SettingText(
                title: "Enforced Privacy Invariants",
                detail: "These are architectural constraints — not configurable. They apply regardless of your retention settings. Incognito mode adds additional runtime restrictions on top of these."
            )

            let results = PrivacyInvariants.verifyAll()
            VStack(alignment: .leading, spacing: 8) {
                ForEach(results, id: \.0) { (id, passed, description) in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: passed ? "checkmark.shield.fill" : "xmark.shield.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(passed ? Color.green : Color.red)

                        Text("#\(id): \(description)")
                            .font(.system(size: 12))
                            .foregroundStyle(passed ? Color.secondary : Color.red)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

/// One setting on a Setup-style card.
private struct SettingsCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SetupCardBackground())
    }
}

/// A setting's bold name over its grey explanation, sized like a Setup row.
private struct SettingText: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Color.primary)
                .fixedSize(horizontal: false, vertical: true)

            SettingDetail(detail)
        }
    }
}

private struct SettingDetail: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(Color.secondary)
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// An on/off setting laid out like a Setup permission row: text on the left, switch on the right.
private struct SettingToggleRow: View {
    let title: String
    let detail: String
    @Binding var isOn: Bool

    var body: some View {
        SettingsCard {
            HStack(alignment: .center, spacing: 16) {
                SettingText(title: title, detail: detail)
                Spacer(minLength: 16)
                Toggle(title, isOn: $isOn)
                    .toggleStyle(.switch)
                    .labelsHidden()
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
    @Published var dictationContext: Bool = true
    @Published var dictationCorrectionLearning: Bool = false
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
        dictationContext = config.dictationContext
        dictationCorrectionLearning = config.dictationCorrectionLearning
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
