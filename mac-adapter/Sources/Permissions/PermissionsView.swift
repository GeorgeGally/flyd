import AppKit
import SwiftUI

private let successColor = Color(nsColor: .systemGreen)

final class PermissionsViewController: NSHostingController<PermissionsView> {
    init(onContinue: @escaping () -> Void, onQuit: @escaping () -> Void) {
        super.init(rootView: PermissionsView(onContinue: onContinue, onQuit: onQuit))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

struct PermissionsView: View {
    @StateObject private var viewModel = PermissionsViewModel()
    @State private var step: SetupStep = .permissions

    let onContinue: () -> Void
    let onQuit: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 26) {
                switch step {
                case .permissions:
                    permissionsIntro
                    permissionList
                case .microphone:
                    microphoneIntro
                    microphoneTest
                case .shortcuts:
                    shortcutIntro
                    shortcutList
                case .firstPrompt:
                    firstPromptIntro
                    firstPromptStep
                }
            }
            .padding(.horizontal, 52)
            .padding(.top, 44)
            .padding(.bottom, 30)

            footer
        }
        .frame(width: 740, height: 680)
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear { viewModel.startRefreshing() }
        .onDisappear {
            viewModel.stopRefreshing()
            viewModel.stopShortcutPractice()
            viewModel.stopMicrophonePractice()
            viewModel.stopFirstPromptPractice()
        }
    }

    private var permissionsIntro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Set up Flyd")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Color.primary)

            Text("Flyd needs two Mac permissions to hear the shortcut and understand the app you are using. Screen Recording helps when app context is not enough. Microphone lets you speak to Flyd.")
                .font(.system(size: 16))
                .foregroundStyle(Color.secondary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 560, alignment: .leading)
        }
    }

    private var shortcutIntro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Learn the shortcut")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Color.primary)

            Text("Double-tap Fn to type. Hold Fn + Control to talk.")
                .font(.system(size: 16))
                .foregroundStyle(Color.secondary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 560, alignment: .leading)
        }
    }

    private var firstPromptIntro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Try it for real")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Color.primary)

            Text("Hold Fn + Control, say the phrase below out loud, then release.")
                .font(.system(size: 16))
                .foregroundStyle(Color.secondary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 560, alignment: .leading)
        }
    }

    private var microphoneIntro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Test your microphone")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Color.primary)

            Text("Say a few words out loud. When Flyd can hear you, the bars will move.")
                .font(.system(size: 16))
                .foregroundStyle(Color.secondary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 560, alignment: .leading)
        }
    }

    private var permissionList: some View {
        VStack(spacing: 14) {
            ForEach(PermissionGate.Permission.allCases) { permission in
                PermissionSetupRow(
                    permission: permission,
                    isGranted: viewModel.isGranted(permission),
                    action: { request(permission) }
                )
            }
        }
    }

    private var shortcutList: some View {
        VStack(spacing: 14) {
            ShortcutPracticeRow(
                keys: ["fn", "⌃"],
                isDetected: viewModel.shortcutDetected,
                title: viewModel.shortcutDetected ? "Shortcut works" : "Hold Fn + Control",
                detail: viewModel.shortcutDetected ? "Good. Next you will say something for real." : "Hold both keys together for a moment."
            )
        }
    }

    private var firstPromptStep: some View {
        VStack(spacing: 14) {
            FirstPromptRow(
                title: promptStatusTitle,
                prompt: "summarize this page in one sentence",
                detail: promptStatusDetail
            )

            if !viewModel.transcribedText.isEmpty {
                transcribedTextBubble
            }

            firstPromptStatusRow
        }
    }

    private var transcribedTextBubble: some View {
        HStack {
            Spacer()
            Text(viewModel.transcribedText)
                .font(.system(size: 15))
                .foregroundStyle(Color.primary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color.accentColor.opacity(0.15))
                )
        }
        .padding(.horizontal, 18)
    }

    private var promptStatusTitle: String {
        if viewModel.promptSpoken { return "Got it" }
        if viewModel.promptHeld { return "Keep talking…" }
        return "Say this out loud"
    }

    private var promptStatusDetail: String {
        if viewModel.promptSpoken { return "Flyd heard you say it. This is exactly how it works day to day." }
        if viewModel.promptHeld { return "Hold both keys and speak — Flyd is listening." }
        return "Hold Fn + Control, say the phrase above, then release the keys."
    }

    private var firstPromptStatusRow: some View {
        HStack(spacing: 14) {
            StatusOrb(
                color: viewModel.promptSpoken ? successColor : (viewModel.promptHeld ? .orange : Color.secondary.opacity(0.5)),
                size: 10
            )
            .frame(width: 16)

            MiniWaveform(bands: viewModel.microphoneBands, active: viewModel.promptHeld)
                .frame(height: 34)

            Spacer(minLength: 12)

            Text(viewModel.promptSpoken ? "Heard it" : (viewModel.promptHeld ? "Listening…" : "Waiting for shortcut"))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(viewModel.promptSpoken ? successColor : Color.secondary)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(minHeight: 86)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color(nsColor: .textBackgroundColor).opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(viewModel.promptSpoken ? successColor.opacity(0.45) : Color(nsColor: .separatorColor), lineWidth: 1)
                )
        )
    }

    private var microphoneTest: some View {
        HStack(spacing: 34) {
            VStack(alignment: .leading, spacing: 20) {
                Spacer(minLength: 8)

                Text(viewModel.microphoneHeard ? "Flyd can hear you." : "Do the bars move while you speak?")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color.primary)

                Text(viewModel.microphoneHeard ? "Good. Voice is ready for hold-to-speak." : "Speak normally for a moment. You do not need to say a command yet.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.secondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)

                inputDeviceRow

                if viewModel.microphoneSilentTooLong {
                    silentHint
                }

                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            MicrophoneTestVisual(bands: viewModel.microphoneBands, isHeard: viewModel.microphoneHeard)
                .frame(width: 310, height: 300)
        }
        .frame(maxWidth: .infinity, minHeight: 360)
    }

    private var inputDeviceRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "mic")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.secondary)

            Text(viewModel.microphoneInputName.map { "Input: \($0)" } ?? "No input device detected")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.secondary)

            Button("Change") {
                viewModel.openSoundInputSettings()
            }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Color.accentColor)
        }
    }

    private var silentHint: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13))
                .foregroundStyle(Color.orange)

            VStack(alignment: .leading, spacing: 8) {
                Text("Not hearing anything on \(viewModel.microphoneInputName ?? "this input").")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.primary)

                Text("Check macOS has the right microphone selected, then try speaking again.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.secondary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)

                Button("Open Sound Settings") {
                    viewModel.openSoundInputSettings()
                }
                .buttonStyle(SecondaryButtonStyle(width: 156))
            }
        }
        .padding(14)
        .frame(maxWidth: 420, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.orange.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                )
        )
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Button("Quit", action: onQuit)
                .buttonStyle(.plain)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.secondary)
                .frame(width: 86, height: 36)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color(nsColor: .controlBackgroundColor))
                )

            Spacer()

            if step != .permissions {
                Button("Back") {
                    goBack()
                }
                .buttonStyle(SecondaryButtonStyle(width: 92))
            }

            if step == .microphone, !viewModel.microphoneHeard {
                Button("Skip Voice") {
                    beginShortcutPractice()
                }
                .buttonStyle(SecondaryButtonStyle(width: 112))
            }

            if step == .firstPrompt, !viewModel.promptSpoken {
                Button("Skip") {
                    viewModel.stopFirstPromptPractice()
                    onContinue()
                }
                .buttonStyle(SecondaryButtonStyle(width: 92))
            }

            Button("Continue") {
                switch step {
                case .permissions:
                    if viewModel.isGranted(.microphone) {
                        beginMicrophoneTest()
                    } else {
                        beginShortcutPractice()
                    }
                case .microphone:
                    beginShortcutPractice()
                case .shortcuts:
                    if viewModel.microphoneHeard {
                        beginFirstPromptPractice()
                    } else {
                        viewModel.stopShortcutPractice()
                        onContinue()
                    }
                case .firstPrompt:
                    viewModel.stopFirstPromptPractice()
                    onContinue()
                }
            }
            .buttonStyle(PrimaryButtonStyle(isEnabled: canPressContinue))
            .disabled(!canPressContinue)
        }
        .padding(.horizontal, 52)
        .padding(.vertical, 26)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var canPressContinue: Bool {
        switch step {
        case .permissions:
            return viewModel.canContinue
        case .microphone:
            return viewModel.microphoneHeard
        case .shortcuts:
            return viewModel.shortcutDetected
        case .firstPrompt:
            return viewModel.promptSpoken
        }
    }

    private func request(_ permission: PermissionGate.Permission) {
        viewModel.request(permission) { granted in
            if permission == .microphone, granted, viewModel.canContinue {
                beginMicrophoneTest()
            }
        }
    }

    private func beginMicrophoneTest() {
        viewModel.stopShortcutPractice()
        step = .microphone
        viewModel.startMicrophonePractice()
    }

    private func beginShortcutPractice() {
        viewModel.stopMicrophonePractice()
        step = .shortcuts
        viewModel.startShortcutPractice()
    }

    private func beginFirstPromptPractice() {
        viewModel.stopShortcutPractice()
        step = .firstPrompt
        viewModel.startFirstPromptPractice()
    }

    private func goBack() {
        switch step {
        case .permissions:
            break
        case .microphone:
            viewModel.stopMicrophonePractice()
            step = .permissions
        case .shortcuts:
            viewModel.stopShortcutPractice()
            if viewModel.isGranted(.microphone) {
                beginMicrophoneTest()
            } else {
                step = .permissions
            }
        case .firstPrompt:
            viewModel.stopFirstPromptPractice()
            step = .shortcuts
            viewModel.startShortcutPractice()
        }
    }
}

