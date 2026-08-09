import Foundation
import CoreGraphics

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
        let conversationId: String?
        let invocationFingerprint: FingerprintPayload
        let documentPath: String?
        let browserURL: String?
        let displayID: String?
        let screenshotBounds: BoundsPayload?
        let focusedElementBounds: BoundsPayload?
        let selectedRangeBounds: BoundsPayload?
        let editable: Bool?
        let workSessionId: String?
        let workSessionRevision: Int?

        enum CodingKeys: String, CodingKey {
            case invocationId = "invocation_id"
            case environmentRevision = "environment_revision"
            case environment
            case intent
            case modality
            case screenshot
            case conversationId = "conversation_id"
            case invocationFingerprint = "invocation_fingerprint"
            case documentPath = "document_path"
            case browserURL = "browser_url"
            case displayID = "display_id"
            case screenshotBounds = "screenshot_bounds"
            case focusedElementBounds = "focused_element_bounds"
            case selectedRangeBounds = "selected_range_bounds"
            case editable
            case workSessionId = "work_session_id"
            case workSessionRevision = "work_session_revision"
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
        let documentPath: String?
        let browserURL: String?
        let displayID: String?
        let focusedElementBounds: BoundsPayload?
        let selectedRangeBounds: BoundsPayload?
        let openDocuments: [String]?

        enum CodingKeys: String, CodingKey {
            case application
            case surface
            case window
            case focusedElement = "focused_element"
            case semanticNeighbourhood = "semantic_neighbourhood"
            case selection
            case sufficiency
            case documentPath = "document_path"
            case browserURL = "browser_url"
            case displayID = "display_id"
            case focusedElementBounds = "focused_element_bounds"
            case selectedRangeBounds = "selected_range_bounds"
            case openDocuments = "open_documents"
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

    struct BoundsPayload: Codable {
        let x: Int
        let y: Int
        let width: Int
        let height: Int
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
        let currentWork: CurrentWorkPayload?
        let diagnosis: DiagnosisPayload?
        let intervention: InterventionPayload?
        let taskPlan: TaskPlanResponsePayload?
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
        let commands: [ShellCommandPayload]?
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
        let verification: VerificationEvidencePayload?

        enum CodingKeys: String, CodingKey {
            case resolutionId = "resolution_id"
            case invocationId = "invocation_id"
            case status
            case correction
            case verification
        }
    }

    struct VerificationEvidencePayload: Codable {
        let preValueDigest: String?
        let postValue: String?
        let postValueDigest: String?
        let changed: Bool

        enum CodingKeys: String, CodingKey {
            case preValueDigest = "pre_value_digest"
            case postValue = "post_value"
            case postValueDigest = "post_value_digest"
            case changed
        }
    }

    struct VoiceStatusResponse: Codable {
        let ok: Bool
        let message: String?
    }

    struct AcknowledgementResponse: Codable {
        let acknowledged: Bool
    }

    struct ForegroundFeedbackPayload: Codable {
        let version: Int
        let capturedAt: String
        let source: String
        let authorship: String
        let application: AppPayload
        let windowTitle: String
        let browserURL: String?
        let text: String

        enum CodingKeys: String, CodingKey {
            case version
            case capturedAt = "captured_at"
            case source
            case authorship
            case application
            case windowTitle = "window_title"
            case browserURL = "browser_url"
            case text
        }
    }

    struct ForegroundFeedbackResponse: Codable {
        let observationId: String
        let status: String
        let reason: String?
        let turnReceiptId: String?
    }

    func sendManifest(
        invocationId: String,
        environmentRevision: Int,
        environment: EnvironmentState,
        intent: String,
        modality: String,
        screenshot: String? = nil,
        conversationId: String? = nil,
        fingerprint: InvocationFingerprint,
        documentPath: String? = nil,
        browserURL: String? = nil,
        displayID: String? = nil,
        screenshotBounds: CGRect? = nil,
        focusedElementBounds: CGRect? = nil,
        selectedRangeBounds: CGRect? = nil,
        editable: Bool? = nil,
        workSessionId: String? = nil,
        workSessionRevision: Int? = nil
    ) async -> ResolutionResponse? {
        let payload = ManifestPayload(
            invocationId: invocationId,
            environmentRevision: environmentRevision,
            environment: buildEnvironmentPayload(
                from: environment,
                focusedElementBounds: focusedElementBounds,
                selectedRangeBounds: selectedRangeBounds
            ),
            intent: intent,
            modality: modality,
            screenshot: screenshot,
            conversationId: conversationId,
            invocationFingerprint: FingerprintPayload(
                app: fingerprint.app,
                surface: fingerprint.surface,
                window: fingerprint.window,
                element: fingerprint.element
            ),
            documentPath: documentPath,
            browserURL: browserURL,
            displayID: displayID,
            screenshotBounds: screenshotBounds.map(toBoundsPayload),
            focusedElementBounds: focusedElementBounds.map(toBoundsPayload),
            selectedRangeBounds: selectedRangeBounds.map(toBoundsPayload),
            editable: editable,
            workSessionId: workSessionId,
            workSessionRevision: workSessionRevision
        )

        guard let response: ResolutionResponse = await post("/manifest", body: payload) else {
            return nil
        }
        return await normalizedComposeResponse(response)
    }

    func sendOutcome(
        resolutionId: String,
        invocationId: String,
        status: String,
        correction: String?,
        verification: VerificationEvidencePayload? = nil
    ) async {
        let payload = OutcomePayload(
            resolutionId: resolutionId,
            invocationId: invocationId,
            status: status,
            correction: correction,
            verification: verification
        )

        _ = await post("/manifest/outcome", body: payload) as AcknowledgementResponse?
    }

    func sendForegroundFeedback(
        context: ForegroundFeedbackCaptureContext,
        environment: EnvironmentState,
        text: String
    ) async -> ForegroundFeedbackResponse? {
        let payload = ForegroundFeedbackPayload(
            version: 1,
            capturedAt: ISO8601DateFormatter().string(from: environment.timestamp),
            source: context.source.rawValue,
            authorship: context.authorship.rawValue,
            application: AppPayload(
                bundleId: environment.application.bundleId,
                name: environment.application.name
            ),
            windowTitle: environment.window.title,
            browserURL: environment.browserURL,
            text: text
        )
        return await post("/foreground-feedback", body: payload)
    }

    func approveCommands(
        executionId: String,
        workSessionId: String,
        interactionId: String,
        commands: [ShellCommandPayload],
        projectRoot: String
    ) async -> ShellExecutionResultPayload? {
        let payload = ShellExecutionRequestPayload(
            executionId: executionId,
            workSessionId: workSessionId,
            interactionId: interactionId,
            commands: commands,
            projectRoot: projectRoot
        )
        return await post("/work-intelligence/command/execute", body: payload)
    }

    func pollCommandOutput(executionId: String) async -> ShellExecutionResultPayload? {
        guard let url = URL(string: "\(baseURL)/work-intelligence/command/status?executionId=\(executionId)") else {
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(ShellExecutionResultPayload.self, from: data)
        } catch {
            return nil
        }
    }

    func cancelCommandExecution(executionId: String) async -> Bool {
        guard let url = URL(string: "\(baseURL)/work-intelligence/command/cancel") else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10
        request.httpBody = try? JSONEncoder().encode(["execution_id": executionId])

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    func readFile(path: String, projectRoot: String, startLine: Int? = nil, endLine: Int? = nil) async -> FileReadResultPayload? {
        var body: [String: Any] = ["path": path, "projectRoot": projectRoot]
        if let start = startLine { body["startLine"] = start }
        if let end = endLine { body["endLine"] = end }

        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        return await postRaw("/work-intelligence/file/read", body: jsonData).flatMap { try? JSONDecoder().decode(FileReadResultPayload.self, from: $0) }
    }

    func grepCodebase(pattern: String, projectRoot: String, filePattern: String? = nil, maxResults: Int = 200) async -> FileGrepResultPayload? {
        var body: [String: Any] = ["pattern": pattern, "projectRoot": projectRoot, "maxResults": maxResults]
        if let fp = filePattern { body["filePattern"] = fp }

        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        return await postRaw("/work-intelligence/file/grep", body: jsonData).flatMap { try? JSONDecoder().decode(FileGrepResultPayload.self, from: $0) }
    }

    func writeFile(path: String, content: String, projectRoot: String, createDirectories: Bool = true) async -> FileWriteResultPayload? {
        let body: [String: Any] = ["path": path, "content": content, "projectRoot": projectRoot, "createDirectories": createDirectories]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        return await postRaw("/work-intelligence/file/write", body: jsonData).flatMap { try? JSONDecoder().decode(FileWriteResultPayload.self, from: $0) }
    }

    private func postRaw(_ path: String, body: Data) async -> Data? {
        guard let url = URL(string: "\(baseURL)\(path)") else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 60
        request.httpBody = body

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return data
        } catch {
            return nil
        }
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

    private func normalizedComposeResponse(_ response: ResolutionResponse) async -> ResolutionResponse {
        guard response.mode == "requires_compose" else { return response }

        let directAvailable: Bool
        if let directURL = ComposeTarget.directURL(resolutionId: response.resolutionId) {
            directAvailable = await urlResponds(directURL)
        } else {
            directAvailable = false
        }

        return ResolutionResponse(
            resolutionId: response.resolutionId,
            invocationId: response.invocationId,
            environmentRevision: response.environmentRevision,
            mode: response.mode,
            rationale: response.rationale,
            operations: response.operations,
            augmentations: response.augmentations,
            composeRationale: response.composeRationale,
            composeUrl: ComposeTarget.url(
                serverValue: response.composeUrl,
                resolutionId: response.resolutionId,
                directAvailable: directAvailable
            ),
            requiresConfirmation: response.requiresConfirmation,
            currentWork: response.currentWork,
            diagnosis: response.diagnosis,
            intervention: response.intervention,
            taskPlan: response.taskPlan
        )
    }

    private func urlResponds(_ url: URL) async -> Bool {
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 1.5

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else { return false }
            return (200..<400).contains(httpResponse.statusCode)
        } catch {
            return false
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

    private func toBoundsPayload(_ rect: CGRect) -> BoundsPayload {
        BoundsPayload(x: Int(rect.origin.x), y: Int(rect.origin.y), width: Int(rect.size.width), height: Int(rect.size.height))
    }

    private func buildEnvironmentPayload(
        from state: EnvironmentState,
        focusedElementBounds: CGRect? = nil,
        selectedRangeBounds: CGRect? = nil
    ) -> EnvironmentPayload {
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
            sufficiency: state.sufficiency.rawValue,
            documentPath: state.documentPath,
            browserURL: state.browserURL,
            displayID: state.displayID,
            focusedElementBounds: focusedElementBounds.map(toBoundsPayload),
            selectedRangeBounds: selectedRangeBounds.map(toBoundsPayload),
            openDocuments: state.openDocuments
        )
    }
}

struct FileReadResultPayload: Codable {
    let path: String
    let content: String
    let totalLines: Int
    let startLine: Int?
    let endLine: Int?
    let truncated: Bool

    enum CodingKeys: String, CodingKey {
        case path, content
        case totalLines = "totalLines"
        case startLine = "startLine"
        case endLine = "endLine"
        case truncated
    }
}

struct FileGrepMatchPayload: Codable {
    let file: String
    let line: Int
    let content: String
}

struct FileGrepResultPayload: Codable {
    let pattern: String
    let matches: [FileGrepMatchPayload]
    let totalMatches: Int
    let truncated: Bool

    enum CodingKeys: String, CodingKey {
        case pattern, matches
        case totalMatches = "totalMatches"
        case truncated
    }
}

struct FileWriteResultPayload: Codable {
    let path: String
    let created: Bool
    let bytesWritten: Int
    let linesWritten: Int

    enum CodingKeys: String, CodingKey {
        case path, created
        case bytesWritten = "bytesWritten"
        case linesWritten = "linesWritten"
    }
}
