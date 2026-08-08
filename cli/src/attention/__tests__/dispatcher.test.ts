import { describe, it, expect, beforeEach } from "vitest";
import { AttentionDispatcher } from "../attention-dispatcher.js";
import type { AttentionDecision, CandidateEvent } from "../types.js";

function makeDecision(disposition: AttentionDecision["disposition"]): AttentionDecision {
  return {
    candidateId: "cand-1",
    disposition,
    reasonCodes: ["DUE_SOON"],
    evidence: [],
    confidence: 0.8,
    policyVersion: "1.0.0",
    decidedAt: new Date().toISOString(),
  };
}

const candidate: CandidateEvent = {
  id: "cand-1",
  type: "deadline_due",
  subject: { id: "subj-1", kind: "task", label: "Ship engine" },
  signalIds: ["sig-1"],
  evidence: [],
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  status: "evaluating",
  novelty: 0.5,
  urgency: 0.9,
  consequence: 0.7,
  confidence: 0.7,
  reversibility: 0.8,
  userRelevance: 0.9,
  interruptionCost: 0.3,
  evidenceQuality: 0.6,
  suppressionKey: "test",
};

describe("AttentionDispatcher", () => {
  let dispatcher: AttentionDispatcher;

  beforeEach(() => {
    dispatcher = new AttentionDispatcher();
  });

  it("dispatches ignore", () => {
    const result = dispatcher.dispatch(makeDecision("ignore"), candidate);
    expect(result.dispatched).toBe(true);
    expect(dispatcher.getSceneClaims().length).toBe(0);
  });

  it("dispatches remember with callback", () => {
    const remembered: string[] = [];
    dispatcher.onRemember((d) => remembered.push(d.decidedAt));

    const result = dispatcher.dispatch(makeDecision("remember"), candidate);
    expect(result.dispatched).toBe(true);
    expect(remembered.length).toBe(1);
  });

  it("remember handles callback errors gracefully", () => {
    dispatcher.onRemember(() => { throw new Error("boom"); });
    const result = dispatcher.dispatch(makeDecision("remember"), candidate);
    expect(result.dispatched).toBe(false);
    expect(result.error).toContain("failed");
  });

  it("dispatches next_scene as scene claim", () => {
    const result = dispatcher.dispatch(makeDecision("next_scene"), candidate);
    expect(result.dispatched).toBe(true);

    const claims = dispatcher.getSceneClaims();
    expect(claims.length).toBe(1);
    expect(claims[0].candidateId).toBe("cand-1");
    expect(claims[0].headline).toContain("Deadline approaching");
  });

  it("respects max scene claims", () => {
    for (let i = 0; i < 5; i++) {
      dispatcher.dispatch(makeDecision("next_scene"), { ...candidate, id: `cand-${i}` });
    }
    const claims = dispatcher.getSceneClaims();
    expect(claims.length).toBeLessThanOrEqual(3);
  });

  it("scene claims sorted by rank", () => {
    dispatcher.dispatch(makeDecision("next_scene"), { ...candidate, id: "cand-1" });
    dispatcher.dispatch(makeDecision("next_scene"), { ...candidate, id: "cand-2" });

    const claims = dispatcher.getSceneClaims();
    expect(claims[0].rank).toBeGreaterThanOrEqual(claims[1].rank);
  });

  it("expired scene claims are filtered", () => {
    dispatcher.dispatch(makeDecision("next_scene"), candidate);
    const claims = dispatcher.getSceneClaims();
    expect(claims.length).toBe(1);

    expect(claims[0].expiresAt).toBeDefined();
  });

  it("clearSceneClaims removes all claims", () => {
    dispatcher.dispatch(makeDecision("next_scene"), candidate);
    dispatcher.clearSceneClaims();
    expect(dispatcher.getSceneClaims().length).toBe(0);
  });

  it("dispatches notify_now into queue", () => {
    dispatcher.dispatch(makeDecision("notify_now"), candidate);
    const queue = dispatcher.getNotifyNowQueue();
    expect(queue.length).toBe(1);
    expect(dispatcher.getNotifyNowQueue().length).toBe(0);
  });

  it("dispatches ask_permission into queue", () => {
    dispatcher.dispatch(makeDecision("ask_permission"), candidate);
    const queue = dispatcher.getPermissionRequests();
    expect(queue.length).toBe(1);
    expect(dispatcher.getPermissionRequests().length).toBe(0);
  });

  it("dispatches act into queue", () => {
    dispatcher.dispatch(makeDecision("act"), candidate);
    const queue = dispatcher.getActEnvelopes();
    expect(queue.length).toBe(1);
    expect(dispatcher.getActEnvelopes().length).toBe(0);
  });

  it("records and retrieves prepared artifacts", () => {
    dispatcher.recordPreparedArtifact("cand-1", {
      candidateId: "cand-1",
      artifact: {
        id: "art-1",
        kind: "summary",
        description: "Summary of evidence",
        location: "memory://cand-1",
        preparedAt: new Date().toISOString(),
      },
    });

    const artifact = dispatcher.getPreparedArtifact("cand-1");
    expect(artifact).toBeDefined();
    expect(artifact!.artifact.id).toBe("art-1");
  });

  it("returns aggregate state", () => {
    dispatcher.dispatch(makeDecision("next_scene"), candidate);
    dispatcher.dispatch(makeDecision("notify_now"), candidate);
    dispatcher.dispatch(makeDecision("prepare"), candidate);

    const all = dispatcher.all;
    expect(all.sceneClaims.length).toBe(1);
    expect(all.notifyNowCount).toBe(1);
  });

  it("delegation_blocked candidates get unblock action", () => {
    const blockedCandidate: CandidateEvent = {
      ...candidate,
      type: "delegation_blocked",
    };
    dispatcher.dispatch(makeDecision("next_scene"), blockedCandidate);

    const claims = dispatcher.getSceneClaims();
    expect(claims[0].proposedActions.length).toBe(1);
    expect(claims[0].proposedActions[0].kind).toBe("inspect");
  });
});
