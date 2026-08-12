export const WORK_CONTRACT_VERSION = 1;

export interface ContractHeaders {
  contractVersion: typeof WORK_CONTRACT_VERSION;
  interactionId: string;
  workSessionId: string;
  workSessionRevision: number;
  correlationId: string;
  timestamp: string;
}

export interface EvidenceItem<T> {
  value: T;
  source: 'foreground' | 'repository' | 'document' | 'conversation' | 'memory' | 'user_correction';
  confidence: 'high' | 'medium' | 'low';
  provenance: string;
  sourceTimestamp: string;
  isHypothesis: boolean;
}

export type WorkStage = 'exploration' | 'decision' | 'execution' | 'review' | 'completion';

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionDescription {
  bounds: DisplayBounds;
  displayId: string;
  contentSample: string;
  elementRef?: string;
}

export interface ArtifactIdentity {
  kind: 'document' | 'code' | 'presentation' | 'message' | 'design' | 'research' | 'unknown';
  title: string;
  path?: string;
  bundleId?: string;
  windowTitle?: string;
  contentDigest: string;
  selectedRegion?: RegionDescription;
  displayIdentity?: string;
}

export interface OpenLoop {
  id: string;
  description: string;
  status: 'unresolved' | 'blocked' | 'promised';
  since: string;
}

export interface EvidenceSummary {
  sources: string[];
  snapshotTimestamp: string;
  foregroundApp: string;
  repositoryRoot?: string;
  branch?: string;
  headDigest?: string;
  statusDigest?: string;
  isDirty?: boolean;
  documentPath?: string;
  activeWindowTitle: string;
  recentCommits?: string[];
  changedFiles?: string[];
  openDocuments?: string[];
}

export interface CurrentWork {
  project: EvidenceItem<string>;
  objective: EvidenceItem<string>;
  artifact: ArtifactIdentity;
  stage: EvidenceItem<WorkStage>;
  constraints: EvidenceItem<string[]>;
  openLoops: OpenLoop[];
  nextAction: EvidenceItem<{ description: string; readiness: 'ready' | 'blocked' | 'uncertain' }>;
  evidenceSummary: EvidenceSummary;
  uncertainty: { field: string; reason: string }[];
  confidence: { field: string; confidence: 'high' | 'medium' | 'low' }[];
}

export interface Diagnosis {
  primaryIssue: {
    category: 'quality' | 'correctness' | 'completeness' | 'clarity' | 'strategy' | 'risk' | 'structure' | 'audience';
    severity: 'critical' | 'improvement' | 'note';
    finding: string;
    causalExplanation: string;
    domain: 'design' | 'writing' | 'strategy' | 'code' | 'research';
    evidenceRefs: string[];
  };
  supportingObservations?: { finding: string; relevance: string }[];
  contraryEvidence?: string;
}

export interface InterventionOption {
  label: string;
  description: string;
  consequence?: string;
}

export interface Intervention {
  kind: 'insight' | 'critique' | 'reframe' | 'alternative' | 'comparison' | 'question' | 'recommendation' | 'proposedEdit' | 'actionPlan' | 'shellExecute' | 'fileOperation' | 'taskPlan';
  content: string;
  strongerAlternative?: string;
  visualGrounding?: {
    regionDescription: RegionDescription;
    placement: 'beside_selection' | 'below_element' | 'panel' | 'cursor';
    pointingTargets?: { ref: string; label: string }[];
  };
  options?: InterventionOption[];
  proposedAction?: ActionProposal;
}

export interface TargetFingerprint {
  elementRef?: string;
  selectedTextDigest?: string;
  fieldValueDigest?: string;
  repositoryRoot?: string;
  branch?: string;
  headDigest?: string;
  statusDigest?: string;
}

export interface ShellCommand {
  commandId: string;
  command: string;
  workingDirectory: string;
  explanation: string;
  isDestructive: boolean;
}

export interface ShellExecutionRequest {
  executionId: string;
  workSessionId: string;
  interactionId: string;
  commands: ShellCommand[];
  projectRoot: string;
}

export interface ShellExecutionOutput {
  commandId: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  startedAt: string;
  completedAt: string | null;
  status: 'pending' | 'running' | 'completed' | 'timeout' | 'error';
}

export interface ShellExecutionResult {
  executionId: string;
  status: 'pending' | 'approved' | 'rejected' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  commands: ShellExecutionOutput[];
  startTime: string;
  endTime: string | null;
}

export interface FileOperation {
  kind: 'read' | 'grep' | 'write';
  path: string;
  pattern?: string;
  content?: string;
  explanation: string;
}

export interface ActionProposal {
  actionId: string;
  kind: 'text_edit' | 'repository_action' | 'shell_execute' | 'file_read' | 'file_grep' | 'file_write' | 'task_plan';
  description: string;
  previewText?: string;
  shellCommands?: ShellCommand[];
  fileOperations?: FileOperation[];
  taskIntent?: string;
  targetFingerprint: TargetFingerprint;
  workSessionRevision: number;
  diagnosedIssueId: string;
  finishCondition: string;
  expiryMs: number;
  allowedOperation?: 'insert_text' | 'replace_text' | 'replace_selection' | 'repository_work' | 'shell_execute';
}

export interface ActionResult {
  verified: boolean;
  changedField?: string;
  changedFilePath?: string;
  diffDigest?: string;
  checksPerformed: string[];
  unresolvedIssues?: string[];
  recommendedNextAction?: string;
  partialOutput?: string;
}