private enum SetupStep {
    case permissions
    case microphone
    case shortcuts
    case firstPrompt
}

private struct PermissionSetupRow: View {
    let permission: PermissionGate.Permission
    let isGranted: Bool
    let action: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            StatusOrb(color: isGranted ? .green : .red, size: 12)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(permission.displayName)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.primary)

                    if !permission.isRequired {
                        Text("Optional")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(
                                Capsule()
                                    .fill(Color(nsColor: .controlBackgroundColor))
                            )
                    }
                }

                Text(permission.explanation)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.secondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 16)

            VStack(alignment: .trailing, spacing: 8) {
                if isGranted {
                    Text("On")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(successColor)
                } else {
                    Button(buttonTitle, action: action)
                        .buttonStyle(SecondaryButtonStyle(width: 126))
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(minHeight: 86)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color(nsColor: .textBackgroundColor).opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
                )
        )
    }

    private var buttonTitle: String {
        switch permission {
        case .accessibility, .keyboardShortcut:
            return "Open Settings"
        case .screenRecording:
            return "Open Settings"
        case .microphone:
            return "Allow"
        }
    }
}

private struct StatusOrb: View {
    let color: Color
    let size: CGFloat

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .overlay(
                Circle()
                    .stroke(Color.white.opacity(0.65), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

private struct FirstPromptRow: View {
    let title: String
    let prompt: String
    let detail: String

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            Image(systemName: "quote.bubble.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.secondary)
                .frame(width: 112, alignment: .leading)

            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.primary)

                Text("“\(prompt)”")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.primary)

                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.secondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(minHeight: 86)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color(nsColor: .textBackgroundColor).opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
                )
        )
    }
}

