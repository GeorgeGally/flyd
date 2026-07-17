export type TaskStatus = "awaiting_grant" | "ready" | "running" | "blocked" | "completed" | "failed" | "cancelled";
export type GrantStatus = "proposed" | "approved" | "expired" | "revoked" | "exhausted" | "completed";
export type WorkerStatus = "queued" | "starting" | "running" | "completed" | "failed" | "interrupted" | "cancelled";

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
  errorSummary: string | null;
  output: string | null;
  exitStatus: number | null;
  startedAt: string | null;
  endedAt: string | null;
  lastObservedAt: string | null;
  stopReason: string | null;
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
