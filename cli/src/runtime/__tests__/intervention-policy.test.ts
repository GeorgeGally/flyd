import { describe, expect, it } from "vitest";
import { chooseIntervention } from "../intervention-policy.js";

describe("chooseIntervention", () => {
  it("retries one failed verification inside the remaining run budget", () => {
    expect(chooseIntervention({
      trigger: "verification_failed",
      evidenceDigest: "evidence-1",
      priorEvidenceDigests: [],
      remainingRuns: 2,
      replacementAvailable: true,
    })).toMatchObject({ action: "retry", automatic: true });
  });

  it("replaces an unhealthy worker when another capable adapter is available", () => {
    expect(chooseIntervention({
      trigger: "worker_failed",
      evidenceDigest: "evidence-2",
      priorEvidenceDigests: [],
      remainingRuns: 1,
      replacementAvailable: true,
    })).toMatchObject({ action: "replace", automatic: true });
  });

  it("stops inactive work but escalates source changes and scope expansion", () => {
    expect(chooseIntervention({
      trigger: "inactive",
      evidenceDigest: "inactive-1",
      priorEvidenceDigests: [],
      remainingRuns: 1,
      replacementAvailable: false,
    })).toMatchObject({ action: "stop", automatic: true });
    expect(chooseIntervention({
      trigger: "repository_changed",
      evidenceDigest: "repo-1",
      priorEvidenceDigests: [],
      remainingRuns: 2,
      replacementAvailable: true,
    })).toMatchObject({ action: "escalate", automatic: false });
    expect(chooseIntervention({
      trigger: "scope_expansion",
      evidenceDigest: "scope-1",
      priorEvidenceDigests: [],
      remainingRuns: 2,
      replacementAvailable: true,
    })).toMatchObject({ action: "escalate", automatic: false });
  });

  it("does not repeat an intervention for the same evidence", () => {
    expect(chooseIntervention({
      trigger: "verification_failed",
      evidenceDigest: "same",
      priorEvidenceDigests: ["same"],
      remainingRuns: 2,
      replacementAvailable: true,
    })).toMatchObject({ action: "none", automatic: false });
  });
});
