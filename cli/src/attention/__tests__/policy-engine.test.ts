import { describe, it, expect, beforeEach } from "vitest";
import { AttentionPolicyEngine } from "../attention-policy-engine.js";
import type { CandidateEvent } from "../types.js";

function makeCandidate(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
  return {
    id: "cand-1",
    type: "deadline_due",
    subject: { id: "subj-1", kind: "task", label: "Test" },
    signalIds: ["sig-1"],
    evidence: [],
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    status: "pending",
    novelty: 0.5,
    urgency: 0.9,
    consequence: 0.7,
    confidence: 0.7,
    reversibility: 0.8,
    userRelevance: 0.8,
    interruptionCost: 0.3,
    evidenceQuality: 0.6,
    suppressionKey: "deadline_due::subj-1",
    ...overrides,
  };
}

describe("AttentionPolicyEngine", () => {
  let engine: AttentionPolicyEngine;

  beforeEach(() => {
    engine = new AttentionPolicyEngine();
  });

  it("computes priority score for high urgency candidate", () => {
    const candidate = makeCandidate({ urgency: 0.9, consequence: 0.8, userRelevance: 0.9 });
    const score = engine.computePriorityScore(candidate);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("computes low priority score for low urgency candidate", () => {
    const candidate = makeCandidate({ urgency: 0.1, consequence: 0.1, userRelevance: 0.1 });
    const score = engine.computePriorityScore(candidate);
    expect(score).toBeLessThan(0.3);
  });

  it("reduces score for high interruption cost", () => {
    const lowCost = makeCandidate({ interruptionCost: 0.1 });
    const highCost = makeCandidate({ interruptionCost: 0.9 });
    expect(engine.computePriorityScore(lowCost)).toBeGreaterThan(engine.computePriorityScore(highCost));
  });

  it("maps score to disposition", () => {
    expect(engine.scoreToDisposition(0.05)).toBe("ignore");
    expect(engine.scoreToDisposition(0.2)).toBe("remember");
    expect(engine.scoreToDisposition(0.4)).toBe("prepare");
    expect(engine.scoreToDisposition(0.6)).toBe("next_scene");
    expect(engine.scoreToDisposition(0.9)).toBe("notify_now");
  });

  it("hard gate rejects expired candidates", () => {
    const expired = makeCandidate({
      status: "expired",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const result = engine.hardGate(expired);
    expect(result.allowed).toBe(false);
    expect(result.maxDisposition).toBe("ignore");
    expect(result.reasonCodes).toContain("EXPIRED");
  });

  it("hard gate rejects low confidence candidates to remember only", () => {
    const lowConf = makeCandidate({ confidence: 0.1 });
    const result = engine.hardGate(lowConf);
    expect(result.allowed).toBe(true);
    expect(result.maxDisposition).toBe("remember");
    expect(result.reasonCodes).toContain("BELOW_CONFIDENCE_THRESHOLD");
  });

  it("hard gate rejects missing provenance", () => {
    const noEvidence = makeCandidate({ evidenceQuality: 0.05 });
    const result = engine.hardGate(noEvidence);
    expect(result.allowed).toBe(false);
    expect(result.maxDisposition).toBe("remember");
    expect(result.reasonCodes).toContain("MISSING_PROVENANCE");
  });

  it("hard gate enforces cooldown", () => {
    const candidate = makeCandidate({ suppressionKey: "test_key" });
    engine.recordCooldown("test_key");

    const result = engine.hardGate(candidate);
    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain("DUPLICATE");
  });

  it("hard gate respects kill switch", () => {
    engine.setKillSwitch(true);
    const candidate = makeCandidate();
    const result = engine.hardGate(candidate);
    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain("PROACTIVITY_DISABLED");
  });

  it("releaseKillSwitch restores normal operation", () => {
    engine.setKillSwitch(true);
    engine.releaseKillSwitch();
    const candidate = makeCandidate();
    const result = engine.hardGate(candidate);
    expect(result.allowed).toBe(true);
  });

  it("gateDisposition caps at max", () => {
    const gateResult = engine.hardGate(makeCandidate({ confidence: 0.1 }));
    const result = engine.gateDisposition("notify_now", gateResult);
    expect(result).toBe("remember");
  });

  it("records cooldowns and respects them", () => {
    engine.recordCooldown("ev1");
    const candidate = makeCandidate({ suppressionKey: "ev1" });
    const result = engine.hardGate(candidate);
    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain("DUPLICATE");
  });

  it("canInterrupt respects daily budget", () => {
    const cfg = engine.getConfig();
    const budget = cfg.dailyInterruptionLimit;
    for (let i = 0; i < budget; i++) {
      engine.recordInterruption();
    }
    expect(engine.canInterrupt()).toBe(false);
  });

  it("buildDecision produces valid decision", () => {
    const candidate = makeCandidate();
    const score = engine.computePriorityScore(candidate);
    const gateResult = engine.hardGate(candidate);
    const decision = engine.buildDecision(candidate, score, "next_scene", gateResult, [], 0.7);

    expect(decision.candidateId).toBe("cand-1");
    expect(decision.disposition).toBe("next_scene");
    expect(decision.policyVersion).toBeDefined();
    expect(decision.confidence).toBe(0.7);
  });

  it("bumps policy version", () => {
    const v1 = engine.getPolicyVersion();
    engine.bumpPolicyVersion("test");
    const v2 = engine.getPolicyVersion();
    expect(v2).not.toBe(v1);
  });

  it("updates config", () => {
    engine.updateConfig({ dailyInterruptionLimit: 10 });
    expect(engine.getConfig().dailyInterruptionLimit).toBe(10);
  });
});
