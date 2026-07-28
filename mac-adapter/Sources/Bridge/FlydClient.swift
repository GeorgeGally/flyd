import Foundation

final class FlydClient {
    static let shared = FlydClient()

    private let baseURL = "http://127.0.0.1:4815"
    private var credential: String {
        AdapterAuth.shared.credential()
    }

    struct ManifestPayload: Codable {
        let invocationId: String
        let environmentRevision: Int
        let environment: EnvironmentPayload
        let intent: String
        let modality: String
        let screenshot: String?
        let invocationFingerprint: FingerprintPayload

        enum CodingKeys: String, CodingKey {
            case invocationId = "invocation_id"
            case environmentRevision = "environment_revision"
            case environment
            case intent
            case modality
            case screenshot
            case invocationFingerprint = "invocation_fingerprint"
        }
    }

    struct EnvironmentPayload: Codable {
        let application: AppPayload
        let surface: SurfacePayload?
        let window: WindowPayload
        let focusedElement: ElementPayload
        let semanticNeighbourhood: NeighbourhoodPayload?
        let selection: String
        let sufficiency: String

        enum CodingKeys: String, CodingKey {
            case application
            case surface
            case window
            case focusedElement = "focused_element"
            case semanticNeighbourhood = "semantic_neighbourhood"
            case selection
            case sufficiency
        }
    }

    struct AppPayload: Codable {
        let bundleId: String
        let name: String

        enum CodingKeys: String, CodingKey {
            case bundleId = "bundle_id"
            case name
        }
    }

    struct SurfacePayload: Codable {
        let kind: String
        let host: String?
        let title: String?
    }

    struct WindowPayload: Codable {
        let title: String
        let ref: String
    }

    struct ElementPayload: Codable {
        let ref: String
        let role: String
        let description: String
        let value: String
        let placeholder: String
        let selectedText: String

        enum CodingKeys: String, CodingKey {
            case ref
            case role
            case description
            case value
            case placeholder
            case selectedText = "selected_text"
        }
    }

    struct NeighbourhoodPayload: Codable {
        let parentType: String?
        let context: [String: String]

        enum CodingKeys: String, CodingKey {
            case parentType = "parent_type"
            case context
        }
    }

    struct FingerprintPayload: Codable {
        let app: String
        let surface: String?
        let window: String
        let element: String
    }

    struct ResolutionResponse: Codable {
        let resolutionId: String
        let invocationId: String
        let environmentRevision: Int
        let mode: String
        let rationale: String
        let operations: [OperationPayload]
        let augmentations: [AugmentPayload]?
        let composeRationale: String?
        let composeUrl: String?
        let requiresConfirmation: Bool?
    }

    struct OperationPayload: Codable {
        let target: String
        let kind: String
        let text: String
    }

    struct AugmentPayload: Codable {
        let kind: String
        let content: String
        let placement: String
        let options: [String]?
        let temporalSpan: TemporalSpanPayload?
    }

    struct TemporalSpanPayload: Codable {
        let delayMs: Int
        let durationMs: Int
    }

    struct OutcomePayload: Codable {
        let resolutionId: String
        let invocationId: String
        let status: String
        let correction: String?
    }

    struct VoiceStatusResponse: Codable {
        let ok: Bool
        let message: String?
    }

    func sendManifest(
        invocationId: String,
        environmentRevision: Int,
        environment: EnvironmentState,
        intent: String,
        modality: String,
        screenshot: String? = nil,
        fingerprint: InvocationFingerprint
    ) async -> ResolutionResponse? {
        let payload = ManifestPayload(
            invocationId: invocationId,
            environmentRevision: environmentRevision,
            environment: buildEnvironmentPayload(from: environment),
            intent: intent,
            modality: modality,
            screenshot: screenshot,
            invocationFingerprint: FingerprintPayload(
                app: fingerprint.app,
                surface: fingerprint.surface,
                window: fingerprint.window,
                element: fingerprint.element
            )
        )

        return await post("/manifest", body: payload)
    }

