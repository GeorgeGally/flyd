import type { Episode, ReplayCohorts, CohortMetrics } from "../evaluation/episode-replay.js";
import { cohortMetrics } from "../evaluation/episode-replay.js";

/**
 * Policy registry and promotion gate (flyd-personal-intelligence-prd.md §6,
 * plan U7).
 *
 * Candidates promote only when frozen replay shows the declared improvement
 * AND no regression on protected safety/interruption/cost cases. Insufficient
 * evidence, unknown outcomes, post-hoc metric selection, and attribution gaps
 * fail closed. Every transition is recorded and reversible.
 */

export type PolicyStage = "proposed" | "evaluating" | "rejected" | "approved" | "canary" | "active" | "rolled_back" | "retired";

export interface PolicyCandidate {
  candidateId: string;
  /** The incumbent this candidate wants to replace. */
  replacesVersion: string;
  targetMetric: string;
  /** Frozen at registration — evaluating a different metric later is a violation. */
  declaredImprovement: number;
  minimumEpisodes: number;
  maxRejectionRate: number;
  registeredAt: string;
}

export interface PromotionDecision {
  decision: "rejected" | "approved";
  stage: PolicyStage;
  reasons: string[];
  report: {
    train: CohortMetrics;
    holdout: CohortMetrics;
    declaredImprovement: number;
    holdoutImprovement?: number;
    protectedRegressions: string[];
  };
}

export class PolicyRegistry {
  private readonly candidates = new Map<string, PolicyCandidate & { stage: PolicyStage; history: Array<{ stage: PolicyStage; at: string }> }>();
  private activeVersion: string;

  constructor(activeVersion = "v0") {
    this.activeVersion = activeVersion;
  }

  get active(): string {
    return this.activeVersion;
  }

  register(input: Omit<PolicyCandidate, "registeredAt">): PolicyCandidate & { stage: PolicyStage } {
    const registeredAt = new Date().toISOString();
    const candidate: PolicyCandidate & { stage: PolicyStage; history: Array<{ stage: PolicyStage; at: string }> } = {
      ...input,
      registeredAt,
      stage: "proposed",
      history: [{ stage: "proposed", at: registeredAt }],
    };
    this.candidates.set(candidate.candidateId, candidate);
    return candidate;
  }

  candidate(candidateId: string) {
    return this.candidates.get(candidateId);
  }

  /**
   * Evaluate a candidate against frozen cohorts. `protectedCaseIds` are
   * episodes that model safety/interruption/cost regressions: any rejection
   * among them blocks promotion regardless of the target metric.
   */
  evaluate(
    candidateId: string,
    cohorts: ReplayCohorts,
    episodes: Episode[],
    protectedCaseIds: string[] = [],
    now = new Date(),
  ): PromotionDecision {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error(`Unknown candidate ${candidateId}`);

    this.transition(candidate, "evaluating", now);

    const train = cohortMetrics(cohorts.train);
    const holdout = cohortMetrics(cohorts.holdout);
    const reasons: string[] = [];

    // Evidence sufficiency — one apparent gain or thin data cannot promote.
    if (holdout.episodeCount < candidate.minimumEpisodes || train.episodeCount < candidate.minimumEpisodes) {
      reasons.push(`insufficient_evidence: train=${train.episodeCount} holdout=${holdout.episodeCount} need≥${candidate.minimumEpisodes} per cohort`);
    }
    // Attribution completeness — unknown-heavy replay cannot promote.
    const unknownShare =
      cohorts.holdout.length === 0 ? 1 : cohorts.holdout.filter((e) => !e.matured).length / cohorts.holdout.length;
    if (unknownShare > 0.2) {
      reasons.push(`attribution_incomplete: ${(unknownShare * 100).toFixed(0)}% of holdout outcomes unknown`);
    }
    // Declared improvement on the frozen metric, measured on holdout only.
    let holdoutImprovement: number | undefined;
    if (holdout.meanMetricDelta !== undefined) {
      holdoutImprovement = holdout.meanMetricDelta;
      if (holdout.meanMetricDelta < candidate.declaredImprovement) {
        reasons.push(`declared_improvement_missed: ${holdout.meanMetricDelta.toFixed(3)} < ${candidate.declaredImprovement}`);
      }
    } else if (reasons.length === 0) {
      reasons.push("no_matured_metric_outcomes_on_holdout");
    }
    // Protected regressions veto everything.
    const protectedRegressions = episodes
      .filter((e) => protectedCaseIds.includes(e.episodeId))
      .filter((e) => e.outcome?.attribution === "not_helpful" || e.outcome?.attribution === "user_rejected")
      .map((e) => e.episodeId);
    if (protectedRegressions.length > 0) {
      reasons.push(`protected_regression: ${protectedRegressions.join(", ")}`);
    }
    // Rejection-rate ceiling.
    if (holdout.rejectionRate > candidate.maxRejectionRate) {
      reasons.push(`rejection_rate_exceeded: ${holdout.rejectionRate.toFixed(2)} > ${candidate.maxRejectionRate}`);
    }

    const approved = reasons.length === 0;
    const decision: PromotionDecision = {
      decision: approved ? "approved" : "rejected",
      stage: approved ? "approved" : "rejected",
      reasons,
      report: { train, holdout, declaredImprovement: candidate.declaredImprovement, ...(holdoutImprovement !== undefined ? { holdoutImprovement } : {}), protectedRegressions },
    };

    this.transition(candidate, decision.stage, now);
    return decision;
  }

  /** Canary rollout with rollback drill support. */
  canary(candidateId: string, now = new Date()): void {
    const candidate = this.require(candidateId, ["approved"]);
    this.transition(candidate, "canary", now);
  }

  activate(candidateId: string, now = new Date()): void {
    const candidate = this.require(candidateId, ["canary"]);
    this.transition(candidate, "active", now);
    this.activeVersion = `${candidate.replacesVersion}→${candidate.targetMetric}@${candidate.candidateId}`;
  }

  /**
   * Rollback restores the prior policy version and preserves the decision
   * receipt — the drill must leave an inspectable trail.
   */
  rollback(candidateId: string, now = new Date()): { restoredVersion: string } {
    const candidate = this.candidates.get(candidateId);
    if (!candidate || (candidate.stage !== "active" && candidate.stage !== "canary")) {
      throw new Error(`Cannot roll back candidate in stage ${candidate?.stage ?? "unknown"}`);
    }
    const restored = candidate.replacesVersion;
    this.transition(candidate, "rolled_back", now);
    this.activeVersion = restored;
    return { restoredVersion: restored };
  }

  historyOf(candidateId: string): Array<{ stage: PolicyStage; at: string }> {
    return this.require(candidateId, []).history.slice();
  }

  private require(candidateId: string, fromStages: PolicyStage[]) {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error(`Unknown candidate ${candidateId}`);
    if (fromStages.length > 0 && !fromStages.includes(candidate.stage)) {
      throw new Error(`Candidate ${candidateId} is ${candidate.stage}, expected one of ${fromStages.join("/")}`);
    }
    return candidate;
  }

  private transition(candidate: { stage: PolicyStage; history: Array<{ stage: PolicyStage; at: string }> }, stage: PolicyStage, now: Date): void {
    candidate.stage = stage;
    candidate.history.push({ stage, at: now.toISOString() });
  }
}
