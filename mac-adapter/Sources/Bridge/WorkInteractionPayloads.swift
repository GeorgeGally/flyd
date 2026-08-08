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

    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case interactionId = "interaction_id"
        case workSessionId = "work_session_id"
        case workSessionRevision = "work_session_revision"
        case invocationId = "invocation_id"
        case intent
        case modality
        case currentEvidence = "current_evidence"
    }
}

struct EvidencePayload: Codable {
    let foregroundApp: ForegroundAppPayload
    let activeWindow: ActiveWindowPayload
    let focusedElement: FocusedElementPayload
    let screenshotBase64: String?
    let displayIdentity: String?
    let focusedBounds: DisplayBoundsPayload?
    let semanticNeighbourhood: [String: String]?

    enum CodingKeys: String, CodingKey {
        case foregroundApp = "foreground_app"
        case activeWindow = "active_window"
        case focusedElement = "focused_element"
        case screenshotBase64 = "screenshot_base64"
        case displayIdentity = "display_identity"
        case focusedBounds = "focused_bounds"
        case semanticNeighbourhood = "semantic_neighbourhood"
    }
}

struct ForegroundAppPayload: Codable {
    let bundleId: String
    let name: String

    enum CodingKeys: String, CodingKey {
        case bundleId = "bundle_id"
        case name
    }
}

struct ActiveWindowPayload: Codable {
    let title: String
}

struct FocusedElementPayload: Codable {
    let ref: String
    let role: String
    let value: String
    let selectedText: String

    enum CodingKeys: String, CodingKey {
        case ref
        case role
        case value
        case selectedText = "selected_text"
    }
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

    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case interactionId = "interaction_id"
        case workSessionId = "work_session_id"
        case workSessionRevision = "work_session_revision"
        case currentWork = "current_work"
        case diagnosis
        case intervention
        case timing
    }
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

    enum CodingKeys: String, CodingKey {
        case project
        case objective
        case artifact
        case stage
        case constraints
        case openLoops = "open_loops"
        case nextAction = "next_action"
        case evidenceSummary = "evidence_summary"
        case uncertainty
    }
}

struct EvidenceItemPayload<T: Codable>: Codable {
    let value: T
    let source: String
    let confidence: String
    let provenance: String
    let sourceTimestamp: String
    let isHypothesis: Bool

    enum CodingKeys: String, CodingKey {
        case value
        case source
        case confidence
        case provenance
        case sourceTimestamp = "source_timestamp"
        case isHypothesis = "is_hypothesis"
    }
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

    enum CodingKeys: String, CodingKey {
        case kind
        case title
        case path
        case bundleId = "bundle_id"
        case windowTitle = "window_title"
        case contentDigest = "content_digest"
        case selectedRegion = "selected_region"
        case displayIdentity = "display_identity"
    }
}

struct RegionDescriptionPayload: Codable {
    let bounds: DisplayBoundsPayload
    let displayId: String
    let contentSample: String
    let elementRef: String?

    enum CodingKeys: String, CodingKey {
        case bounds
        case displayId = "display_id"
        case contentSample = "content_sample"
        case elementRef = "element_ref"
    }
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

    enum CodingKeys: String, CodingKey {
        case sources
        case snapshotTimestamp = "snapshot_timestamp"
        case foregroundApp = "foreground_app"
        case repositoryRoot = "repository_root"
        case branch
        case headDigest = "head_digest"
        case documentPath = "document_path"
        case activeWindowTitle = "active_window_title"
    }
}

struct UncertaintyItemPayload: Codable {
    let field: String
    let reason: String
}

struct DiagnosisPayload: Codable {
    let primaryIssue: PrimaryIssuePayload
    let supportingObservations: [SupportingObservationPayload]?
    let contraryEvidence: String?

    enum CodingKeys: String, CodingKey {
        case primaryIssue = "primary_issue"
        case supportingObservations = "supporting_observations"
        case contraryEvidence = "contrary_evidence"
    }
}

struct PrimaryIssuePayload: Codable {
    let category: String
    let severity: String
    let finding: String
    let causalExplanation: String
    let domain: String
    let evidenceRefs: [String]

    enum CodingKeys: String, CodingKey {
        case category
        case severity
        case finding
        case causalExplanation = "causal_explanation"
        case domain
        case evidenceRefs = "evidence_refs"
    }
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

    enum CodingKeys: String, CodingKey {
        case kind
        case content
        case strongerAlternative = "stronger_alternative"
        case visualGrounding = "visual_grounding"
        case options
        case proposedAction = "proposed_action"
    }
}

