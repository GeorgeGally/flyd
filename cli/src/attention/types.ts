export type SignalKind =
  | "commitment_stated"
  | "commitment_updated"
  | "deadline_approaching"
  | "delegation_changed"
  | "action_failed"
  | "action_completed"
  | "memory_changed"
  | "context_changed"
  | "user_feedback"
  | "explicit_reminder";

export type SignalSource =
  | "commitment_ledger"
  | "delegation_runner"
  | "manifest_resolution"
  | "memory_system"
  | "present_adapter"
  | "user_instruction"
  | "scene_feedback";

export interface EvidenceRef {
  sourceId: string;
  sourceKind: string;
  description: string;
  observedAt: string;
}

export interface EntityRef {
  id: string;
  kind: "person" | "project" | "task" | "application" | "commitment" | "delegation";
  label: string;
}

export interface Signal {
  id: string;
  kind: SignalKind;
  source: SignalSource;
  occurredAt: string;
  observedAt: string;
  subject: EntityRef;
  payload: unknown;
  evidence: EvidenceRef[];
  sensitivity: "normal" | "private" | "restricted";
  fingerprint: string;
  expiresAt?: string;
}

export type CommitmentKind =
  | "promise"
  | "request"
  | "deadline"
  | "payment"
  | "delegation"
  | "follow_up"
  | "decision_review";

export type CommitmentStatus =
  | "proposed"
  | "open"
  | "blocked"
  | "done"
  | "cancelled"
  | "expired";

export interface Commitment {
  id: string;
  kind: CommitmentKind;
  title: string;
  owner: EntityRef;
  beneficiary?: EntityRef;
  project?: EntityRef;
  createdAt: string;
  dueAt?: string;
  status: CommitmentStatus;
  consequence?: string;
  confidence: number;
  sourceEvidence: EvidenceRef[];
  lastVerifiedAt?: string;
  nextCheckAt?: string;
  completionEvidence?: EvidenceRef[];
}

export type CandidateType =
  | "deadline_due"
  | "delegation_blocked"
  | "delegation_completed"
  | "delegation_failed"
  | "commitment_suggested"
  | "commitment_updated"
  | "explicit_reminder"
  | "pattern_detected"
  | "context_shift"
  | "feedback_received";

export type CandidateStatus =
  | "pending"
  | "evaluating"
  | "deferred"
  | "surfaced"
  | "resolved"
  | "expired"
  | "suppressed";

export interface CandidateEvent {
  id: string;
  type: CandidateType;
  subject: EntityRef;
  commitmentId?: string;
  signalIds: string[];
  evidence: EvidenceRef[];
  firstSeenAt: string;
  lastSeenAt: string;
  status: CandidateStatus;
  novelty: number;
  urgency: number;
  consequence: number;
  confidence: number;
  reversibility: number;
  userRelevance: number;
  interruptionCost: number;
  evidenceQuality: number;
  suppressionKey: string;
  expiresAt?: string;
}

export type Disposition =
  | "ignore"
  | "remember"
  | "prepare"
  | "next_scene"
  | "notify_now"
  | "ask_permission"
  | "act";

export type ReasonCode =
  | "DUE_SOON"
  | "OVERDUE"
  | "EXPLICIT_REMINDER"
  | "BLOCKED_DELEGATION"
  | "DELEGATION_COMPLETED"
  | "DELEGATION_FAILED"
  | "COMMITMENT_SUGGESTED"
  | "LOW_CONFIDENCE"
  | "HIGH_CONSEQUENCE"
  | "REPEATED_DISMISSAL"
  | "USER_REQUESTED"
  | "ACTIVE_FOCUS"
  | "PROTECTED_PERIOD"
  | "DUPLICATE"
  | "EXPIRED"
  | "BELOW_CONFIDENCE_THRESHOLD"
  | "MISSING_PROVENANCE"
  | "RESTRICTED_SENSITIVITY"
  | "PROACTIVITY_DISABLED"
  | "BUDGET_EXHAUSTED"
  | "IRREVERSIBLE_NO_AUTHORITY"
  | "REVERSIBLE_AND_AUTHORIZED"
  | "LOW_PRIORITY"
  | "EVIDENCE_STALE"
  | "CONTEXT_IRRELEVANT";

export interface ActionProposal {
  actionId: string;
  description: string;
  kind: string;
  target: EntityRef;
  consequences: string[];
  reversibility: "reversible" | "irreversible";
  requiresPermission: boolean;
  requiresConfirmation: boolean;
}

export interface AuthorityDecision {
  actionType: string;
  allowed: boolean;
  grantId?: string;
  scope: EntityRef[];
  conditions: PolicyCondition[];
  reason: string;
}

