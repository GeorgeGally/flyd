export { CapabilityRegistry } from "./capability-registry.js";
export type { CapabilityInspection, ResolvedCapability } from "./capability-registry.js";
export { createDefaultEvidenceRegistry } from "./default-registry.js";
export type { DefaultEvidenceRegistryOptions } from "./default-registry.js";
export { buildEvidenceDoctorReport, formatEvidenceDoctorReport } from "./doctor.js";
export type { EvidenceCapabilityDiagnostic, EvidenceDoctorReport } from "./doctor.js";
export { EvidenceEngine } from "./evidence-engine.js";
export { fuseEvidence } from "./fusion.js";
export { classifyResearchIntent, planEvidence, sourcePriorityFor } from "./query-planner.js";
export { GitHubRestAdapter } from "./adapters/github-rest.js";
export { RssAdapter } from "./adapters/rss.js";
export { JinaReaderAdapter, JinaSearchAdapter } from "./adapters/web-jina.js";
export { YoutubeYtDlpAdapter, vttToText } from "./adapters/youtube-ytdlp.js";
export type { CommandRunner, FetchLike } from "./adapters/common.js";
export type {
  BuiltinCapability,
  CapabilityAdapter,
  CapabilityHealth,
  CapabilityName,
  CapabilityOperation,
  CapabilityProbe,
  CapabilityStatus,
  EvidenceBundle,
  EvidenceGap,
  EvidenceItem,
  EvidenceKind,
  EvidenceProvenance,
  EvidenceReadRequest,
  EvidenceSearchRequest,
  EvidenceSignal,
  EvidenceStream,
  EvidenceSubquery,
  QueryPlan,
  RankedEvidence,
  ResearchDepth,
  ResearchIntent,
} from "./types.js";
