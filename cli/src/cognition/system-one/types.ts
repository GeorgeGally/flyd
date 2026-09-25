import type { ConsentLookup } from "../../intelligence/context-envelope.js";

export type PredicateQuestionType = "noul" | "choice" | "score";

/**
 * Wire criteria. Noul criteria describe `true`/`false`, Choice criteria map
 * each option to a description, and Score criteria are an ordered array of
 * level descriptions (index 0 = lowest). The TypeSafe API rejects a Score
 * whose criteria are a map with HTTP 422.
 */
export type PredicateCriteria = Readonly<Record<string, string>> | readonly string[];

export interface PredicateQuestion {
  id: string;
  instructions: string;
  criteria?: PredicateCriteria;
  type?: PredicateQuestionType;
}

export interface PredicateAnswer {
  id: string;
  type?: PredicateQuestionType;
  /**
   * Normalised to [0,1]. Noul: P(yes). Choice: probability of the chosen
   * option. Score: expected level divided by the top level index.
   */
  probability: number;
  confidence: number;
  choice?: string;
  probabilities?: Record<string, number>;
  /** Score only: probability-weighted level on the 0…levels-1 scale. */
  score?: number;
  /** Score only: number of rubric levels. */
  levels?: number;
}

export interface PredicateEvaluation {
  ok: boolean;
  evaluator: "jev" | "none";
  model?: string;
  rubricVersion: string;
  projectionHash: string;
  answers: Record<string, PredicateAnswer>;
  evaluatedAt: string;
  latencyMs: number;
  costUSD?: number;
  usage?: { inputTokens: number; outputTokens: number };
  /** Egress gateway receipt for the outbound payload, when a call was attempted. */
  egressReceiptId?: string;
  error?: string;
}

export interface JevOptions {
  endpoint?: string;
  apiKey?: string;
  /** Exact model id or alias. Also `FLYD_JEV_MODEL`; defaults to `jev-latest`. */
  model?: string;
  timeoutMs?: number;
  rubricVersion?: string;
  fetchFn?: typeof fetch;
  /** Consent source for the egress gateway; defaults to "nothing revoked". */
  consentLookup?: ConsentLookup;
}

/**
 * What a Jev call may send: every top-level state field must be declared,
 * otherwise the egress gateway denies the whole call.
 */
export interface PredicateEgress {
  purpose: string;
  allowedFields: readonly string[];
}

/** Raw answer exactly as the TypeSafe API returned it. */
export interface RawJevAnswer {
  type?: string;
  noul?: number;
  probability?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  legend?: Record<string, string>;
  confidence?: number;
}

/**
 * Durable judgment trace: one predicate answer with everything needed to
 * replay it deterministically and to tell whether it is still comparable
 * (same question fingerprint, same evaluator version, same model).
 */
export interface JudgmentTrace {
  caseId: string;
  predicateId: string;
  evaluatorVersion: string;
  questionFingerprint: string;
  projectionHash: string;
  model: string;
  answer: RawJevAnswer;
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number };
  recordedAt: string;
}
