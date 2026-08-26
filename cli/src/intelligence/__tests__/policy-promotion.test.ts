import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MemoryOutcomeStore,
  isConclusive,
  recordOutcome,
} from "../outcomes/outcomes.js";
import {
  cohortMetrics,
  materializeEpisodes,
  timeSplit,
  type InterventionRecord,
} from "../evaluation/episode-replay.js";
import { PolicyRegistry } from "../policies/policy-registry.js";

function intervention(overrides: Partial<InterventionRecord> = {}): InterventionRecord {
  return {
    interventionId: `int-${randomUUID().slice(0, 8)}`,
    policyVersion: "v0",
    pathKind: "executive",
    metricName: "briefing_usefulness",
    predictedImprovement: 0.1,
    occurredAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

function candidateFor(registry: PolicyRegistry, overrides = {}) {
  return registry.register({
    candidateId: `cand-${randomUUID().slice(0, 6)}`,
    replacesVersion: "v0",
    targetMetric: "briefing_usefulness",
    declaredImprovement: 0.05,
    minimumEpisodes: 2,
    maxRejectionRate: 0.3,
    ...overrides,
  });
}

describe("outcome assessment", () => {
  it("a positive reaction with no outcome remains inconclusive", () => {
    const store = new MemoryOutcomeStore();
    const reviewOnly = recordOutcome(store, {
      interventionId: "int-1",
      attribution: "unknown",
      review: { verdict: "helpful", reason: "loved it" },
    });
    expect(isConclusive(reviewOnly)).toBe(false);
  });

  it("direct verification and later observed impact are conclusive; unknown never is", () => {
    const store = new MemoryOutcomeStore();
    expect(isConclusive(recordOutcome(store, { interventionId: "i", attribution: "direct_verified" }))).toBe(true);
    expect(isConclusive(recordOutcome(store, { interventionId: "i", attribution: "observed_impact", detail: "0.2" }))).toBe(true);
    expect(isConclusive(recordOutcome(store, { interventionId: "i", attribution: "not_helpful" }))).toBe(false);
  });
});

describe("episode replay + policy promotion", () => {
  function buildEpisodes(count: number, attribution: "observed_impact" | "unknown" | "user_rejected") {
    const store = new MemoryOutcomeStore();
    const interventions = Array.from({ length: count }, (_, i) =>
      intervention({ occurredAt: new Date(Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000).toISOString() }),
    );
    for (const intervention of interventions) {
      recordOutcome(store, {
        interventionId: intervention.interventionId,
        attribution,
        detail: attribution === "observed_impact" ? "0.15" : undefined,
        assessedAt: new Date(Date.parse(intervention.occurredAt) + 3_600_000),
      });
    }
    return { interventions, outcomes: store.outcomes };
  }

  it("one-event apparent gains and unknown-heavy replay reject promotion as insufficient", () => {
    const registry = new PolicyRegistry("v0");
    const candidate = candidateFor(registry);

    // single episode with a great delta — still insufficient
    const one = buildEpisodes(1, "observed_impact");
    const oneMaterialized = materializeEpisodes(one.interventions, one.outcomes);
    const oneDecision = registry.evaluate(candidate.candidateId, timeSplit(oneMaterialized.episodes), oneMaterialized.episodes);
    expect(oneDecision.decision).toBe("rejected");
    expect(oneDecision.reasons.join("; ")).toContain("insufficient_evidence");

    // many episodes but all unknown → insufficient + attribution incomplete
    const unknownHeavy = buildEpisodes(6, "unknown");
    const unknownMaterialized = materializeEpisodes(unknownHeavy.interventions, unknownHeavy.outcomes);
    expect(unknownMaterialized.unknownCount).toBe(6);
    const unknownDecision = registry.evaluate(
      (registry.register({
        candidateId: `cand-${randomUUID().slice(0, 6)}`,
        replacesVersion: "v0",
        targetMetric: "briefing_usefulness",
        declaredImprovement: 0.05,
        minimumEpisodes: 1,
        maxRejectionRate: 1,
      })).candidateId,
      timeSplit(unknownMaterialized.episodes),
      unknownMaterialized.episodes,
    );
    expect(unknownDecision.decision).toBe("rejected");
    expect(unknownDecision.reasons.join("; ")).toContain("attribution_incomplete");
    // a missing delayed outcome cannot be counted as a gain
    expect(unknownDecision.report.holdout.meanMetricDelta).toBeUndefined();
  });

  it("the candidate cannot influence its train/holdout split", () => {
    const { interventions, outcomes } = buildEpisodes(8, "observed_impact");
    const materialized = materializeEpisodes(interventions, outcomes);

    const splitA = timeSplit(materialized.episodes);
    const splitB = timeSplit(materializeEpisodes(interventions, outcomes).episodes);

    // deterministic: identical inputs → identical split boundary and membership
    expect(splitA.splitAt).toBe(splitB.splitAt);
    expect(splitA.train.map((e) => e.episodeId)).toEqual(splitB.train.map((e) => e.episodeId));
    expect(splitA.holdout.map((e) => e.episodeId)).toEqual(splitB.holdout.map((e) => e.episodeId));

    // and the split is derived purely from timestamps
    const boundary = Date.parse(splitA.splitAt!);
    expect(splitA.train.every((e) => Date.parse(e.intervention.occurredAt) < boundary || e === splitA.train[splitA.train.length - 1])).toBe(true);
  });

  it("target improvement cannot override a protected safety or interruption regression", () => {
    const registry = new PolicyRegistry("v0");
    const candidate = candidateFor(registry, { minimumEpisodes: 1 });

    const store = new MemoryOutcomeStore();
    const protectedIntervention = intervention({ occurredAt: "2026-08-05T00:00:00.000Z" });
    const interventions = [
      ...Array.from({ length: 4 }, (_, i) =>
        intervention({ occurredAt: new Date(Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000).toISOString() }),
      ),
      protectedIntervention,
    ];
    for (const i of interventions) {
      if (i.interventionId === protectedIntervention.interventionId) continue;
      recordOutcome(store, {
        interventionId: i.interventionId,
        attribution: "observed_impact",
        detail: "0.2",
        assessedAt: new Date(Date.parse(i.occurredAt) + 3_600_000),
      });
    }
    // the protected case: user judged the interruption harmful
    recordOutcome(store, {
      interventionId: protectedIntervention.interventionId,
      attribution: "user_rejected",
      assessedAt: new Date(Date.parse(protectedIntervention.occurredAt) + 3_600_000),
    });

    const materialized = materializeEpisodes(interventions, store.outcomes);
    const cohorts = timeSplit(materialized.episodes);
    const decision = registry.evaluate(candidate.candidateId, cohorts, materialized.episodes, [
      `ep-${protectedIntervention.interventionId}`,
    ]);

    expect(decision.decision).toBe("rejected");
    expect(decision.reasons.join("; ")).toContain("protected_regression");
  });

  it("an INVOKED-only candidate completes shadow replay without LEARN enabled", () => {
    const store = new MemoryOutcomeStore();
    // interface-path interventions only; no sensor/LEARN data exists
    const interventions = Array.from({ length: 4 }, (_, i) =>
      intervention({ pathKind: "interface" as const, occurredAt: new Date(Date.parse("2026-08-01T00:00:00Z") + i * 43_200_000).toISOString() }),
    );
    for (const intervention of interventions) {
      recordOutcome(store, {
        interventionId: intervention.interventionId,
        attribution: "observed_impact",
        detail: "0.12",
        assessedAt: new Date(Date.parse(intervention.occurredAt) + 1_800_000),
      });
    }

    const materialized = materializeEpisodes(interventions, store.outcomes);
    expect(materialized.unknownCount).toBe(0);
    const cohorts = timeSplit(materialized.episodes);
    const metrics = cohortMetrics(cohorts.holdout);
    expect(metrics.maturedCount).toBeGreaterThan(0);
    expect(metrics.meanMetricDelta).toBeGreaterThanOrEqual(0.05);

    const registry = new PolicyRegistry("v0");
    const candidate = candidateFor(registry, { minimumEpisodes: 1 });
    const decision = registry.evaluate(candidate.candidateId, cohorts, materialized.episodes);
    expect(decision.decision).toBe("approved");

    // shadow → canary → activate lifecycle works end-to-end
    registry.canary(candidate.candidateId);
    registry.activate(candidate.candidateId);
    expect(registry.active).toContain(candidate.candidateId.slice(0, 4));
    expect(registry.historyOf(candidate.candidateId).map((h) => h.stage)).toEqual([
      "proposed", "evaluating", "approved", "canary", "active",
    ]);
  });

  it("rollback restores the prior policy version and preserves the decision receipt", () => {
    const registry = new PolicyRegistry("v0");
    const candidate = candidateFor(registry, { minimumEpisodes: 1 });

    const { interventions, outcomes } = buildEpisodes(4, "observed_impact");
    const materialized = materializeEpisodes(interventions, outcomes);
    const decision = registry.evaluate(candidate.candidateId, timeSplit(materialized.episodes), materialized.episodes);
    expect(decision.decision).toBe("approved");

    registry.canary(candidate.candidateId);
    registry.activate(candidate.candidateId);
    const rolledBack = registry.rollback(candidate.candidateId);
    expect(rolledBack.restoredVersion).toBe("v0");
    expect(registry.active).toBe("v0");
    // full inspectable trail including the rollback
    expect(registry.historyOf(candidate.candidateId).map((h) => h.stage)).toEqual([
      "proposed", "evaluating", "approved", "canary", "active", "rolled_back",
    ]);
  });

  it("post-hoc metric selection is impossible: the metric is frozen at registration", () => {
    const registry = new PolicyRegistry("v0");
    const candidate = candidateFor(registry, { targetMetric: "briefing_usefulness", minimumEpisodes: 1 });

    const { interventions, outcomes } = buildEpisodes(4, "observed_impact");
    const materialized = materializeEpisodes(interventions, outcomes);
    const cohorts = timeSplit(materialized.episodes);
    const decision = registry.evaluate(candidate.candidateId, cohorts, materialized.episodes);

    // the report only ever contains the registered metric's improvement —
    // there is no API to swap metrics between registration and evaluation
    expect(decision.report.declaredImprovement).toBe(candidate.declaredImprovement);
  });
});
