import type { OutcomeAssessment } from "../outcomes/outcomes.js";
import { isConclusive } from "../outcomes/outcomes.js";

/**
 * Episode materialization and replay (plan U7).
 *
 * A consented episode is one causal chain: intervention → outcome, matured
 * inside a fixed window. Splits are derived from episode timestamps BEFORE
 * any candidate is evaluated — a candidate can never influence its own
 * train/holdout split. Replay is deterministic: the same episodes always
 * produce the same metrics.
 */

export interface InterventionRecord {
  interventionId: string;
  policyVersion: string;
  /** Path kind of the surface that delivered it ("interface" = INVOKED/chat). */
  pathKind: "sensor" | "interface" | "executive" | "capability";
  metricName: string;
  /** Outcome-independent baseline expectation for the metric. */
  predictedImprovement: number;
  occurredAt: string;
}

export interface Episode {
  episodeId: string;
  intervention: InterventionRecord;
  outcome?: OutcomeAssessment;
  /** True when attribution is conclusive; unknown outcomes never vote. */
  matured: boolean;
  /** Metric delta attributed to this episode; only meaningful when matured. */
  metricDelta?: number;
}

export const OUTCOME_MATURITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface EpisodeMaterialization {
  episodes: Episode[];
  unknownCount: number;
}

export function materializeEpisodes(
  interventions: InterventionRecord[],
  outcomes: OutcomeAssessment[],
  now = new Date(),
): EpisodeMaterialization {
  const byIntervention = new Map<string, OutcomeAssessment[]>();
  for (const outcome of outcomes) {
    const list = byIntervention.get(outcome.interventionId) ?? [];
    list.push(outcome);
    byIntervention.set(outcome.interventionId, list);
  }

  const episodes: Episode[] = [];
  let unknownCount = 0;

  for (const intervention of interventions) {
    const candidates = byIntervention.get(intervention.interventionId) ?? [];
    // Positive evidence requires conclusive attribution; an explicit user
    // rejection is decisive NEGATIVE evidence and also matures the episode.
    const decisive = candidates.find(
      (o) =>
        isConclusive(o) ||
        o.attribution === "not_helpful" ||
        o.attribution === "user_rejected",
    );
    if (decisive && Date.parse(decisive.assessedAt) - Date.parse(intervention.occurredAt) <= OUTCOME_MATURITY_WINDOW_MS) {
      episodes.push({
        episodeId: `ep-${intervention.interventionId}`,
        intervention,
        outcome: decisive,
        matured: true,
        ...(deriveMetricDelta(intervention, decisive) !== undefined
          ? { metricDelta: deriveMetricDelta(intervention, decisive) }
          : {}),
      });
    } else {
      unknownCount += 1;
      // An unmatured episode exists but can never vote in a promotion.
      episodes.push({ episodeId: `ep-${intervention.interventionId}`, intervention, matured: false });
    }
  }

  return { episodes, unknownCount };
}

function deriveMetricDelta(intervention: InterventionRecord, outcome: OutcomeAssessment): number | undefined {
  if (outcome.attribution === "user_rejected" || outcome.attribution === "not_helpful") return -1;
  if (!outcome.detail) return undefined;
  const parsed = Number.parseFloat(outcome.detail);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// Time-split cohorts — frozen before candidates exist
// ---------------------------------------------------------------------------

export interface ReplayCohorts {
  train: Episode[];
  holdout: Episode[];
  /** Boundary timestamp; identical inputs always yield identical splits. */
  splitAt: string | undefined;
}

/** Deterministic midpoint split on occurrence time. */
export function timeSplit(episodes: Episode[]): ReplayCohorts {
  if (episodes.length === 0) return { train: [], holdout: [], splitAt: undefined };
  const sorted = episodes.slice().sort(
    (a, b) => Date.parse(a.intervention.occurredAt) - Date.parse(b.intervention.occurredAt),
  );
  const mid = Math.floor(sorted.length / 2);
  return {
    train: sorted.slice(0, mid),
    holdout: sorted.slice(mid),
    splitAt: sorted.length >= 2 ? sorted[mid].intervention.occurredAt : undefined,
  };
}

export interface CohortMetrics {
  episodeCount: number;
  maturedCount: number;
  meanMetricDelta?: number;
  /** Share of episodes where the user judged the intervention unhelpful. */
  rejectionRate: number;
}

export function cohortMetrics(cohort: Episode[]): CohortMetrics {
  const matured = cohort.filter((e) => e.matured && e.metricDelta !== undefined);
  const rejected = cohort.filter(
    (e) => e.outcome?.attribution === "not_helpful" || e.outcome?.attribution === "user_rejected",
  );
  return {
    episodeCount: cohort.length,
    maturedCount: matured.length,
    ...(matured.length > 0
      ? { meanMetricDelta: matured.reduce((sum, e) => sum + (e.metricDelta ?? 0), 0) / matured.length }
      : {}),
    rejectionRate: cohort.length === 0 ? 0 : rejected.length / cohort.length,
  };
}
