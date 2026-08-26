import { describe, expect, it } from "vitest";
import { scoreEvidence, applyVerification, type ScoredEvidence } from "../librarian.js";
import type { VerificationResult } from "../librarian-verifier.js";

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

describe("applyVerification blend", () => {
  function makeScored(entryOverrides: Partial<Parameters<typeof scoreEvidence>[0]> = {}): ScoredEvidence {
    return scoreEvidence({
      path: "wiki/projects/flyd.md",
      body: "An entry about memory ranking internals.",
      source: "wiki",
      score: 80,
      metadata: { status: "canon", confidence: 0.9 },
      staleness: null,
      ...entryOverrides,
    }, ["unrelated", "terms"], "What about something else?");
  }

  function makeVerification(
    verdicts: Array<{ path: string; relevant: boolean; reason?: string }>,
    conflicts: VerificationResult["conflicts"] = [],
  ): VerificationResult {
    return {
      verified: true,
      verdicts: new Map(verdicts.map((v) => [v.path, { relevant: v.relevant, reason: v.reason ?? "" }])),
      sufficiency: { verdict: "partial", reason: "", coverage: 0 },
      conflicts,
    };
  }

  it("a relevant verdict replaces the keyword-density term at full weight", () => {
    const scored = [makeScored()];
    const blended = applyVerification(scored, makeVerification([
      { path: "wiki/projects/flyd.md", relevant: true, reason: "Direct answer." },
    ]));

    const p = blended[0].confidenceProfile;
    const expected = Math.round(Math.min(
      1,
      p.epistemicConfidence * 0.25 + p.freshness * 0.25 + 0.25 + p.interestAffinity * 0.15 + p.associationStrength * 0.10,
    ) * 100) / 100;
    expect(blended[0].librarianScore).toBe(expected);
    expect(blended[0].librarianScore).toBeGreaterThan(scored[0].librarianScore);
  });

  it("an irrelevant verdict caps the relevance term low instead of zeroing it", () => {
    const scored = [makeScored()];
    const blended = applyVerification(scored, makeVerification([
      { path: "wiki/projects/flyd.md", relevant: false, reason: "Off topic." },
    ]));

    expect(blended[0].librarianScore).toBeLessThan(scored[0].librarianScore);
    expect(blended[0].verifiedRelevance).toBe(false);
  });

  it("entries without a verdict keep the pure heuristic score", () => {
    const scored = [makeScored(), makeScored({ path: "wiki/entries/other.md" })];
    const other = scored[1];
    const blended = applyVerification([scored[0], other], makeVerification([
      { path: "wiki/projects/flyd.md", relevant: true },
    ]));

    expect(blended[1].librarianScore).toBe(other.librarianScore);
    expect(blended[1].verifiedRelevance).toBeUndefined();
  });

  it("verified conflicts increment contradictionCount on both entries", () => {
    const a = { ...makeScored() };
    const b = { ...makeScored(), path: "wiki/skills/swift.md" };
    const blended = applyVerification([a, b], makeVerification([], [
      { a: a.path, b: b.path, reason: "disagree on primary language" },
    ]));

    expect(blended.find((e) => e.path === a.path)?.contradictionCount).toBe(1);
    expect(blended.find((e) => e.path === b.path)?.contradictionCount).toBe(1);
  });

  it("surfaces the verifier reason on the entry", () => {
    const blended = applyVerification([makeScored()], makeVerification([
      { path: "wiki/projects/flyd.md", relevant: true, reason: "Directly describes the mechanism." },
    ]));

    expect(blended[0].verifierReason).toBe("Directly describes the mechanism.");
  });

  it("verified conflicts penalize epistemic confidence with the staler side hit harder", () => {
    const fresher = makeScored({
      path: "wiki/skills/swift.md",
      body: "Swift is my main language now.",
      staleness: { daysSince: 5, stale: false, veryStale: false, lastUpdated: "2026-08-21", message: "" },
    });
    const staler = makeScored({
      path: "wiki/skills/ruby.md",
      body: "Ruby is my main language.",
      staleness: { daysSince: 300, stale: true, veryStale: true, lastUpdated: "2025-10-30", message: "[stale]" },
    });
    const blended = applyVerification([fresher, staler], makeVerification([
      { path: fresher.path, relevant: true },
      { path: staler.path, relevant: true },
    ], [
      { a: fresher.path, b: staler.path, reason: "disagree on primary language" },
    ]));

    const freshEntry = blended.find((e) => e.path === fresher.path)!;
    const staleEntry = blended.find((e) => e.path === staler.path)!;
    expect(freshEntry.confidenceProfile.epistemicConfidence).toBeGreaterThan(staleEntry.confidenceProfile.epistemicConfidence);
    expect(freshEntry.librarianScore).toBeGreaterThan(staleEntry.librarianScore);
    expect(freshEntry.confidenceProfile.epistemicConfidence).toBeLessThan(0.9);
    expect(staleEntry.confidenceProfile.epistemicConfidence).toBeLessThan(freshEntry.confidenceProfile.epistemicConfidence);
  });

  it("returns entries unchanged when verification did not verify", () => {
    const scored = [makeScored()];
    const result: VerificationResult = {
      verified: false,
      verdicts: new Map(),
      sufficiency: { verdict: "insufficient", reason: "", coverage: 0 },
      conflicts: [],
    };

    const blended = applyVerification(scored, result);
    expect(blended[0].librarianScore).toBe(scored[0].librarianScore);
  });
});
