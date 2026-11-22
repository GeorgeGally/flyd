import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntelligenceEventStore } from "../event-store.js";
import { persistExecutiveDecision, EXECUTIVE_DECISION_VERSION } from "../executive/decision-step.js";
import { outcomeReviews, recordExplicitOutcomeReview } from "../outcomes/outcome-review.js";
import { negativeOutcomeReviewPatterns } from "../outcomes/review-improvement.js";
import { OUTCOME_REVIEW_LEARNING_CONTRACT, SourceContractRegistry } from "../sensors/source-contracts.js";
import { gatherEvidence } from "../../crew/self-improve.js";

const NOW = new Date("2026-11-22T12:00:00Z");
let home: string;
let store: IntelligenceEventStore;

function seed(count: number, sourceId = "firstmate.task", base = 0): string[] {
  const ids: string[] = [];
  for (let i = base; i < base + count; i++) {
    const decisionId = (i + 1).toString(16).padStart(32, "0");
    ids.push(decisionId);
    expect(persistExecutiveDecision(store, {
      schema: EXECUTIVE_DECISION_VERSION, decisionId, sourceId,
      sourceEventId: "event-" + i, reason: "Independent verification",
      summary: "An internally verified private outcome " + i,
      evidenceRefs: ["task:" + i],
      verification: { status: "verified", evidenceRefs: ["github-merge:" + i] },
      disposition: "handle_internally", show: true, notify: false,
      createdAt: "2026-11-21T09:00:00Z",
    })).not.toBeNull();
    expect(recordExplicitOutcomeReview(store, {
      decisionId, verdict: "not_helpful",
      at: new Date("2026-11-22T11:00:00Z"),
    })).toBe("recorded");
  }
  return ids;
}
function patterns() {
  return negativeOutcomeReviewPatterns(store, {
    since: "2026-11-10T00:00:00Z", now: NOW,
  });
}
function reviewedImprovementEvidence() {
  return gatherEvidence({ flydDir: home, now: NOW })
    .filter((item) => item.kind === "review" && item.id.startsWith("review-cluster:"));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-review-learning-"));
  vi.stubEnv("FLYD_CREW_DIR", join(home, "crew"));
  vi.stubEnv("FLYD_COMMAND_DIR", join(home, "command"));
  vi.stubEnv("FLYD_JOURNAL_DIR", join(home, "journal"));
  vi.stubEnv("FLYD_ADVISORIES_PATH", join(home, "advisories.jsonl"));
  vi.stubEnv("FLYD_SELF_IMPROVE_DIR", join(home, "self-improve"));
  store = new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") });
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("opt-in usefulness learning", () => {
  it("needs at least three distinct verified dislikes in the same workflow and policy", () => {
    seed(2);
    expect(patterns()).toHaveLength(0);
    seed(1, "other.source", 2);
    expect(patterns()).toHaveLength(0);
    const [third] = seed(1, "firstmate.task", 3);
    expect(patterns()).toMatchObject([{
      id: expect.stringMatching(/^review-cluster:[a-f0-9]{16}:3$/),
      kind: "review",
      at: "2026-11-22T11:00:00Z",
      text: expect.stringContaining("at least 3"),
    }]);
    expect(JSON.stringify(patterns())).not.toContain("An internally verified private outcome");
    expect(JSON.stringify(patterns())).not.toContain("firstmate.task");
    expect(recordExplicitOutcomeReview(store, {
      decisionId: third!, verdict: "helpful", at: NOW,
    })).toBe("recorded");
    expect(outcomeReviews(store).get(third!)?.verdict).toBe("helpful");
    expect(patterns()).toHaveLength(0);
  });

  it("never enters improvement evidence before explicit LEARN consent, and retracts on disable and erasure", () => {
    seed(3);
    // Even three user dislikes do not authorize a provider learning prompt.
    expect(reviewedImprovementEvidence()).toHaveLength(0);
    const registry = new SourceContractRegistry({ path: join(home, "intelligence", "source-consents.json") });
    registry.register(OUTCOME_REVIEW_LEARNING_CONTRACT);
    expect(registry.status(OUTCOME_REVIEW_LEARNING_CONTRACT.sourceId)).toBe("disabled");
    registry.setStatus(OUTCOME_REVIEW_LEARNING_CONTRACT.sourceId, "enabled");
    expect(reviewedImprovementEvidence()).toMatchObject([{
      kind: "review", text: expect.stringContaining("human"),
    }]);
    registry.setStatus(OUTCOME_REVIEW_LEARNING_CONTRACT.sourceId, "disabled");
    expect(reviewedImprovementEvidence()).toHaveLength(0);
    registry.setStatus(OUTCOME_REVIEW_LEARNING_CONTRACT.sourceId, "enabled");
    store.eraseSource("executive.cycle");
    expect(reviewedImprovementEvidence()).toHaveLength(0);
  });

  it("does not count three repeated ratings of the same verified result as three cases", () => {
    const [id] = seed(1);
    for (const verdict of ["helpful", "not_helpful", "helpful", "not_helpful"] as const) {
      recordExplicitOutcomeReview(store, { decisionId: id!, verdict, at: NOW });
    }
    expect(patterns()).toEqual([]);
    expect(outcomeReviews(store).get(id!)?.verdict).toBe("not_helpful");
  });
});
