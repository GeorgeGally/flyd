export { CapabilityRegistry } from "./capability-registry.js";
export type { CapabilityInspection, ResolvedCapability } from "./capability-registry.js";
export { clusterEvidence, buildDrillDownQueries } from "./clustering.js";
export { extractEvidenceConflicts } from "./contradictions.js";
export {
  finalizeEvidenceSurface,
  publishEvidenceSurface,
  renderEvidenceSurfaceHtml,
} from "./compose-surface.js";
export { evidenceSurfaceUrl, normalizeEvidenceSurfaceUrl } from "./compose-url.js";
export { createDefaultEvidenceRegistry } from "./default-registry.js";
export type { DefaultEvidenceRegistryOptions } from "./default-registry.js";
export { buildEvidenceDoctorReport, formatEvidenceDoctorReport } from "./doctor.js";
export type { EvidenceCapabilityDiagnostic, EvidenceDoctorReport } from "./doctor.js";
export { EvidenceEngine } from "./evidence-engine.js";
export type { EvidenceResearchOptions } from "./evidence-engine.js";
export {
  classifyEvidenceNeed,
  isResolutionSystemPrompt,
  parseResolutionEvidenceContext,
  sanitizeEvidenceLocator,
} from "./evidence-need.js";
export type {
  EvidenceNeedDecision,
  EvidenceNeedLevel,
  ResolutionEvidenceContext,
} from "./evidence-need.js";
export {
  enrichResolutionPromptWithEvidence,
  formatEvidenceBundle,
} from "./resolution-evidence.js";
export type {
  ResolutionEvidenceDependencies,
  ResolutionEvidenceResult,
} from "./resolution-evidence.js";
export { fuseEvidence } from "./fusion.js";
export { classifyResearchIntent, planEvidence, sourcePriorityFor } from "./query-planner.js";
export { GitHubRestAdapter } from "./adapters/github-rest.js";
export { HackerNewsAdapter } from "./adapters/hackernews.js";
export { RedditAdapter } from "./adapters/reddit.js";
export { RssAdapter } from "./adapters/rss.js";
export { JinaReaderAdapter, JinaSearchAdapter } from "./adapters/web-jina.js";
export { XApiAdapter } from "./adapters/x-api.js";
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
  EvidenceCluster,
  EvidenceComposeSurface,
  EvidenceConflict,
  EvidenceGap,
  EvidenceItem,
  EvidenceKind,
  EvidenceProvenance,
  EvidenceReadRequest,
  EvidenceSearchRequest,
  EvidenceSignal,
  EvidenceStream,
  EvidenceSubquery,
  EvidenceSurfaceFinding,
  EvidenceSurfaceSynthesis,
  QueryPlan,
  RankedEvidence,
  ResearchDepth,
  ResearchIntent,
} from "./types.js";
