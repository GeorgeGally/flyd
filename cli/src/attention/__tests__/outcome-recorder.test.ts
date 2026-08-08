import { describe, it, expect, beforeEach } from "vitest";
import { OutcomeRecorder } from "../outcome-recorder.js";
import type { AttentionDecision } from "../types.js";

function makeDecision(id = "cand-1"): AttentionDecision {
  return {
    candidateId: id,
    disposition: "next_scene",
    reasonCodes: ["DUE_SOON"],
    evidence: [],
    confidence: 0.8,
    policyVersion: "1.0.0",
    decidedAt: new Date().toISOString(),
  };
}

describe("OutcomeRecorder", () => {
  let recorder: OutcomeRecorder;

  beforeEach(() => {
    recorder = new OutcomeRecorder();
  });

  it("records opened outcome", () => {
    const decision = makeDecision();
    const outcome = recorder.recordOpened(decision);

    expect(outcome.kind).toBe("opened");
    expect(outcome.candidateId).toBe("cand-1");
    expect(outcome.decisionId).toBe(`disp_${decision.candidateId}`);
  });

  it("records dismissed outcome", () => {
    const outcome = recorder.recordDismissed(makeDecision());
    expect(outcome.kind).toBe("dismissed");
  });

  it("records snoozed outcome", () => {
    const outcome = recorder.recordSnoozed(makeDecision());
    expect(outcome.kind).toBe("snoozed");
  });

  it("records corrected with correction text", () => {
    const outcome = recorder.recordCorrected(makeDecision(), "This is wrong", "wrong_fact");
    expect(outcome.kind).toBe("corrected");
    expect(outcome.correctionText).toBe("This is wrong");
    expect(outcome.correctionKind).toBe("wrong_fact");
  });

  it("records action outcome", () => {
    const outcome = recorder.recordActionSucceeded(makeDecision(), "Done: PR merged");
    expect(outcome.kind).toBe("action_succeeded");
    expect(outcome.resultSummary).toBe("Done: PR merged");
  });

  it("records action failed outcome", () => {
    const outcome = recorder.recordActionFailed(makeDecision(), "Build broke");
    expect(outcome.kind).toBe("action_failed");
    expect(outcome.resultSummary).toBe("Build broke");
  });

  it("records action failed without summary", () => {
    const outcome = recorder.recordActionFailed(makeDecision());
    expect(outcome.kind).toBe("action_failed");
    expect(outcome.resultSummary).toBeUndefined();
  });

  it("records approved and rejected", () => {
    const approved = recorder.recordApproved(makeDecision("cand-1"));
    const rejected = recorder.recordRejected(makeDecision("cand-2"));

    expect(approved.kind).toBe("approved");
    expect(rejected.kind).toBe("rejected");
  });

  it("records expired unseen", () => {
    const outcome = recorder.recordExpiredUnseen(makeDecision());
    expect(outcome.kind).toBe("expired_unseen");
  });

  it("getOutcomesForCandidate filters by candidateId", () => {
    recorder.recordOpened(makeDecision("cand-1"));
    recorder.recordDismissed(makeDecision("cand-1"));
    recorder.recordOpened(makeDecision("cand-2"));

    const forCand1 = recorder.getOutcomesForCandidate("cand-1");
    expect(forCand1.length).toBe(2);
  });

  it("getOutcomeStats returns accurate stats", () => {
    recorder.recordOpened(makeDecision());
    recorder.recordOpened(makeDecision());
    recorder.recordDismissed(makeDecision());
    recorder.recordActed(makeDecision());
    recorder.recordActionSucceeded(makeDecision());

    const stats = recorder.getOutcomeStats();
    expect(stats.total).toBe(5);
    expect(stats.opened).toBe(2);
    expect(stats.dismissed).toBe(1);
    expect(stats.acted).toBe(1);
    expect(stats.actionSucceeded).toBe(1);
  });

  it("outcome callback is triggered", () => {
    const received: string[] = [];
    recorder.onOutcome((o) => received.push(o.kind));

    recorder.recordOpened(makeDecision());
    recorder.recordDismissed(makeDecision());

    expect(received).toEqual(["opened", "dismissed"]);
  });

  it("outcome callback errors do not stop recording", () => {
    recorder.onOutcome(() => { throw new Error("boom"); });
    const outcome = recorder.recordOpened(makeDecision());
    expect(outcome.kind).toBe("opened");
  });

  it("never_this correction creates suppression rule", () => {
    recorder.recordCorrected(makeDecision(), "Never show", "never_this");
    expect(recorder.suppression.length).toBe(1);
    expect(recorder.suppression[0].source).toBe("user_never");
  });

  it("clear empties all", () => {
    recorder.recordOpened(makeDecision());
    recorder.recordDismissed(makeDecision());
    recorder.clear();

    expect(recorder.getOutcomeStats().total).toBe(0);
    expect(recorder.suppression.length).toBe(0);
  });

  it("stays within max outcomes", () => {
    // record more than max (500)
    for (let i = 0; i < 600; i++) {
      recorder.recordOpened(makeDecision(`cand-${i}`));
    }
    expect(recorder.all.length).toBeLessThanOrEqual(500);
  });
});
