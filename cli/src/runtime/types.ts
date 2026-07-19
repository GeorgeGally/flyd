export type TaskStatus = "awaiting_grant" | "ready" | "running" | "blocked" | "completed" | "failed" | "cancelled";
export type GrantStatus = "proposed" | "approved" | "expired" | "revoked" | "exhausted" | "completed";
export type WorkerStatus =
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "stopped"
  | "replaced";

export interface RepositorySnapshot {
  root: string;
  name: string;
  remote: string | null;
  branch: string;
  head: string;
  dirty: boolean;
  statusLines: string[];
  statusDigest: string;
}

export interface MemoryMatchSummary {
  id: string;
  path: string;
  excerpt: string;
  stale: boolean;
}

export interface MemoryEvidence {
  verdict: "sufficient" | "partial" | "insufficient" | "conflicting";
  matches: MemoryMatchSummary[];
}

export interface AgentTask {
  id: string;
  taskKey: string;
  projectId: string;
  projectName: string;
  projectRoot: string;
  status: TaskStatus;
  intendedOutcome: string;
  successCriteria: string[];
  verificationCriteria: string[];
  plan: Record<string, unknown>;
  contextSnapshot: Record<string, unknown>;
  repositorySnapshot: Record<string, unknown>;
  recommendedNextAction: string | null;
  outcomeSummary: string | null;
  verificationResult: Record<string, unknown>;
  revision: number;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export type AssignmentStatus = "pending" | "running" | "verified" | "blocked" | "integrated" | "failed" | "cancelled";

export interface TaskAssignment {
  id: string;
  assignmentKey: string;
  agentTaskId: string;
  status: AssignmentStatus;
  title: string;
  instructions: string;
  successCriteria: string[];
  capabilityRequirements: import("./worker-adapter.js").WorkerCapability[];
  dependencyKeys: string[];
  declaredFileScope: string[];
  excludedAdapters: string[];
  worktreePath: string | null;
  branchName: string | null;
  baseHead: string | null;
  verificationResult: Record<string, unknown>;
  integrationResult: Record<string, unknown>;
  revision: number;
}

export interface TaskGrant {
  id: string;
  grantKey: string;
  agentTaskId: string;
  status: GrantStatus;
  scopeDigest: string;
  repositoryRoots: string[];
  worktreePaths: string[];
  workerAdapters: string[];
  fileOperations: string[];
  commandClasses: string[];
  verificationCommands: string[];
  renewalRequiredActions: string[];
  maxConcurrency: number;
  budget: Record<string, unknown>;
  providerIdentity: string;
  approvedAt: string | null;
  expiresAt: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
}

export interface WorkerSession {
  id: string;
  workerKey: string;
  agentTaskId: string;
  taskGrantId: string;
  taskAssignmentId: string;
  status: WorkerStatus;
  adapter: string;
  capabilities: import("./worker-adapter.js").WorkerCapability[];
  executablePath: string | null;
  executableVersion: string | null;
  workingDirectory: string;
  externalSessionId: string | null;
  processId: number | null;
  processIdentity: string | null;
  errorSummary: string | null;
  output: string | null;
  exitStatus: number | null;
  startedAt: string | null;
  endedAt: string | null;
  lastObservedAt: string | null;
  stopReason: string | null;
  assignmentRevision?: number;
  pendingControl?: WorkerCommandKind | null;
}

export type WorkerCommandKind = "stop" | "retry" | "redirect" | "replace";
export type WorkerCommandStatus = "queued" | "dispatched" | "completed" | "failed" | "cancelled";

export interface WorkerCommand {
  id: string;
  commandKey: string;
  agentTaskId: string;
  workerSessionId: string;
  kind: WorkerCommandKind;
  status: WorkerCommandStatus;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  dispatchedAt: string | null;
  completedAt: string | null;
  errorSummary: string | null;
}

export type TaskArtifactKind = "diff" | "test" | "log" | "code" | "image" | "document";
export type TaskArtifactVerificationStatus = "pending" | "verified" | "rejected";

export interface TaskArtifact {
  id: string;
  artifactKey: string;
  agentTaskId: string;
  taskAssignmentId: string | null;
  workerSessionId: string | null;
  kind: TaskArtifactKind;
  title: string;
  mediaType: string;
  byteSize: number;
  sha256Digest: string;
  verificationStatus: TaskArtifactVerificationStatus;
  sourceRevision: number;
  content: string | null;
  relativePath: string | null;
  repositoryHead: string | null;
  provenance: Record<string, unknown>;
  createdAt: string;
}

export interface TaskArtifactDraft {
  kind: TaskArtifactKind;
  title: string;
  mediaType: string;
  byteSize: number;
  sha256Digest: string;
  verificationStatus: TaskArtifactVerificationStatus;
  content?: string | null;
  relativePath?: string | null;
  repositoryHead?: string | null;
  provenance: Record<string, unknown>;
}

export interface TaskCorrection {
  id: string;
  correctionKey: string;
  agentTaskId: string;
  supersedesTaskCorrectionId: string | null;
  originalClaim: string | null;
  correctedValue: string;
  taskRevision: number;
  surfaceRevision: number | null;
  authority: "user";
  provenance: Record<string, unknown>;
  createdAt: string;
}

export interface Orientation {
  kind: "new" | "resume" | "resume_changed" | "resume_interrupted";
  headline: string;
  detail: string;
  nextAction: string;
  evidenceRefs: string[];
}

export interface ContextPackage {
  markdown: string;
  evidenceRefs: string[];
}

export interface RuntimeMetrics {
  windowStartedAt: string;
  tasks: number;
  completedTasks: number;
  sessions: number;
  resumedSessions: number;
  resumedWithoutRestatement: number;
  acceptedInterpretations: number;
  correctedInterpretations: number;
  replacedInterpretations: number;
  manualContextRestatements: number;
  toolEscapes: number;
  routedAssignments: number;
  codexAssignments: number;
  openCodeAssignments: number;
  acceptedInterventions: number;
  stopControls: number;
  retryControls: number;
  redirectControls: number;
  replaceControls: number;
  integrationConflicts: number;
  permissionRenewals: number;
  verifiedIntegrations: number;
  manualContextTransfers: number;
}

export interface ArchiveRuntimeEvent {
  id: string;
  eventKey: string;
  eventType: string;
  taskKey: string;
  taskRevision: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}
