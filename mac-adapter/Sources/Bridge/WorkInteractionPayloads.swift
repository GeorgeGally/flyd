import Foundation

struct WorkInteractionRequestPayload: Codable {
    let contractVersion: Int
    let interactionId: String
    let workSessionId: String
    let workSessionRevision: Int
    let invocationId: String
    let intent: String
    let modality: String
    let currentEvidence: EvidencePayload
}

struct EvidencePayload: Codable {
    let foregroundApp: ForegroundAppPayload
    let activeWindow: ActiveWindowPayload
    let focusedElement: FocusedElementPayload
    let screenshotBase64: String?
    let displayIdentity: String?
    let focusedBounds: DisplayBoundsPayload?
    let semanticNeighbourhood: [String: String]?
}

struct ForegroundAppPayload: Codable {
    let bundleId: String
    let name: String
}

struct ActiveWindowPayload: Codable {
    let title: String
}

struct FocusedElementPayload: Codable {
    let ref: String
    let role: String
    let value: String
    let selectedText: String
}

struct DisplayBoundsPayload: Codable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

struct WorkInteractionResponsePayload: Codable {
    let contractVersion: Int
    let interactionId: String
    let workSessionId: String
    let workSessionRevision: Int
    let currentWork: CurrentWorkPayload
    let diagnosis: DiagnosisPayload
    let intervention: InterventionPayload
    let timing: TimingPayload
}

struct CurrentWorkPayload: Codable {
    let project: EvidenceItemPayload<String>
    let objective: EvidenceItemPayload<String>
    let artifact: ArtifactIdentityPayload
    let stage: EvidenceItemPayload<String>
    let constraints: EvidenceItemPayload<[String]>
    let openLoops: [OpenLoopPayload]
    let nextAction: EvidenceItemPayload<NextActionPayload>
    let evidenceSummary: EvidenceSummaryPayload
    let uncertainty: [UncertaintyItemPayload]
}

struct EvidenceItemPayload<T: Codable>: Codable {
    let value: T
    let source: String
    let confidence: String
    let provenance: String
    let sourceTimestamp: String
    let isHypothesis: Bool
}

struct NextActionPayload: Codable {
    let description: String
    let readiness: String
}

struct ArtifactIdentityPayload: Codable {
    let kind: String
    let title: String
    let path: String?
    let bundleId: String?
    let windowTitle: String?
    let contentDigest: String
    let selectedRegion: RegionDescriptionPayload?
    let displayIdentity: String?
}

struct RegionDescriptionPayload: Codable {
    let bounds: DisplayBoundsPayload
    let displayId: String
    let contentSample: String
    let elementRef: String?
}

struct OpenLoopPayload: Codable {
    let id: String
    let description: String
    let status: String
    let since: String
}

struct EvidenceSummaryPayload: Codable {
    let sources: [String]
    let snapshotTimestamp: String
    let foregroundApp: String
    let repositoryRoot: String?
    let branch: String?
    let headDigest: String?
    let documentPath: String?
    let activeWindowTitle: String
}

struct UncertaintyItemPayload: Codable {
    let field: String
    let reason: String
}

struct DiagnosisPayload: Codable {
    let primaryIssue: PrimaryIssuePayload
    let supportingObservations: [SupportingObservationPayload]?
    let contraryEvidence: String?
}

struct PrimaryIssuePayload: Codable {
    let category: String
    let severity: String
    let finding: String
    let causalExplanation: String
    let domain: String
    let evidenceRefs: [String]
}

struct SupportingObservationPayload: Codable {
    let finding: String
    let relevance: String
}

struct InterventionPayload: Codable {
    let kind: String
    let content: String
    let strongerAlternative: String?
    let visualGrounding: VisualGroundingPayload?
    let options: [InterventionOptionPayload]?
    let proposedAction: ActionProposalPayload?
}

struct VisualGroundingPayload: Codable {
    let regionDescription: RegionDescriptionPayload
    let placement: String
    let pointingTargets: [PointingTargetPayload]?
}

struct PointingTargetPayload: Codable {
    let ref: String
    let label: String
}

struct InterventionOptionPayload: Codable {
    let label: String
    let description: String
    let consequence: String?
}

