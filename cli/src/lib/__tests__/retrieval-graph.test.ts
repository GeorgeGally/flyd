import { describe, it, expect } from "vitest";

describe("retrieval augmentWithGraph", () => {
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
});