private struct MiniWaveform: View {
    let bands: [CGFloat]
    let active: Bool

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(bands.enumerated()), id: \.offset) { _, value in
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(active ? Color.accentColor : Color.secondary.opacity(0.25))
                    .frame(width: 5, height: max(0, min(1, value)) * 26 + 6)
                    .animation(.spring(response: 0.2, dampingFraction: 0.8), value: value)
            }
        }
    }
}

private struct MicrophoneTestVisual: View {
    let bands: [CGFloat]
    let isHeard: Bool

    @State private var breathe = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color(nsColor: .textBackgroundColor).opacity(0.9))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.07), radius: 18, x: 0, y: 10)

            VStack(spacing: 22) {
                ZStack {
                    Circle()
                        .fill(isHeard ? successColor.opacity(0.12) : Color(nsColor: .controlBackgroundColor))
                        .overlay(
                            Circle()
                                .stroke(isHeard ? successColor.opacity(0.4) : Color(nsColor: .separatorColor), lineWidth: 1)
                        )
                        .frame(width: 64, height: 64)
                        .scaleEffect(!isHeard && breathe ? 1.04 : 1.0)

                    Image(systemName: "mic.fill")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(isHeard ? successColor : Color.secondary)
                }
                .shadow(color: isHeard ? successColor.opacity(0.18) : .clear, radius: 8)
                .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: breathe)

                HStack(spacing: 7) {
                    ForEach(Array(bands.enumerated()), id: \.offset) { _, value in
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(barColor(for: value))
                            .frame(width: 9, height: barHeight(for: value))
                            .animation(.spring(response: 0.22, dampingFraction: 0.78), value: value)
                    }
                }
                .frame(height: 72)
                .padding(.horizontal, 22)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color(nsColor: .controlBackgroundColor).opacity(0.7))
                )

                Text(isHeard ? "Voice ready" : "Listening…")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(isHeard ? successColor : Color.secondary)
            }
            .padding(28)
        }
        .onAppear { breathe = true }
    }

    private func barHeight(for value: CGFloat) -> CGFloat {
        let base: CGFloat = 10
        let dynamic = max(0, min(1, value)) * 62
        return base + dynamic
    }

    private func barColor(for value: CGFloat) -> Color {
        if isHeard || value > 0.06 {
            return Color.accentColor
        }
        return Color.secondary.opacity(0.22)
    }
}

