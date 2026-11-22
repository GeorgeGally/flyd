import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../event-store.js";
import { EXECUTIVE_DECISION_VERSION, persistExecutiveDecision, type ExecutiveDecisionRecord } from "../executive/decision-step.js";
import { OUTCOME_REVIEW_SOURCE, outcomeReviewCandidates, outcomeReviews, recordExplicitOutcomeReview } from "../outcomes/outcome-review.js";
import { summarizeVerifiedLoop, verifiedLoopFromStore } from "../outcomes/verified-loop.js";
import { verifiedOutcomeReviewObjects } from "../../conversation-view/activity.js";

const AT = new Date("2026-11-22T08:00:00.000Z");
const ID = "a".repeat(32);
let dir: string;
let store: IntelligenceEventStore;

function decision(overrides: Partial<ExecutiveDecisionRecord> = {}): ExecutiveDecisionRecord {
  return {
    schema: EXECUTIVE_DECISION_VERSION,
    decisionId: ID,
    sourceId: "firstmate.task",
    sourceEventId: "verified-release",
    reason: "Independent change verification",
    summary: "The requested release is merged and available to review.",
    evidenceRefs: ["firstmate-task:checked"],
    verification: { status: "verified", evidenceRefs: ["github-merge:verified"] },
    disposition: "handle_internally",
    show: true,
    notify: false,
    createdAt: AT.toISOString(),
    ...overrides,
  } as ExecutiveDecisionRecord;
}
function put(value: ExecutiveDecisionRecord = decision()): void {
  expect(persistExecutiveDecision(store, value)).not.toBeNull();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-reviewed-outcomes-"));
  store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("explicit outcome review", () => {
  it("offers a rating only for source-verified user-facing work", () => {
    put();
    expect(outcomeReviewCandidates(store, AT)).toEqual([{
      decisionId: ID, at: AT.toISOString(), verification: "verified",
      summary: "The requested release is merged and available to review.",
    }]);
    const cards = verifiedOutcomeReviewObjects(outcomeReviewCandidates(store, AT));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "outcome-review:" + ID, kind: "activity", activity: { phase: "ready" },
      actions: [{ kind: "choose", value: "helpful" }, { kind: "choose", value: "not_helpful" }],
    });
    expect(cards[0]?.actions.some((item) => item.kind === "approve")).toBe(false);
    expect(verifiedOutcomeReviewObjects([{
      decisionId: ID, verification: "verified", at: AT.toISOString(),
      summary: "First Mate internal harness is waiting on a worker",
    }])).toHaveLength(0);
  });

  it("does not treat a private, unverified or stale executive choice as reviewable", () => {
    put(decision({ show: false }));
    expect(outcomeReviewCandidates(store, AT)).toHaveLength(0);
    expect(recordExplicitOutcomeReview(store, { decisionId: ID, verdict: "helpful", at: AT })).toBe("not_eligible");
  });

  it("records the user's verdict once, supports corrections and preserves effect/impact separation", () => {
    put();
    expect(recordExplicitOutcomeReview(store, { decisionId: ID, verdict: "helpful", at: AT })).toBe("recorded");
    expect(recordExplicitOutcomeReview(store, { decisionId: ID, verdict: "helpful", at: AT })).toBe("already_recorded");
    expect(outcomeReviewCandidates(store, AT)).toHaveLength(0);
    expect(outcomeReviews(store).get(ID)?.verdict).toBe("helpful");

    let items = verifiedLoopFromStore(store);
    expect(items).toMatchObject([{
      id: "executive:" + ID, effect: "verified", impact: "unknown", usefulness: "helpful",
    }]);
    expect(summarizeVerifiedLoop(items)).toMatchObject({ verifiedEffects: 1, helpfulReviews: 1, notHelpfulReviews: 0, unknownImpact: 1 });

    expect(recordExplicitOutcomeReview(store, { decisionId: ID, verdict: "not_helpful", at: AT })).toBe("recorded");
    expect(outcomeReviews(store).get(ID)?.verdict).toBe("not_helpful");
    expect(recordExplicitOutcomeReview(store, { decisionId: ID, verdict: "helpful", at: AT })).toBe("recorded");
    expect(outcomeReviews(store).get(ID)?.verdict).toBe("helpful");
    expect(store.readSource(OUTCOME_REVIEW_SOURCE)).toHaveLength(3);
    items = verifiedLoopFromStore(store);
    expect(items[0]?.impact).toBe("unknown"); // A rating is not measured impact.
    expect(items[0]?.effect).toBe("verified"); // Nor does it change source verification.
  });

  it("survives restart, but source erasure removes the card and blocks any new review", () => {
    put();
    expect(recordExplicitOutcomeReview(store, { decisionId: ID, verdict: "not_helpful", at: AT })).toBe("recorded");
    store.close();
    store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    expect(outcomeReviews(store).get(ID)?.verdict).toBe("not_helpful");
    store.eraseSource("executive.cycle");
    expect(outcomeReviewCandidates(store, AT)).toEqual([]);
    expect(recordExplicitOutcomeReview(store, { decisionId: ID, verdict: "helpful", at: AT })).toBe("not_eligible");
    expect(verifiedLoopFromStore(store)).toEqual([]);
  });

  it("refuses a guessed id, a malformed verdict and future-dated feedback", () => {
    put();
    expect(recordExplicitOutcomeReview(store, { decisionId: "f".repeat(32), verdict: "helpful", at: AT })).toBe("not_eligible");
    expect(recordExplicitOutcomeReview(store, { decisionId: ID, verdict: "approve" as never, at: AT })).toBe("not_eligible");
    expect(recordExplicitOutcomeReview(store, { decisionId: ID, verdict: "helpful", at: new Date("2026-11-21T08:00:00Z") })).toBe("not_eligible");
  });
});