export interface ActionGrant {
  grantId: string;
  actionId: string;
  interactionId: string;
  diagnosedIssueId: string;
  instruction: string;
  allowedOperation: 'insert_text' | 'replace_text' | 'replace_selection' | 'repository_work' | 'shell_execute';
  finishCondition: string;
  status: 'approved' | 'executing' | 'verified' | 'rejected' | 'invalidated' | 'partial' | 'failed' | 'cancelled';
  grantedAt: string;
  expiresAt: string;
  claimedAt?: string;
  workSessionRevision: number;
  targetFingerprint: TargetFingerprint;
  invalidationReason?: string;
  result?: ActionResult;
}

export interface VerificationChecks {
  reRead: { passed: boolean; expected: string; actual: string };
  diffCheck?: { passed: boolean; diff: string };
  testsRun?: { passed: boolean; results: string };
  constraintsHeld?: { passed: boolean; details: string };
}

export interface VerificationResult {
  actionGrantId: string;
  diagnosisResolved: boolean;
  actualChanges: string;
  verificationChecks: VerificationChecks;
  verdict: 'verified' | 'partial' | 'failed';
  evidence: string;
  timestamp: string;
}

export interface LearningCandidate {
  id: string;
  source: 'correction' | 'accepted_standard' | 'durable_decision' | 'productive_procedure' | 'verified_outcome';
  content: string;
  domain: string;
  outcomeRef: string;
  epistemicConfidence: 'high' | 'medium' | 'low';
  timestamp: string;
}

export interface WorkSessionCloseout {
  workSessionId: string;
  closedAt: string;
  project: string;
  artifact: { kind: string; title: string; path?: string };
  lastVerifiedState: string;
  unresolvedIssues: string[];
  nextAction: string;
  corrections: string[];
  acceptedStandards: string[];
  retainedLearnings: LearningCandidate[];
}

export type FounderEventType =
  | 'intervention_accepted' | 'intervention_rejected'
  | 'artifact_improved' | 'project_advanced'
  | 'issue_discovered' | 'correction_applied'
  | 'standard_accepted' | 'action_completed'
  | 'action_approved' | 'action_failed' | 'action_partial'
  | 'closeout_recorded' | 'learning_promoted'
  | 'skillify_proposed' | 'skillify_written'
  | 'context_accuracy_sample'
  | 'command_approved' | 'command_rejected'
  | 'command_completed' | 'command_failed';

export interface FounderJournalEntry {
  entryId: string;
  interactionId: string;
  workSessionId: string;
  timestamp: string;
  eventType: FounderEventType;
  details: {
    domain?: string;
    artifactKind?: string;
    artifactTitle?: string;
    issueCategory?: string;
    projectName?: string;
    correctProject?: boolean;
    userCorrection?: string;
    actionKind?: string;
    verified?: boolean;
    promoted?: boolean;
    repositoryOutcome?: {
      actionId: string;
      actionGrantId: string;
      diagnosedIssueId: string;
      approval: 'approved';
      beforeStateDigest?: string;
      afterStateDigest?: string;
      approvedSourceFingerprintDigest?: string;
      postRunSourceFingerprintDigest?: string;
      diffDigest?: string;
      changedFiles: string[];
      changedFileCount: number;
      checksPerformed: string[];
      verificationResults: { executable: string; exitStatus: number; outputDigest: string }[];
      verdict: 'approved' | 'verified' | 'partial' | 'failed';
      handoffAvailable: boolean;
    };
  };
}

export interface WorkInteractionRequest {
  contract_version: number;
  interaction_id: string;
  work_session_id: string;
  work_session_revision: number;
  invocation_id: string;
  intent: string;
  modality: 'text' | 'voice';
  current_evidence: {
    foreground_app: { bundle_id: string; name: string };
    active_window: { title: string };
    focused_element: { ref: string; role: string; value: string; selected_text: string };
    screenshot_base64?: string;
    display_identity?: string;
    focused_bounds?: DisplayBounds;
    semantic_neighbourhood?: Record<string, string>;
  };
}

export interface WorkInteractionResponse {
  contract_version: number;
  interaction_id: string;
  work_session_id: string;
  work_session_revision: number;
  current_work: CurrentWork;
  diagnosis: Diagnosis;
  intervention: Intervention;
  timing: { total_ms: number };
}

export function checkContractVersion(version: unknown): { ok: true } | { ok: false; error: string } {
  if (version !== WORK_CONTRACT_VERSION) {
    return { ok: false, error: `Incompatible contract version: expected ${WORK_CONTRACT_VERSION}, got ${version}` };
  }
  return { ok: true };
}

export function validateField<T>(value: T | undefined, label: string, errors: string[]): value is T {
  if (value === undefined || value === null) {
    errors.push(`Missing required field: ${label}`);
    return false;
  }
  return true;
}

export function validateString(value: unknown, label: string, errors: string[]): string {
  if (value === undefined || value === null) {
    errors.push(`Missing required field: ${label}`);
    return '';
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`Invalid ${label}: must be a non-empty string`);
    return '';
  }
  return value;
}

export function validateEvidenceItem<T>(
  item: unknown,
  label: string,
  errors: string[]
): item is EvidenceItem<T> {
  if (typeof item !== 'object' || item === null) {
    errors.push(`Missing evidence item: ${label}`);
    return false;
  }
  const e = item as Record<string, unknown>;
  if (e.value === undefined || e.value === null) {
    errors.push(`${label}.value is missing`);
    return false;
  }
  const validSources = ['foreground', 'repository', 'document', 'conversation', 'memory', 'user_correction'];
  if (!validSources.includes(e.source as string)) {
    errors.push(`${label}.source must be one of: ${validSources.join(', ')}`);
    return false;
  }
  return true;
}
