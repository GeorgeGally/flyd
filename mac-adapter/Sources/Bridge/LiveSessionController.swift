import AppKit
import ApplicationServices
import Foundation

enum LiveSessionState: Equatable {
    case disconnected
    case connecting
    case active
    case disconnecting
    case failed
}

final class LiveSessionController {
    static let shared = LiveSessionController()

    private let bridge = LiveAudioBridge.shared
    private let voiceCapture = VoiceCapture.shared
    private let audioPlayer = StreamingAudioPlayer()
    private var sessionTask: Task<Void, Never>?
    private var sessionId: String = ""
    private var startedAt: Date?
    private var observedTargets: [String: ObservedTarget] = [:]

    var isActive: Bool { state != .disconnected && state != .failed }
    private(set) var state: LiveSessionState = .disconnected

    func handleToggle() {
        if isActive {
            stop()
        } else {
            start()
        }
    }

    private func start() {
        guard state == .disconnected || state == .failed else { return }
        sessionId = UUID().uuidString
        startedAt = Date()
        observedTargets = [:]

        FlydState.shared.transition(to: .live)
        AuditRecorder.shared.recordLiveSessionStart(sessionId: sessionId)

        state = .connecting
        bridge.onStateChange = { [weak self] bridgeState in
            DispatchQueue.main.async {
                switch bridgeState {
                case .active: self?.state = .active
                case .failed, .disconnected: self?.state = .failed
                case .connecting, .ready, .closing: break
                }
            }
        }
        bridge.onAudioReceived = { [weak self] data in
            self?.audioPlayer.schedulePCM(base64Encoded: data.base64EncodedString())
        }
        bridge.onTranscriptDelta = { _ in }
        bridge.onObservationRequest = { [weak self] json in
            self?.handleObservationRequest(json)
        }
        bridge.onResolutionResult = { [weak self] json in
            self?.handleResolutionResult(json)
        }
        bridge.onError = { msg in
            print("[Flyd] LIVE bridge error: \(msg)")
        }

        audioPlayer.start()
        voiceCapture.onAudioChunk = { [weak self] chunk in
            self?.bridge.sendAudioChunk(chunk)
        }
        _ = voiceCapture.start()
        bridge.connect()
    }

    func stop() {
        guard isActive else { return }

        state = .disconnecting
        sessionTask?.cancel()
        sessionTask = nil
        voiceCapture.stop()
        voiceCapture.onAudioChunk = nil
        bridge.onStateChange = nil
        bridge.onAudioReceived = nil
        bridge.onTranscriptDelta = nil
        bridge.onObservationRequest = nil
        bridge.onResolutionResult = nil
        bridge.onError = nil
        bridge.disconnect()
        audioPlayer.stop()
        observedTargets = [:]

        if let startedAt = startedAt {
            let duration = Date().timeIntervalSince(startedAt)
            AuditRecorder.shared.recordLiveSessionEnd(sessionId: sessionId, duration: duration)
        }

        state = .disconnected
        FlydState.shared.transition(to: .present)
    }

    private func handleObservationRequest(_ json: [String: Any]) {
        guard let requestId = json["request_id"] as? String else { return }

        let inspector = AccessibilityInspector.shared
        let monitor = ApplicationMonitor.shared
        let appInfo = monitor.foregroundApp

        let env = inspector.captureEnvironment()
            ?? EnvironmentState.fallback(application: appInfo, reason: "Capture failed")
        guard let element = inspector.capturedAXElement() else {
            bridge.sendRaw("{\"request_id\":\"\(requestId)\",\"type\":\"observation\",\"observation_id\":\"\",\"revision\":0}")
            return
        }
        let descriptor = TargetDescriptor.capture(from: inspector, app: monitor)
            ?? TargetDescriptor(
                applicationId: env.application.bundleId, processId: 0,
                windowIdentity: WindowIdentity(title: env.window.title, frame: nil, isMain: true),
                role: env.focusedElement.role, identifier: nil, description: nil, capturedAt: .now
            )
        let fingerprint = InvocationFingerprint(
            app: env.application.bundleId, surface: env.surface?.host,
            window: "win_01", element: env.focusedElement.ref, capturedAt: Date()
        )

        let observationId = UUID().uuidString
        let revision = FlydState.shared.revision + 1
        let target = ObservedTarget(
            observationId: observationId, revision: revision,
            element: element, descriptor: descriptor, fingerprint: fingerprint
        )
        observedTargets[observationId] = target

        let payload = target.serialized()
        guard let payloadData = try? JSONEncoder().encode(payload),
              let payloadStr = String(data: payloadData, encoding: .utf8) else { return }
        bridge.sendRaw("{\"request_id\":\"\(requestId)\",\"type\":\"observation\",\(payloadStr.dropFirst())")
    }

    private func handleResolutionResult(_ json: [String: Any]) {
        guard let observationId = json["observation_id"] as? String,
              let target = observedTargets[observationId],
              let resolutionDict = json["resolution"] as? [String: Any] else { return }
        observedTargets.removeValue(forKey: observationId)

        guard let resData = try? JSONSerialization.data(withJSONObject: resolutionDict),
              let resolution = try? JSONDecoder().decode(FlydClient.ResolutionResponse.self, from: resData) else { return }

        guard resolution.mode == "native" else { return }

        sessionTask?.cancel()
        sessionTask = Task {
            await executeLiveNative(resolution: resolution, target: target)
        }
    }

    private func executeLiveNative(
        resolution: FlydClient.ResolutionResponse,
        target: ObservedTarget
    ) async {
        let executor = NativeExecutor.shared
        let client = FlydClient.shared

        var reasons: [ConfirmationDecision.Reason] = []
        if resolution.requiresConfirmation == true {
            reasons.append(.executionConsequence)
        }
        for op in resolution.operations {
            if executor.requiresReplacementConfirmation(kind: op.kind, text: op.text) {
                reasons.append(.destructiveReplacement)
                break
            }
        }
        if !reasons.isEmpty {
            let confirmed = await requestLiveConfirmation(rationale: resolution.rationale, reasons: reasons)
            guard confirmed else {
                await client.sendOutcome(
                    resolutionId: resolution.resolutionId, invocationId: resolution.invocationId,
                    status: "rejected", correction: "LIVE confirmation denied"
                )
                return
            }
        }

        executor.registerObservedElement(ref: "el_01", element: target.element, descriptor: target.descriptor)

        let results = await executeNativeOperations(
            resolution: resolution, fingerprint: target.fingerprint, observedTarget: target
        )
        let successOps = results.filter(\.success)
        if !successOps.isEmpty {
            print("[Flyd] LIVE executed \(successOps.count)/\(results.count) operations")
        }
    }

    private func requestLiveConfirmation(
        rationale: String, reasons: [ConfirmationDecision.Reason]
    ) async -> Bool {
        let reasonText = reasons.map(\.displayName).joined(separator: ", ")
        return await withCheckedContinuation { continuation in
            Task { @MainActor in
                let alert = NSAlert()
                alert.messageText = "Flyd wants to modify content"
                alert.informativeText = "\(rationale)\n\nReasons: \(reasonText). Allow?"
                alert.alertStyle = .warning
                alert.addButton(withTitle: "Allow")
                alert.addButton(withTitle: "Cancel")
                continuation.resume(returning: alert.runModal() == .alertFirstButtonReturn)
            }
        }
    }
}