    func sendOutcome(
        resolutionId: String,
        invocationId: String,
        status: String,
        correction: String?
    ) async {
        let payload = OutcomePayload(
            resolutionId: resolutionId,
            invocationId: invocationId,
            status: status,
            correction: correction
        )

        _ = await post("/manifest/outcome", body: payload) as ResolutionResponse?
    }

    func healthCheck() async -> Bool {
        guard let url = URL(string: "\(baseURL)/health") else { return false }

        var request = URLRequest(url: url)
        request.timeoutInterval = 2

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    func waitForHealth(timeoutSeconds: TimeInterval = 4) async -> Bool {
        let deadline = Date().addingTimeInterval(timeoutSeconds)

        while Date() < deadline {
            if await healthCheck() { return true }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }

        return await healthCheck()
    }

    func voiceStatus() async -> VoiceStatusResponse? {
        guard let url = URL(string: "\(baseURL)/voice/status") else { return nil }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 6

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(VoiceStatusResponse.self, from: data)
        } catch {
            appendCoreLog("FlydClient /voice/status: request failed — \(error)")
            return nil
        }
    }

    func speak(text: String) async -> Data? {
        guard let url = URL(string: "\(baseURL)/tts") else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30

        do {
            request.httpBody = try JSONEncoder().encode(["text": text])
        } catch {
            return nil
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                let errorBody = String(data: data, encoding: .utf8) ?? "<empty>"
                appendCoreLog("FlydClient /tts: server error — \(errorBody.prefix(300))")
                return nil
            }
            return data
        } catch {
            appendCoreLog("FlydClient /tts: request failed — \(error)")
            return nil
        }
    }

    private func post<T: Codable, R: Codable>(_ path: String, body: T) async -> R? {
        guard let url = URL(string: "\(baseURL)\(path)") else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 60

        do {
            let encoder = JSONEncoder()
            request.httpBody = try encoder.encode(body)
        } catch {
            print("[FlydClient] Failed to encode request: \(error)")
            return nil
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                appendCoreLog("FlydClient \(path): response was not HTTP")
                return nil
            }

            if httpResponse.statusCode == 200 {
                let decoder = JSONDecoder()
                do {
                    return try decoder.decode(R.self, from: data)
                } catch {
                    let body = String(data: data, encoding: .utf8) ?? "<binary>"
                    appendCoreLog("FlydClient \(path): decode failed: \(error) — body: \(body.prefix(500))")
                    return nil
                }
            }

            let errorBody = String(data: data, encoding: .utf8) ?? "<empty>"
            appendCoreLog("FlydClient \(path): server error (\(httpResponse.statusCode)): \(errorBody.prefix(500))")
            return nil
        } catch {
            appendCoreLog("FlydClient \(path): request failed — \(error)")
            return nil
        }
    }

    private func buildEnvironmentPayload(from state: EnvironmentState) -> EnvironmentPayload {
        return EnvironmentPayload(
            application: AppPayload(
                bundleId: state.application.bundleId,
                name: state.application.name
            ),
            surface: state.surface.map {
                SurfacePayload(kind: $0.kind, host: $0.host, title: $0.title)
            },
            window: WindowPayload(title: state.window.title, ref: state.window.ref),
            focusedElement: ElementPayload(
                ref: state.focusedElement.ref,
                role: state.focusedElement.role,
                description: state.focusedElement.description,
                value: state.focusedElement.value,
                placeholder: state.focusedElement.placeholder,
                selectedText: state.focusedElement.selectedText
            ),
            semanticNeighbourhood: state.semanticNeighbourhood.map {
                NeighbourhoodPayload(parentType: $0.parentType, context: $0.context)
            },
            selection: state.selection,
            sufficiency: state.sufficiency.rawValue
        )
    }
}
