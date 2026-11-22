import { describe, expect, it } from "vitest";
import type { Episode } from "../../intelligence/evaluation/episode-replay.js";
import { proposeRecoveryPlaybooks } from "../cos/decision-workflows/playbook-candidates.js";
import { RECOVERY_WORKFLOW_POLICY } from "../cos/decision-workflows/recovery-workflow.js";

function verified(n: number): Episode {
  const id = "recovery-" + n;
  return {
    episodeId: "ep-" + id,
    intervention: {
      interventionId: id, policyVersion: RECOVERY_WORKFLOW_POLICY,
      pathKind: "executive", metricName: "verified_recovery_success",
      predictedImprovement: 0.1, occurredAt: "2026-11-01T00:00:00Z",
    },
    outcome: {
      outcomeId: "out-" + id, interventionId: id,
      attribution: "direct_verified", assessedAt: "2026-11-02T00:00:00Z",
      metric: {
        metricName: "verified_recovery_success",
        baseline: 0, observed: 1, direction: "higher_is_better",
        evidenceRef: "verified-task:" + id,
      },
    },
    matured: true, metricDelta: 1,
  };
}

describe("AgentRun CoS verified playbook candidates", () => {
  it("returns only an inert candidate from three independently measured outcomes", () => {
    const proposed = proposeRecoveryPlaybooks([verified(1), verified(2), verified(3)]);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      kind: "review_candidate",
      policyVersion: RECOVERY_WORKFLOW_POLICY,
      evidenceCount: 3,
      disposition: "submit_to_existing_policy_review",
    });
    expect(JSON.stringify(proposed)).not.toMatch(/"code"|"tools"|"permissions"|"execute"/);
    expect(proposeRecoveryPlaybooks([verified(3), verified(1), verified(2)]))
      .toEqual(proposed);
  });

  it("cannot promote on fewer than three distinct, verified outcomes", () => {
    expect(proposeRecoveryPlaybooks([verified(1), verified(2)])).toEqual([]);
    expect(proposeRecoveryPlaybooks([verified(1), verified(1), verified(2)])).toEqual([]);
    expect(proposeRecoveryPlaybooks([verified(1), verified(2), verified(3)], { minimumDistinct: 5 })).toEqual([]);
  });

  it("treats unverified, unknown, and negative assessments as hard blocks", () => {
    const unknown = { ...verified(4), matured: false, outcome: undefined, metricDelta: undefined };
    expect(proposeRecoveryPlaybooks([verified(1), verified(2), unknown])).toEqual([]);
    const negative: Episode = {
      ...verified(4), outcome: { ...verified(4).outcome!, attribution: "not_helpful" },
      metricDelta: -1,
    };
    expect(proposeRecoveryPlaybooks([verified(1), verified(2), verified(3), negative])).toEqual([]);
    const unmeasured = { ...verified(5), metricDelta: undefined };
    expect(proposeRecoveryPlaybooks([verified(1), verified(2), unmeasured])).toEqual([]);
  });

  it("does not generalize across policy or metric scope", () => {
    const wrongPolicy = {
      ...verified(3), intervention: { ...verified(3).intervention, policyVersion: "other-policy" },
    };
    expect(proposeRecoveryPlaybooks([verified(1), verified(2), wrongPolicy])).toEqual([]);
  });
});
