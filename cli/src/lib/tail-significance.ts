export interface TailSignals {
  surprise: number;
  consequence: number;
  userCorrection: boolean;
  failure: boolean;
  majorDecision: boolean;
  stateTransition: boolean;
  unresolvedBlocker: boolean;
}

export interface TailSignificance {
  score: number;
  preserve: boolean;
  reasons: string[];
}

function unit(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/** Consequence-aware preservation signal for distillation/retrieval. */
export function scoreTailSignificance(metadata: Record<string, unknown>): TailSignificance {
  const signals: TailSignals = {
    surprise: unit(metadata.surprise ?? metadata.novelty),
    consequence: unit(metadata.consequence ?? metadata.impact),
    userCorrection: metadata.userCorrection === true || metadata.type === "user_correction",
    failure: metadata.failure === true || metadata.outcome === "failure",
    majorDecision: metadata.majorDecision === true || metadata.type === "decision",
    stateTransition: metadata.stateTransition === true || metadata.type === "state_transition",
    unresolvedBlocker: metadata.unresolvedBlocker === true || metadata.blockerStatus === "unresolved",
  };

  let score = signals.surprise * 0.18 + signals.consequence * 0.28;
  const reasons: string[] = [];
  const add = (active: boolean, amount: number, reason: string): void => {
    if (!active) return;
    score += amount;
    reasons.push(reason);
  };
  add(signals.userCorrection, 0.35, "user correction");
  add(signals.failure, 0.28, "failure");
  add(signals.majorDecision, 0.30, "major decision");
  add(signals.stateTransition, 0.18, "state transition");
  add(signals.unresolvedBlocker, 0.25, "unresolved blocker");
  if (signals.surprise >= 0.7) reasons.push("surprising/novel event");
  if (signals.consequence >= 0.7) reasons.push("high consequence");

  score = Math.min(1, Math.round(score * 100) / 100);
  return { score, preserve: score >= 0.45, reasons };
}

export function annotateTailSignificance<T extends { metadata: Record<string, unknown> }>(entry: T): T {
  const tail = scoreTailSignificance(entry.metadata);
  return {
    ...entry,
    metadata: {
      ...entry.metadata,
      tailSignificance: tail.score,
      preservationRequired: tail.preserve,
      preservationReasons: tail.reasons,
    },
  };
}

/**
 * Retrieval-side guarantee: consequential tail events get enough bounded
 * utility to survive ordinary rank truncation while epistemic confidence is
 * left untouched. This keeps importance separate from truth confidence.
 */
export function applyTailPreservation<T extends {
  metadata: Record<string, unknown>;
  librarianScore: number;
  confidenceProfile: { retrievalUtility: number };
}>(entry: T): T {
  const annotated = annotateTailSignificance(entry);
  const tail = scoreTailSignificance(entry.metadata);
  if (!tail.preserve) return annotated;
  const boost = 0.12 + tail.score * 0.13;
  return {
    ...annotated,
    librarianScore: Math.min(1, annotated.librarianScore + boost),
    confidenceProfile: {
      ...annotated.confidenceProfile,
      retrievalUtility: Math.min(1, annotated.confidenceProfile.retrievalUtility + boost),
    },
  };
}
