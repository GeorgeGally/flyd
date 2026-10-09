export const DOMAIN_IDS = ["coding", "knowledge", "creative", "life"] as const;
export type DomainId = typeof DOMAIN_IDS[number];

export type DomainRunStatus =
  | "queued"
  | "accepted"
  | "working"
  | "needs_decision"
  | "completed"
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
  result?: DomainResult;
  failure?: string;
  notified?: boolean;
}
