import { describe, expect, it, vi } from "vitest";
import { retrieveBrainEvidence } from "../lib/brain-retrieval.js";

function makeEntry(source: "raw" | "wiki", metadata: Record<string, unknown>) {
  return {
    path: source === "wiki" ? "wiki/test/page.md" : "raw/2026-07-01.md",
    body: "test content",
    source,
    score: 80,
    metadata,
    staleness: { daysSince: 0, stale: false, lastUpdated: "2026-07-28" },
  };
}

describe("memoryEpistemicStatus", () => {
  const searchRaw = vi.fn(async () => [] as any[]);
  const searchWiki = vi.fn(() => [] as any[]);
  const searchGraph = vi.fn(() => [] as any[]);

  function callRetrieve(entries: ReturnType<typeof makeEntry>[]) {
    searchRaw.mockResolvedValueOnce(entries.filter(e => e.source === "raw"));
    searchWiki.mockReturnValueOnce(entries.filter(e => e.source === "wiki"));
    return retrieveBrainEvidence("test query", { searchRaw, searchWiki, searchGraph, now: () => new Date("2026-07-28") });
  }

  it("maps wiki status 'canon' to 'verified'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "canon" })]);
    expect(result.matches[0].epistemicStatus).toBe("verified");
  });

  it("maps wiki status 'working' to 'working_assumption'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "working" })]);
    expect(result.matches[0].epistemicStatus).toBe("working_assumption");
  });

  it("maps wiki status 'speculative' to 'speculative'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "speculative" })]);
    expect(result.matches[0].epistemicStatus).toBe("speculative");
  });

  it("maps wiki status 'questioned' to 'questioned'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "questioned" })]);
    expect(result.matches[0].epistemicStatus).toBe("questioned");
  });

  it("maps wiki status 'unresolved' to 'unresolved'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "unresolved" })]);
    expect(result.matches[0].epistemicStatus).toBe("unresolved");
  });

  it("maps wiki status 'contradictory' to 'contradictory'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "contradictory" })]);
    expect(result.matches[0].epistemicStatus).toBe("contradictory");
  });

  it("maps wiki status 'dormant' to 'dormant'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "dormant" })]);
    expect(result.matches[0].epistemicStatus).toBe("dormant");
  });

  it("maps wiki status 'episodic' to 'episodic'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "episodic" })]);
    expect(result.matches[0].epistemicStatus).toBe("episodic");
  });

  it("falls back to 'working_assumption' when wiki entry has no status field", async () => {
    const result = await callRetrieve([makeEntry("wiki", {})]);
    expect(result.matches[0].epistemicStatus).toBe("working_assumption");
  });

  it("falls back to 'working_assumption' for unknown wiki status", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "bogus" })]);
    expect(result.matches[0].epistemicStatus).toBe("working_assumption");
  });

  it("maps raw captures to 'observation'", async () => {
    const result = await callRetrieve([makeEntry("raw", {})]);
    expect(result.matches[0].epistemicStatus).toBe("observation");
  });

  it("maps conversation-index to 'observation'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { type: "conversation-index", status: "canon" })]);
    expect(result.matches[0].epistemicStatus).toBe("observation");
  });

  it("maps promoted:false to 'observation'", async () => {
    const result = await callRetrieve([makeEntry("wiki", { promoted: false, status: "canon" })]);
    expect(result.matches[0].epistemicStatus).toBe("observation");
  });

  it("maps flyd-runtime-task-corrected to 'user_confirmed'", async () => {
    const result = await callRetrieve([makeEntry("raw", { type: "flyd-runtime-task-corrected" })]);
    expect(result.matches[0].epistemicStatus).toBe("user_confirmed");
  });

  it("carries confidenceProfile on retrieved matches", async () => {
    const result = await callRetrieve([makeEntry("wiki", { status: "canon", confidence: 0.9 })]);
    const p = result.matches[0].confidenceProfile;
    expect(p.epistemicConfidence).toBe(0.9);
    expect(p.freshness).toBeGreaterThanOrEqual(0);
    expect(p.interestAffinity).toBe(0);
    expect(p.retrievalUtility).toBe(0.5);
    expect(p.associationStrength).toBe(0);
  });

  it("epistemic confidence matches wiki authority independent of freshness", async () => {
    const oldEntry = makeEntry("wiki", { status: "canon", confidence: 0.9 });
    const result = await callRetrieve([oldEntry]);
    const p = result.matches[0].confidenceProfile;
    expect(p.epistemicConfidence).toBe(0.9);
  });

  it("raw captures have lower default epistemic confidence", async () => {
    const result = await callRetrieve([makeEntry("raw", {})]);
    expect(result.matches[0].confidenceProfile.epistemicConfidence).toBe(0.5);
  });
});