private struct ShortcutPracticeRow: View {
    let keys: [String]
    let isDetected: Bool
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            KeySequence(keys: keys)

            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.primary)

                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.secondary)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)

            Text(isDetected ? "Ready" : "Waiting")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(isDetected ? successColor : Color.secondary)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(minHeight: 86)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color(nsColor: .textBackgroundColor).opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(isDetected ? successColor.opacity(0.45) : Color(nsColor: .separatorColor), lineWidth: 1)
                )
        )
    }
}

private struct KeySequence: View {
    let keys: [String]

    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(keys.enumerated()), id: \.offset) { _, key in
                Text(key)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color.primary)
                    .frame(width: 34, height: 30)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(Color(nsColor: .controlBackgroundColor))
                            .overlay(
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
                            )
                    )
            }
        }
        .frame(width: 112, alignment: .leading)
    }
}

private struct PrimaryButtonStyle: ButtonStyle {
    let isEnabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(isEnabled ? Color.white : Color.secondary)
            .frame(width: 132, height: 36)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isEnabled ? Color.accentColor : Color(nsColor: .controlBackgroundColor))
            )
            .opacity(configuration.isPressed ? 0.86 : 1.0)
    }
}

private struct SecondaryButtonStyle: ButtonStyle {
    var width: CGFloat = 118

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Color.primary)
            .frame(width: width, height: 34)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
                    )
            )
            .opacity(configuration.isPressed ? 0.78 : 1.0)
    }
}

