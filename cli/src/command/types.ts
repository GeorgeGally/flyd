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

export interface DomainRequest {
  id: string;
  domain: DomainId;
  originalMessage: string;
  intendedOutcome: string;
  doneWhen: string[];
  createdAt: string;
  source?: "chat" | "self-improvement" | "system";
  project?: { name?: string; root?: string };
  contextRefs?: string[];
  parentRequestId?: string;
  skill?: { name: string; body: string };
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
}