struct ActionProposalPayload: Codable {
    let actionId: String
    let kind: String
    let description: String
    let previewText: String?
    let targetFingerprint: TargetFingerprintPayload
    let workSessionRevision: Int
    let diagnosedIssueId: String
    let finishCondition: String
    let expiryMs: Int
    let allowedOperation: String?
    let shellCommands: [ShellCommandPayload]?
}

struct ShellCommandPayload: Codable {
    let command: String
    let workingDirectory: String?
    let explanation: String
    let isDestructive: Bool?
}

struct ShellExecutionRequestPayload: Codable {
    let executionId: String
    let workSessionId: String
    let interactionId: String
    let commands: [ShellCommandPayload]
    let projectRoot: String
}

struct ShellExecutionOutputPayload: Codable {
    let commandId: String
    let stdout: String
    let stderr: String
    let exitCode: Int?
    let timedOut: Bool
    let startedAt: String
    let completedAt: String?
    let status: String
}

struct ShellExecutionResultPayload: Codable {
    let executionId: String
    let status: String
    let commands: [ShellExecutionOutputPayload]
    let startTime: String
    let endTime: String?
}

struct TargetFingerprintPayload: Codable {
    let elementRef: String?
    let selectedTextDigest: String?
    let fieldValueDigest: String?
    let repositoryRoot: String?
    let branch: String?
    let headDigest: String?
    let statusDigest: String?
}

struct TimingPayload: Codable {
    let totalMs: Int
}

struct ActionGrantPayload: Codable {
    let grantId: String
    let actionId: String
    let status: String
    let grantedAt: String
    let workSessionRevision: Int
    let targetFingerprint: TargetFingerprintPayload
    let invalidationReason: String?
    let result: ActionResultPayload?
}

struct ActionResultPayload: Codable {
    let verified: Bool
    let changedField: String?
    let changedFilePath: String?
    let diffDigest: String?
    let checksPerformed: [String]
    let unresolvedIssues: [String]?
    let recommendedNextAction: String?
    let partialOutput: String?
}

struct VerificationResultPayload: Codable {
    let actionGrantId: String
    let diagnosisResolved: Bool
    let actualChanges: String
    let verificationChecks: VerificationChecksPayload
    let verdict: String
    let evidence: String
    let timestamp: String
}

struct VerificationChecksPayload: Codable {
    let reRead: ReReadCheckPayload
    let diffCheck: DiffCheckPayload?
    let testsRun: TestsRunPayload?
    let constraintsHeld: ConstraintsHeldPayload?
}

struct ReReadCheckPayload: Codable {
    let passed: Bool
    let expected: String
    let actual: String
}

struct DiffCheckPayload: Codable {
    let passed: Bool
    let diff: String
}

struct TestsRunPayload: Codable {
    let passed: Bool
    let results: String
}

struct ConstraintsHeldPayload: Codable {
    let passed: Bool
    let details: String
}

struct TaskPlanResponsePayload: Codable {
    let planId: String
    let intent: String
    let steps: [TaskStepPayload]
    let status: String

    enum CodingKeys: String, CodingKey {
        case planId = "planId"
        case intent
        case steps
        case status
    }
}

struct TaskStepPayload: Codable {
    let stepId: String
    let kind: String
    let description: String
    let params: [String: RawJSONValue]
    let status: String

    enum CodingKeys: String, CodingKey {
        case stepId = "stepId"
        case kind, description, params, status
    }
}

enum RawJSONValue: Codable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null
    case array([RawJSONValue])
    case object([String: RawJSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let str = try? container.decode(String.self) { self = .string(str) }
        else if let int = try? container.decode(Int.self) { self = .int(int) }
        else if let double = try? container.decode(Double.self) { self = .double(double) }
        else if let bool = try? container.decode(Bool.self) { self = .bool(bool) }
        else if container.decodeNil() { self = .null }
        else if let arr = try? container.decode([RawJSONValue].self) { self = .array(arr) }
        else if let obj = try? container.decode([String: RawJSONValue].self) { self = .object(obj) }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value") }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .null: try container.encodeNil()
        case .array(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        }
    }
}
