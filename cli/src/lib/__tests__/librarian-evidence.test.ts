import { describe, expect, it } from "vitest";
import { scoreEvidence } from "../librarian.js";

describe("librarian evidence authority", () => {
  it("does not assign curated-wiki confidence to an unpromoted conversation index", () => {
    const scored = scoreEvidence({
      path: "conversations/session.md",
      body: "George discussed an artwork release.",
      source: "wiki",
      score: 80,
      metadata: { type: "conversation-index", promoted: false },
      staleness: null,
    }, ["artwork", "release"], "What did George discuss about the artwork release?");

    expect(scored.reliabilityWeight).toBe(0.5);
    expect(scored.confidenceProfile.epistemicConfidence).toBe(0.5);
  });

  it("assigns higher epistemic confidence to curated wiki entries", () => {
    const scored = scoreEvidence({
      path: "wiki/preferences/george.md",
      body: "George prefers concise answers.",
      source: "wiki",
      score: 90,
      metadata: { status: "canon", confidence: 0.9 },
      staleness: null,
    }, ["George", "prefers"], "What does George prefer?");

    expect(scored.confidenceProfile.epistemicConfidence).toBe(0.9);
  });

  it("epistemic confidence does not decay with age", () => {
    const entry = {
      path: "wiki/identity/name.md",
      body: "My name is George.",
      source: "wiki" as const,
      score: 95,
      metadata: { status: "canon", confidence: 0.9 },
      staleness: {
        daysSince: 365,
        stale: true,
        veryStale: true,
        lastUpdated: "2025-07-28",
        message: "[stale:365d] Last updated 2025-07-28. Verify currency before trusting.",
      },
    };
    const scored = scoreEvidence(entry, ["name"], "What is my name?");
    expect(scored.confidenceProfile.epistemicConfidence).toBe(0.9);
    expect(scored.confidenceProfile.freshness).toBeLessThan(0.5);
  });

  it("freshness and epistemic confidence are independent", () => {
    const entry = {
      path: "wiki/projects/repo-state.md",
      body: "Current branch is feat/memory-fix.",
      source: "wiki" as const,
      score: 70,
      metadata: { status: "working", confidence: 0.7 },
      staleness: {
        daysSince: 60,
        stale: true,
        veryStale: false,
        lastUpdated: "2026-05-28",
        message: "[potentially-stale:60d] Nothing confirmed since 2026-05-28.",
      },
    };
    const scored = scoreEvidence(entry, ["branch", "current"], "What is the current branch?");
    const p = scored.confidenceProfile;
    expect(p.epistemicConfidence).toBe(0.7);
  });

  it("retrievalUtility is always neutral in this release", () => {
    const scored = scoreEvidence({
      path: "wiki/test.md",
      body: "test",
      source: "wiki",
      score: 50,
      metadata: { confidence: 0.8 },
      staleness: null,
    }, ["test"], "test");
    expect(scored.confidenceProfile.retrievalUtility).toBe(0.5);
  });
});
