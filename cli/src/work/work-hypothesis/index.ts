export { assembleCandidates, isDirtyOnlyStale, displayName } from "./candidates.js";
export { isEphemeralRepoRoot } from "./ephemeral.js";
export { buildPresentModelBelief, getOrBuildPresentModelSyncFallback } from "./engine.js";
export {
  applyHypothesisCorrection,
  parseHypothesisCorrection,
  enforceDemotionConstraints,
} from "./corrections.js";
export {
  readPresentModel,
  writePresentModel,
  projectHypothesisLine,
  activeDemotions,
  appendCorrection,
  listCorrections,
} from "./store.js";
export type {
  WorkHypothesis,
  WorkThread,
  CandidateRepoInput,
  HypothesisCorrection,
} from "./types.js";