export interface PolicyCondition {
  field: string;
  operator: "equals" | "in" | "not_equals" | "less_than" | "greater_than";
  value: unknown;
}

export interface AttentionDecision {
  candidateId: string;
  disposition: Disposition;
  reasonCodes: ReasonCode[];
  evidence: EvidenceRef[];
  confidence: number;
  policyVersion: string;
  decidedAt: string;
  reconsiderAt?: string;
  proposedAction?: ActionProposal;
  authorityDecision?: AuthorityDecision;
}

export interface SceneClaim {
  id: string;
  candidateId: string;
  rank: number;
  headline: string;
  whyNow: string;
  evidence: EvidenceRef[];
  preparedArtifact?: ArtifactRef;
  proposedActions: ActionProposal[];
  expiresAt?: string;
}

export interface ArtifactRef {
  id: string;
  kind: string;
  description: string;
  location: string;
  preparedAt: string;
}

export type OutcomeKind =
  | "opened"
  | "dismissed"
  | "snoozed"
  | "acted"
  | "corrected"
  | "approved"
  | "rejected"
  | "action_succeeded"
  | "action_failed"
  | "expired_unseen";

export interface OutcomeEvent {
  id: string;
  decisionId: string;
  candidateId: string;
  kind: OutcomeKind;
  occurredAt: string;
  correctionText?: string;
  correctionKind?: "irrelevant" | "wrong_time" | "wrong_fact" | "never_this";
  resultSummary?: string;
  linkedMemoryId?: string;
  linkedCommitmentId?: string;
}

export interface AuthorityGrant {
  id: string;
  actionType: string;
  subjectScope: EntityRef[];
  conditions: PolicyCondition[];
  maxConsequence: "low" | "medium" | "high";
  expiresAt?: string;
  grantedFrom: EvidenceRef;
  revocable: true;
  createdAt: string;
  activatedAt?: string;
  lastUsedAt?: string;
}

export type InteractionMode = "idle" | "active" | "focused" | "live_session" | "unknown";
export type InterruptionBudget = "none" | "critical_only" | "normal";

export interface AttentionState {
  interactionMode: InteractionMode;
  foregroundContext?: EntityRef;
  protectedUntil?: string;
  interruptionBudget: InterruptionBudget;
  lastUserInteractionAt?: string;
}

export interface SuppressionRule {
  id: string;
  causeEventClass: string;
  suppressionKey: string;
  contextConstraint?: string;
  source: "user_dismissed" | "user_never" | "policy_compiled" | "automatic";
  createdAt: string;
  expiresAt?: string;
  dismissalCount: number;
}

export interface TimingPreference {
  id: string;
  eventClass: string;
  allowedWindow?: { startHour: number; endHour: number };
  allowedInteractionModes: InteractionMode[];
  source: "user_set" | "policy_compiled";
  createdAt: string;
}

export interface PolicyVersion {
  version: string;
  createdAt: string;
  changedBy: "user" | "compiler" | "automatic";
  changes: string[];
  config: PolicyConfig;
}

export interface PolicyConfig {
  globalProactivityEnabled: boolean;
  interruptionBudget: InterruptionBudget;
  dailyInterruptionLimit: number;
  notifyNowAllowlist: string[];
  protectedHours: { startHour: number; endHour: number };
  cooldownsMs: Record<string, number>;
  scoreWeights: Record<string, number>;
  scoreBandThresholds: Record<string, { min: number; max: number }>;
  confidenceThresholds: Record<string, number>;
}

export interface KillSwitch {
  global: boolean;
  sources: Set<string>;
  eventClasses: Set<string>;
}

export interface DispatchResult {
  decisionId: string;
  candidateId: string;
  dispatched: boolean;
  surfaceId?: string;
  error?: string;
}

export interface PreparedArtifact {
  candidateId: string;
  artifact: ArtifactRef;
  error?: string;
}

export interface EngineTickReport {
  tickAt: string;
  signalsReceived: number;
  candidatesCreated: number;
  candidatesDeduplicated: number;
  candidatesEvaluated: number;
  decisions: AttentionDecision[];
  dispatched: Record<string, DispatchResult>;
  prepared: PreparedArtifact[];
  attentionState: AttentionState;
  metrics: EngineMetrics;
}

export interface EngineMetrics {
  candidatesCreated: number;
  candidatesDeduplicated: number;
  surfacesGenerated: number;
  interruptionsDelivered: number;
  interruptionsBudgetRemaining: number;
  actionsAuthorized: number;
  actionsRejected: number;
  policyVersions: number;
  lastTickAt?: string;
}
