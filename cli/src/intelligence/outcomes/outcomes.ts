import { randomUUID } from "node:crypto";

/**
 * Outcome assessment (flyd-personal-intelligence-prd.md §2.2, plan U7).
 *
 * Acceptance or rejection of an intervention is evidence, never proof.
 * Direct verification, later observed impact, and unknown outcomes are
 * distinct attribution states. A positive reaction without an outcome stays
 * inconclusive forever until real evidence arrives.
 */

export type AttributionState = "direct_verified" | "observed_impact" | "user_rejected" | "not_helpful" | "unknown";

/** An explicitly measured outcome. Prose and user ratings never supply numbers. */
export interface MeasuredOutcome {
  metricName: string;
  baseline: number;
  observed: number;
  /** Whether an increase is beneficial for this declared metric. */
  direction: "higher_is_better" | "lower_is_better";
  /** Independently inspectable evidence for the measurement. */
  evidenceRef: string;
}

export interface OutcomeAssessment {
  outcomeId: string;
  /** The intervention this outcome belongs to (causal chain anchor). */
  interventionId: string;
  attribution: AttributionState;
  /** User review verdict per the shared review contract (R14). */
  review?: { verdict: "helpful" | "not_helpful" | "unknown"; reason?: string };
  detail?: string;
  metric?: MeasuredOutcome;
  assessedAt: string;
}

export interface OutcomeInput {
  interventionId: string;
  attribution: AttributionState;
  review?: { verdict: "helpful" | "not_helpful" | "unknown"; reason?: string };
  detail?: string;
  metric?: MeasuredOutcome;
  assessedAt?: Date;
}

/**
 * Whether an outcome can count as evidence toward promotion. Only
 * direct verification and later observed impact qualify; everything else —
 * including enthusiastic user reaction with no verification — is inconclusive.
 */
export function isConclusive(input: Pick<OutcomeAssessment, "attribution">): boolean {
  return input.attribution === "direct_verified" || input.attribution === "observed_impact";
}

export function recordOutcome(store: OutcomeSink, input: OutcomeInput): OutcomeAssessment {
  if (input.metric) {
    const m = input.metric;
    if (!isConclusive(input) || !m.metricName.trim() || !m.evidenceRef.trim()
      || !Number.isFinite(m.baseline) || !Number.isFinite(m.observed)
      || (m.direction !== "higher_is_better" && m.direction !== "lower_is_better")) {
      throw new Error("measured outcome requires verifiable attribution and finite, named evidence");
    }
  }
  const assessment: OutcomeAssessment = {
    outcomeId: randomUUID(),
    interventionId: input.interventionId,
    attribution: input.attribution,
    ...(input.review ? { review: input.review } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.metric ? { metric: input.metric } : {}),
    assessedAt: (input.assessedAt ?? new Date()).toISOString(),
  };
  store.saveOutcome(assessment);
  return assessment;
}

/** Minimal persistence seam so outcomes can live in any durable store. */
export interface OutcomeSink {
  saveOutcome(assessment: OutcomeAssessment): void;
}

/** In-memory sink for tests/shadow replay; production wires the spine. */
export class MemoryOutcomeStore implements OutcomeSink {
  readonly outcomes: OutcomeAssessment[] = [];
  saveOutcome(assessment: OutcomeAssessment): void {
    this.outcomes.push(assessment);
  }
  byIntervention(interventionId: string): OutcomeAssessment[] {
    return this.outcomes.filter((o) => o.interventionId === interventionId);
  }
}
