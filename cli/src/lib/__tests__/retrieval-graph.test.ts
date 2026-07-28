import { describe, it, expect, afterEach } from "vitest";

const originalEnv = process.env.FLYD_GRAPHDISCOVERY_ENABLED;

describe("retrieval augmentWithGraph", () => {
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FLYD_GRAPHDISCOVERY_ENABLED;
    } else {
      process.env.FLYD_GRAPHDISCOVERY_ENABLED = originalEnv;
    }
  });

  it("returns entries unchanged when graphResults is empty", async () => {
    const { augmentWithGraph } = await import("../../lib/retrieval.js");
    const entries = [
      { path: "test.md", body: "test", score: 50, source: "raw" as const, metadata: {} },
    ];
    const result = augmentWithGraph(entries, []);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(50);
  });

  it("boosts score for entries matching graph results", async () => {
    const { augmentWithGraph } = await import("../../lib/retrieval.js");
    const entries = [
      { path: "flyd-test.md", body: "about flyd", score: 50, source: "raw" as const, metadata: {} },
      { path: "other.md", body: "unrelated", score: 50, source: "raw" as const, metadata: {} },
    ];
    const graphResults = [
      { from: "flyd", to: "qmd", rel_type: "uses", confidence: 0.9, source: "body-extraction" },
    ];
    const result = augmentWithGraph(entries, graphResults);
    expect(result[0].score).toBeGreaterThan(50);
    expect(result[1].score).toBe(50);
  });

  it("discovery is disabled when FLYD_GRAPHDISCOVERY_ENABLED=false", async () => {
    process.env.FLYD_GRAPHDISCOVERY_ENABLED = "false";
    const { augmentWithGraph } = await import("../../lib/retrieval.js");
    const entries = [
      { path: "test.md", body: "test", score: 50, source: "raw" as const, metadata: {} },
    ];
    const graphResults = [
      { from: "test", to: "something", rel_type: "relates", confidence: 0.8, source: "frontmatter" },
    ];
    const result = augmentWithGraph(entries, graphResults);
    // Only boost phase runs — no discovery
    expect(result.length).toBeLessThanOrEqual(entries.length + 0);
  });

  it("does not add discovered entries when graph edge leads to nonexistent wiki file", async () => {
    process.env.FLYD_GRAPHDISCOVERY_ENABLED = "true";
    const { augmentWithGraph } = await import("../../lib/retrieval.js");
    const entries = [
      { path: "test.md", body: "test", score: 50, source: "raw" as const, metadata: {} },
    ];
    const graphResults = [
      { from: "test", to: "nonexistent-page-xyz", rel_type: "relates", confidence: 0.8, source: "body-extraction" },
    ];
    const result = augmentWithGraph(entries, graphResults);
    // No new entries added because the neighbor has no wiki page
    expect(result).toHaveLength(1);
  });
});