struct VisualGroundingPayload: Codable {
    let regionDescription: RegionDescriptionPayload
    let placement: String
    let pointingTargets: [PointingTargetPayload]?

    enum CodingKeys: String, CodingKey {
        case regionDescription = "region_description"
        case placement
        case pointingTargets = "pointing_targets"
    }
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

    enum CodingKeys: String, CodingKey {
        case actionId = "action_id"
        case kind
        case description
        case previewText = "preview_text"
        case targetFingerprint = "target_fingerprint"
        case workSessionRevision = "work_session_revision"
        case diagnosedIssueId = "diagnosed_issue_id"
        case finishCondition = "finish_condition"
        case expiryMs = "expiry_ms"
        case allowedOperation = "allowed_operation"
        case shellCommands = "shell_commands"
    }
}

struct ShellCommandPayload: Codable {
    let command: String
    let workingDirectory: String?
    let explanation: String
    let isDestructive: Bool?

    enum CodingKeys: String, CodingKey {
        case command
        case workingDirectory = "working_directory"
        case explanation
        case isDestructive = "is_destructive"
    }
}

struct ShellExecutionRequestPayload: Codable {
    let executionId: String
    let workSessionId: String
    let interactionId: String
    let commands: [ShellCommandPayload]
    let projectRoot: String

    enum CodingKeys: String, CodingKey {
        case executionId = "execution_id"
        case workSessionId = "work_session_id"
        case interactionId = "interaction_id"
        case commands
        case projectRoot = "project_root"
    }
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

    enum CodingKeys: String, CodingKey {
        case commandId = "command_id"
        case stdout
        case stderr
        case exitCode = "exit_code"
        case timedOut = "timed_out"
        case startedAt = "started_at"
        case completedAt = "completed_at"
        case status
    }
}

struct ShellExecutionResultPayload: Codable {
    let executionId: String
    let status: String
    let commands: [ShellExecutionOutputPayload]
    let startTime: String
    let endTime: String?

    enum CodingKeys: String, CodingKey {
        case executionId = "execution_id"
        case status
        case commands
        case startTime = "start_time"
        case endTime = "end_time"
    }
}

struct TargetFingerprintPayload: Codable {
    let elementRef: String?
    let selectedTextDigest: String?
    let fieldValueDigest: String?
    let repositoryRoot: String?
    let branch: String?
    let headDigest: String?
    let statusDigest: String?

    enum CodingKeys: String, CodingKey {
        case elementRef = "element_ref"
        case selectedTextDigest = "selected_text_digest"
        case fieldValueDigest = "field_value_digest"
        case repositoryRoot = "repository_root"
        case branch
        case headDigest = "head_digest"
        case statusDigest = "status_digest"
    }
}

struct TimingPayload: Codable {
    let totalMs: Int

    enum CodingKeys: String, CodingKey {
        case totalMs = "total_ms"
    }
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

    enum CodingKeys: String, CodingKey {
        case grantId = "grant_id"
        case actionId = "action_id"
        case status
        case grantedAt = "granted_at"
        case workSessionRevision = "work_session_revision"
        case targetFingerprint = "target_fingerprint"
        case invalidationReason = "invalidation_reason"
        case result
    }
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

    enum CodingKeys: String, CodingKey {
        case verified
        case changedField = "changed_field"
        case changedFilePath = "changed_file_path"
        case diffDigest = "diff_digest"
        case checksPerformed = "checks_performed"
        case unresolvedIssues = "unresolved_issues"
        case recommendedNextAction = "recommended_next_action"
        case partialOutput = "partial_output"
    }
}

struct VerificationResultPayload: Codable {
    let actionGrantId: String
    let diagnosisResolved: Bool
    let actualChanges: String
    let verificationChecks: VerificationChecksPayload
    let verdict: String
    let evidence: String
    let timestamp: String

    enum CodingKeys: String, CodingKey {
        case actionGrantId = "action_grant_id"
        case diagnosisResolved = "diagnosis_resolved"
        case actualChanges = "actual_changes"
        case verificationChecks = "verification_checks"
        case verdict
        case evidence
        case timestamp
    }
}

struct VerificationChecksPayload: Codable {
    let reRead: ReReadCheckPayload
    let diffCheck: DiffCheckPayload?
    let testsRun: TestsRunPayload?
    let constraintsHeld: ConstraintsHeldPayload?

    enum CodingKeys: String, CodingKey {
        case reRead = "re_read"
        case diffCheck = "diff_check"
        case testsRun = "tests_run"
        case constraintsHeld = "constraints_held"
    }
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
