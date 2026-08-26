/**
 * Transition-log input contracts (transition-log plan U1).
 *
 * These are the typed inputs to the spine writer; the envelope shapes they
 * produce live in intelligence/context-envelope.ts. Validation happens at
 * this boundary — unknown fields reject the whole entry.
 */

export type TransitionSurface = "overlay" | "cli_chat" | "harness";

export interface TransitionActionInput {
  sessionId: string;
  invocationId: string;
  surface: TransitionSurface;
  intent: string;
  routeKind?: string;
  resolutionMode?: string;
  model?: string;
  appSummary?: string;
}

export type TransitionOrigin = "user" | "tool" | "verifier";

export type TransitionSignal =
  | "succeeded"
  | "rejected"
  | "failed"
  | "cancelled"
  | "verified"
  | "partial"
  | "error"
  | "ambiguous";

export interface TransitionNextStateInput {
  sessionId?: string;
  invocationId: string;
  origin: TransitionOrigin;
  signal: TransitionSignal;
  /** Owning surface; routes the event to that source contract. Defaults to overlay. */
  surface?: TransitionSurface;
  /** Raw user correction words; sanitized only at directive-extraction time. */
  correction?: string;
  /** True when the outcome arrived after its action context expired. */
  causalComplete?: boolean;
  /** Structured exit-signal fields (exit codes, timeouts); never raw output text. */
  detail?: Record<string, unknown>;
}

export interface JudgmentInput {
  transitionSeq: number;
  verdict: -1 | 0 | 1;
  /** 0..1, kept separate from verdict per decouple-confidence-from-freshness. */
  confidence: number;
  rationale: string;
}
