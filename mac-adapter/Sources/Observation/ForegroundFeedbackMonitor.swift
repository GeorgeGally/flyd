import Foundation

final class ForegroundFeedbackMonitor {
    static let shared = ForegroundFeedbackMonitor()

    private var observers: [NSObjectProtocol] = []
    private var pendingSend: DispatchWorkItem?
    private var pendingCandidate: Candidate?
    private var lastSentFingerprint: String?
    private var started = false

    private struct Candidate {
        let context: ForegroundFeedbackCaptureContext
        let environment: EnvironmentState
        let text: String

        var fingerprint: String {
            "\(context.source.rawValue)|\(context.authorship.rawValue)|\(text.lowercased())"
        }
    }

    func start() {
        guard !started else { return }
        started = true
        let center = NotificationCenter.default
        for name in [
            Notification.Name.focusedElementValueDidChange,
            .focusedElementDidChange,
            .foregroundAppDidChange,
            .flydConfigDidChange,
        ] {
            observers.append(center.addObserver(
                forName: name,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.captureCandidate()
            })
        }
        captureCandidate()
    }

    func stop() {
        pendingSend?.cancel()
        pendingSend = nil
        pendingCandidate = nil
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
        observers.removeAll()
        started = false
    }

    private func captureCandidate() {
        let config = ConfigManager.shared.config
        guard config.foregroundFeedbackCapture,
              !config.incognito,
              config.retention != .private,
              FlydState.shared.mode == .present,
              let environment = AccessibilityInspector.shared.captureEnvironment(),
              !ConfigManager.shared.isBundleExcluded(environment.application.bundleId),
              let context = ForegroundFeedbackPolicy.captureContext(
                  bundleId: environment.application.bundleId,
                  applicationName: environment.application.name,
                  browserURL: environment.browserURL,
                  windowTitle: environment.window.title,
                  elementRole: environment.focusedElement.role
              ) else { return }

        let rawText = environment.focusedElement.value.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = context.authorship == .ambiguousTerminal
            ? String(rawText.suffix(4_000))
            : String(rawText.prefix(4_000))
        guard ForegroundFeedbackPolicy.isComplaint(text) else { return }

        let candidate = Candidate(context: context, environment: environment, text: text)
        guard candidate.fingerprint != lastSentFingerprint else { return }
        pendingCandidate = candidate
        pendingSend?.cancel()

        let work = DispatchWorkItem { [weak self] in
            guard let self, let candidate = self.pendingCandidate else { return }
            self.pendingCandidate = nil
            self.lastSentFingerprint = candidate.fingerprint
            Task {
                let result = await FlydClient.shared.sendForegroundFeedback(
                    context: candidate.context,
                    environment: candidate.environment,
                    text: candidate.text
                )
                if let result {
                    appendCoreLog("Foreground feedback \(result.observationId.prefix(8)): \(result.status)")
                }
            }
        }
        pendingSend = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: work)
    }
}
