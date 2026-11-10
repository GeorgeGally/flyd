export const DOMAIN_IDS = ["coding", "knowledge", "creative", "life"] as const;
export type DomainId = typeof DOMAIN_IDS[number];

export type DomainRunStatus =
  | "queued"
  | "accepted"
  | "working"
  | "needs_decision"
  | "completed"
  /** Legacy: a reply that missed the layered contract was once kept open as this; such runs are read again. */
  | "incomplete"
  | "failed"
  | "cancelled";

export type InformationLossRisk = "low" | "medium" | "high";

/** The calls a brief says come back to George, and those his known policy settles without him. */
export interface BriefDecisions {
  comesBack: string[];
  settledByPolicy: string[];
}

/** The brief's decisions as its team reads them. Pure. */
export function decisionsLines(decisions?: BriefDecisions): string[] {
  if (!decisions) return [];
  return [
    ...(decisions.comesBack.length ? [`Bring these calls back to George through Flyd: ${decisions.comesBack.join("; ")}`] : []),
    ...(decisions.settledByPolicy.length ? [`Settle these yourself by his known policy, without asking: ${decisions.settledByPolicy.join("; ")}`] : []),
  ];
}

export interface DomainRequest {
  id: string;
  domain: DomainId;
  originalMessage: string;
  intendedOutcome: string;
  doneWhen: string[];
  createdAt: string;
  /**
   * "view": George's own message from the conversation window's desk; the window itself shows its reply.
   * "flyd": Flyd's own note to the staff (a worker check-in, a call to close, a note about a task): never announced to
   * George, never chased as a handoff of its own, and never a candidate for his live corrections.
   */
  source?: "chat" | "self-improvement" | "system" | "view" | "flyd";
  /** The conversation-window session a "view" request was sent from. */
  session?: string;
  project?: { name?: string; root?: string };
  contextRefs?: string[];
  parentRequestId?: string;
  /** The Chief of Staff objective this run serves (command/cos/); its report is the objective's, never the run's own. */
  objectiveId?: string;
  /** The brief's decisions field: which calls come back to George, and which his known policy settles. */
  decisions?: BriefDecisions;
  skill?: { name: string; body: string };
  /** Started by unattended work: its specialist jobs never open an app George has closed. */
  background?: boolean;
}

export interface DomainRecommendation {
  action: string;
  reasoning?: string;
  confidence?: number;
}

export interface SpecialistOutput {
  specialist?: string;
  outcome: string;
  evidence?: string[];
  artifacts?: string[];
  raw?: string;
}

export interface DomainResult {
  /** Whether the domain boss honoured the layered machine handoff contract. */
  format: "structured" | "raw";
  brief: string;
  recommendation?: DomainRecommendation;
  detailedReport: string;
  decisionsMade: string[];
  unresolvedQuestions: string[];
  risks: string[];
  evidence: string[];
  artifacts: string[];
  specialistOutputs: SpecialistOutput[];
  raw: string[];
  informationLossRisk: InformationLossRisk;
}

export interface DomainTransport {
  kind: "firstmate" | "native";
  requestId: string;
  externalId?: string;
  replyCursor?: string;
}

export type DomainMessageKind = "correction" | "decision" | "priority_change" | "question" | "cancel";

export interface DomainMessage {
  id: string;
  kind: DomainMessageKind;
  body: string;
  /** Flyd's own note to the boss rather than George's wording; it carries his delegated authority for routine calls only. */
  from?: "flyd";
  at: string;
  deliveredAt?: string;
  externalId?: string;
}

export interface DomainSpecialistRun {
  role: string;
  jobId: string;
}

export interface DomainRun {
  id: string;
  request: DomainRequest;
  owner: string;
  status: DomainRunStatus;
  createdAt: string;
  updatedAt: string;
  transport: DomainTransport;
  phase?: string;
  specialists?: DomainSpecialistRun[];
  messages?: DomainMessage[];
  result?: DomainResult;
  failure?: string;
  /** Set while a FirstMate session launch is retried: how many tries and the earliest next one. */
  launchRetry?: { attempts: number; nextAt: string };
  /** Which layers of the handoff contract the latest reply missed (see validateDomainHandoff); the reply still counts. */
  incompleteReason?: string;
  /** When Flyd last asked the staff for a clear status; at most one such ask is open until a reply is read. */
  statusAskedAt?: string;
  notified?: boolean;
  /** The line George was actually sent for this run and the decision behind it; absent when it was settled quietly or held. */
  told?: { line: string; decisionId: string };
  /** Bumped by every write (command/store.ts `mutateDomainRun`); absent on runs written before it. */
  revision?: number;
}
