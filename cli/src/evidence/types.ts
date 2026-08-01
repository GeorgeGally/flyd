export const BUILTIN_CAPABILITIES = [
  "web",
  "github",
  "x",
  "reddit",
  "youtube",
  "rss",
  "hackernews",
  "polymarket",
  "arxiv",
  "linkedin",
] as const;

export type BuiltinCapability = (typeof BUILTIN_CAPABILITIES)[number];
export type CapabilityName = BuiltinCapability | (string & {});
export type CapabilityOperation = "search" | "read";
export type CapabilityStatus = "ready" | "degraded" | "auth_required" | "unavailable" | "disabled";

export type EvidenceKind =
  | "reference"
  | "first_party_statement"
  | "discussion"
  | "social"
  | "code"
  | "release"
  | "video"
  | "market"
  | "news"
  | "job_signal"
  | "research";

export type EvidenceSignal =
  | "reference"
  | "first_party"
  | "discussion"
  | "social"
  | "code"
  | "video"
  | "market"
  | "news"
  | "jobs"
  | "research";

export interface CapabilityProbe {
  status: CapabilityStatus;
  reason?: string;
  fix?: string;
}

export interface CapabilityHealth extends CapabilityProbe {
  capability: CapabilityName;
  activeBackend?: string;
  checkedAt: string;
}

export interface EvidenceProvenance {
  capability: CapabilityName;
  backend: string;
  queryLabel: string;
  nativeRank: number;
  sourceItemId: string;
  locator?: string;
}

export interface EvidenceItem {
  id: string;
  capability: CapabilityName;
  backend: string;
  kind: EvidenceKind;
  title?: string;
  content: string;
  locator?: string;
  sourceItemId: string;
  retrievedAt: string;
  publishedAt?: string;
  author?: string;
  queryLabel: string;
  nativeRank: number;
  localRelevance: number;
  freshness: number;
  sourceQuality: number;
  engagement?: number;
  metadata?: Record<string, unknown>;
  provenance: EvidenceProvenance[];
}

export interface EvidenceSearchRequest {
  query: string;
  queryLabel: string;
  limit: number;
  from?: string;
  to?: string;
}

export interface EvidenceReadRequest {
  locator: string;
}

export interface CapabilityAdapter {
  id: string;
  capability: CapabilityName;
  priority: number;
  operations: readonly CapabilityOperation[];
  signals: readonly EvidenceSignal[];
  probe(): Promise<CapabilityProbe>;
  search?(request: EvidenceSearchRequest): Promise<EvidenceItem[]>;
  read?(request: EvidenceReadRequest): Promise<EvidenceItem[]>;
}

export type ResearchIntent =
  | "factual"
  | "opinion"
  | "how_to"
  | "comparison"
  | "breaking_news"
  | "prediction"
  | "product";

export type ResearchDepth = "quick" | "default" | "deep";

export interface EvidenceSubquery {
  label: string;
  query: string;
  weight: number;
  capabilities: CapabilityName[];
}

export interface QueryPlan {
  query: string;
  intent: ResearchIntent;
  depth: ResearchDepth;
  sourceWeights: Record<string, number>;
  subqueries: EvidenceSubquery[];
  maxResults: number;
  maxPerStream: number;
}

export interface EvidenceStream {
  label: string;
  capability: CapabilityName;
  weight: number;
  items: EvidenceItem[];
}

export interface RankedEvidence extends EvidenceItem {
  rrfScore: number;
  capabilities: CapabilityName[];
}

export interface EvidenceGap {
  capability?: CapabilityName;
  code: "capability_unavailable" | "capability_auth_required" | "search_failed" | "insufficient_evidence";
  message: string;
}

export interface EvidenceCluster {
  id: string;
  label: string;
  summary: string;
  evidenceIds: string[];
  representativeEvidenceId: string;
  capabilities: CapabilityName[];
  authors: string[];
  supportScore: number;
  sourceDiversity: number;
}

export interface EvidenceConflict {
  left: string;
  right: string;
  topic: string;
  reason: string;
  confidence: number;
}

export interface EvidenceSurfaceFinding {
  heading: string;
  summary: string;
  evidenceIds: string[];
  confidence: "high" | "medium" | "low";
}

export interface EvidenceSurfaceSynthesis {
  title: string;
  executiveSummary: string;
  findings: EvidenceSurfaceFinding[];
  recommendation?: string;
  uncertainties: string[];
}

export interface EvidenceComposeSurface {
  kind: "evidence_dossier";
  version: "1.0";
  id: string;
  query: string;
  generatedAt: string;
  synthesis?: EvidenceSurfaceSynthesis;
  clusters: EvidenceCluster[];
  conflicts: EvidenceConflict[];
  evidence: RankedEvidence[];
  gaps: EvidenceGap[];
}

export interface EvidenceBundle {
  query: string;
  intent: ResearchIntent;
  generatedAt: string;
  plan: QueryPlan;
  evidence: RankedEvidence[];
  clusters?: EvidenceCluster[];
  conflicts: EvidenceConflict[];
  gaps: EvidenceGap[];
  capabilityHealth: CapabilityHealth[];
}
