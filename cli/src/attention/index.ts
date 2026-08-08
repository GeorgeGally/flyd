export { AttentionEngine, attentionEngine } from "./attention-engine.js";
export { CommitmentStore, commitmentStore } from "./commitment-store.js";
export { SignalBus, signalBus, computeFingerprintFromPayload } from "./signal-bus.js";
export { CandidateBuilder, candidateBuilder, normalizeAndDeduplicate } from "./candidate-builder.js";
export { AttentionPolicyEngine, attentionPolicyEngine } from "./attention-policy-engine.js";
export { AttentionJudge, attentionJudge, requiresModelJudgment } from "./attention-judge.js";
export { AttentionDispatcher, attentionDispatcher } from "./attention-dispatcher.js";
export { OutcomeRecorder, outcomeRecorder } from "./outcome-recorder.js";
export { extractAndPersistCommitments, extractCommitmentsFromText } from "./commitment-extractor.js";

export type * from "./types.js";

export {
  handleAttentionStatus,
  handleAttentionStart,
  handleAttentionStop,
  handleAttentionTick,
  handleAttentionDecisions,
  handleAttentionOutcome,
  handleAttentionCommitments,
  handleAttentionCommitmentById,
  handleAttentionExtractCommitments,
  handleAttentionSceneClaims,
  handleAttentionPolicy,
  handleAttentionKill,
  handleAttentionOutcomes,
  handleAttentionCandidates,
} from "./server-routes.js";