private final class PermissionsViewModel: ObservableObject {
    @Published private var granted: [PermissionGate.Permission: Bool] = [:]
    @Published var shortcutDetected = false
    @Published var microphoneLevel: CGFloat = 0
    @Published var microphoneHeard = false
    @Published var microphoneInputName: String?
    @Published var microphoneSilentTooLong = false
    @Published var microphoneBands: [CGFloat] = Array(repeating: 0, count: 15)
    @Published var promptHeld = false
    @Published var promptSpoken = false
    @Published var transcribedText = ""

    private var timer: Timer?
    private var micSilenceTimer: Timer?
    private var localShortcutMonitor: Any?
    private var globalShortcutMonitor: Any?
    private var promptLocalMonitor: Any?
    private var promptGlobalMonitor: Any?

    var canContinue: Bool {
        PermissionGate.Permission.allCases
            .filter(\.isRequired)
            .allSatisfy { granted[$0] == true }
    }

    func startRefreshing() {
        refresh()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    func stopRefreshing() {
        timer?.invalidate()
        timer = nil
    }

    func refresh() {
        let gate = PermissionGate.shared
        gate.writeDiagnosticSnapshot()

        var next: [PermissionGate.Permission: Bool] = [:]
        for permission in PermissionGate.Permission.allCases {
            next[permission] = gate.status(for: permission)
        }
        granted = next
    }

    func isGranted(_ permission: PermissionGate.Permission) -> Bool {
        granted[permission] == true
    }

    func request(_ permission: PermissionGate.Permission, completion: @escaping (Bool) -> Void = { _ in }) {
        switch permission {
        case .microphone:
            requestMicrophone(completion: completion)
        case .accessibility, .keyboardShortcut, .screenRecording:
            requestSettingsPermission(permission, completion: completion)
        }
    }

    private func requestMicrophone(completion: @escaping (Bool) -> Void) {
        let gate = PermissionGate.shared
        gate.requestMicrophonePermission { [weak self] in
            self?.refresh()
            NSApplication.shared.activate(ignoringOtherApps: true)
            NSApplication.shared.keyWindow?.makeKeyAndOrderFront(nil)
            completion(gate.hasMicrophone)
        }
    }

    private func requestSettingsPermission(_ permission: PermissionGate.Permission, completion: @escaping (Bool) -> Void) {
        NSApplication.shared.keyWindow?.orderBack(nil)
        PermissionGate.shared.openSystemSettings(for: permission)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            self?.refresh()
            completion(PermissionGate.shared.status(for: permission))
        }
    }

    func startShortcutPractice() {
        shortcutDetected = false
        stopShortcutPractice()

        localShortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            self?.handleShortcutFlags(event.modifierFlags)
            return event
        }

        globalShortcutMonitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            self?.handleShortcutFlags(event.modifierFlags)
        }
    }

    func stopShortcutPractice() {
        if let localShortcutMonitor {
            NSEvent.removeMonitor(localShortcutMonitor)
            self.localShortcutMonitor = nil
        }

        if let globalShortcutMonitor {
            NSEvent.removeMonitor(globalShortcutMonitor)
            self.globalShortcutMonitor = nil
        }

        stopMicrophonePractice()
    }

    private func handleShortcutFlags(_ flags: NSEvent.ModifierFlags) {
        let activeFlags = flags.intersection(.deviceIndependentFlagsMask)
        guard activeFlags.contains(.control), activeFlags.contains(.function) else { return }

        DispatchQueue.main.async { [weak self] in
            self?.shortcutDetected = true
        }
    }

    func startMicrophonePractice() {
        microphoneLevel = 0
        microphoneHeard = false
        microphoneSilentTooLong = false
        microphoneInputName = VoiceCapture.currentInputDeviceName
        guard PermissionGate.shared.hasMicrophone else { return }

        VoiceCapture.shared.onLevel = { [weak self] level in
            DispatchQueue.main.async {
                self?.microphoneLevel = CGFloat(level)
                if level > 0.12 {
                    self?.microphoneHeard = true
                    self?.microphoneSilentTooLong = false
                    self?.micSilenceTimer?.invalidate()
                }
            }
        }
        VoiceCapture.shared.onSpectrum = { [weak self] bands in
            DispatchQueue.main.async {
                self?.microphoneBands = bands.map { CGFloat($0) }
            }
        }
        _ = VoiceCapture.shared.start()

        micSilenceTimer?.invalidate()
        micSilenceTimer = Timer.scheduledTimer(withTimeInterval: 6, repeats: false) { [weak self] _ in
            guard let self, !self.microphoneHeard else { return }
            self.microphoneSilentTooLong = true
        }
    }

    func stopMicrophonePractice() {
        VoiceCapture.shared.stop()
        VoiceCapture.shared.onLevel = nil
        VoiceCapture.shared.onSpectrum = nil
        microphoneLevel = 0
        microphoneBands = Array(repeating: 0, count: microphoneBands.count)
        micSilenceTimer?.invalidate()
        micSilenceTimer = nil
    }

    func openSoundInputSettings() {
        PermissionGate.shared.openSoundInputSettings()
    }

    func startFirstPromptPractice() {
        promptHeld = false
        promptSpoken = false
        microphoneBands = Array(repeating: 0, count: microphoneBands.count)

        promptLocalMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            self?.handlePromptFlags(event.modifierFlags)
            return event
        }

        promptGlobalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            self?.handlePromptFlags(event.modifierFlags)
        }

        guard PermissionGate.shared.hasMicrophone else { return }

        VoiceCapture.shared.onLevel = { [weak self] level in
            DispatchQueue.main.async {
                guard let self else { return }
                self.microphoneLevel = CGFloat(level)
                if self.promptHeld, level > 0.15 {
                    self.promptSpoken = true
                }
            }
        }
        VoiceCapture.shared.onSpectrum = { [weak self] bands in
            DispatchQueue.main.async {
                self?.microphoneBands = bands.map { CGFloat($0) }
            }
        }
        _ = VoiceCapture.shared.start()
    }

    func stopFirstPromptPractice() {
        if let promptLocalMonitor {
            NSEvent.removeMonitor(promptLocalMonitor)
            self.promptLocalMonitor = nil
        }

        if let promptGlobalMonitor {
            NSEvent.removeMonitor(promptGlobalMonitor)
            self.promptGlobalMonitor = nil
        }

        promptHeld = false

        let relay = VoiceTranscriptionRelay.shared
        relay.onTranscriptDelta = nil
        relay.onComplete = nil
        relay.onError = nil
        relay.disconnect()
        VoiceCapture.shared.onAudioChunk = nil

        stopMicrophonePractice()
    }

    private func handlePromptFlags(_ flags: NSEvent.ModifierFlags) {
        let activeFlags = flags.intersection(.deviceIndependentFlagsMask)
        let held = activeFlags.contains(.control) && activeFlags.contains(.function)

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            if held && !self.promptHeld {
                self.transcribedText = ""
                let sessionId = InvocationStateMachine.shared.nextTranscriptionSessionId()
                let relay = VoiceTranscriptionRelay.shared
                relay.onTranscriptDelta = { [weak self] delta in
                    self?.transcribedText += delta
                    self?.promptSpoken = true
                }
                relay.onComplete = { [weak self] final in
                    let trimmed = final.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        self?.transcribedText = trimmed
                        self?.promptSpoken = true
                    }
                }
                relay.onError = { error in
                    print("[Flyd] Practice transcription error: \\(error)")
                }
                relay.connect(sessionId: sessionId)
                VoiceCapture.shared.onAudioChunk = { chunk in
                    relay.sendAudioChunk(chunk)
                }
            } else if !held && self.promptHeld {
                VoiceTranscriptionRelay.shared.commitAudio()
                VoiceCapture.shared.onAudioChunk = nil
            }

            self.promptHeld = held
        }
    }
}
