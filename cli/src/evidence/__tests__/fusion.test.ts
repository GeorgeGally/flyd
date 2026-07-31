import { describe, expect, it } from "vitest";
import { fuseEvidence } from "../fusion.js";
import type { EvidenceItem, EvidenceStream, QueryPlan } from "../types.js";

function item(overrides: Partial<EvidenceItem> & Pick<EvidenceItem, "id" | "capability" | "backend" | "sourceItemId" | "queryLabel" | "nativeRank">): EvidenceItem {
  return {
    id: overrides.id,
    capability: overrides.capability,
    backend: overrides.backend,
    kind: overrides.kind ?? "discussion",
    title: overrides.title,
    content: overrides.content ?? overrides.id,
    locator: overrides.locator,
    sourceItemId: overrides.sourceItemId,
    retrievedAt: overrides.retrievedAt ?? "2026-07-30T00:00:00.000Z",
    publishedAt: overrides.publishedAt,
    author: overrides.author,
    queryLabel: overrides.queryLabel,
    nativeRank: overrides.nativeRank,
    localRelevance: overrides.localRelevance ?? 0.8,
    freshness: overrides.freshness ?? 0.8,
    sourceQuality: overrides.sourceQuality ?? 0.7,
    engagement: overrides.engagement,
    metadata: overrides.metadata,
    provenance: overrides.provenance ?? [{
      capability: overrides.capability,
      backend: overrides.backend,
      queryLabel: overrides.queryLabel,
      nativeRank: overrides.nativeRank,
      sourceItemId: overrides.sourceItemId,
      locator: overrides.locator,
    }],
  };
}

const plan: QueryPlan = {
  query: "agent memory",
  intent: "opinion",
  depth: "quick",
  sourceWeights: { reddit: 1, x: 0.9, web: 0.8 },
  subqueries: [],
  maxResults: 10,
  maxPerStream: 10,
};

describe("fuseEvidence", () => {
  it("deduplicates the same URL across streams and preserves both provenance paths", () => {
    const streams: EvidenceStream[] = [
      {
        label: "primary",
        capability: "reddit",
        weight: 1,
        items: [item({
          id: "reddit-1",
          capability: "reddit",
          backend: "reddit-a",
          sourceItemId: "r1",
          queryLabel: "primary",
          nativeRank: 1,
          locator: "https://www.example.com/story?utm_source=reddit",
        })],
      },
      {
        label: "secondary",
        capability: "web",
        weight: 0.8,
        items: [item({
          id: "web-1",
          capability: "web",
          backend: "web-a",
          sourceItemId: "w1",
          queryLabel: "secondary",
          nativeRank: 2,
          locator: "https://example.com/story",
        })],
      },
    ];

    const fused = fuseEvidence(streams, plan);

    expect(fused).toHaveLength(1);
    expect(fused[0].capabilities).toEqual(expect.arrayContaining(["reddit", "web"]));
    expect(fused[0].provenance).toHaveLength(2);
  });

  it("caps repeated authors so one loud account cannot dominate the pool", () => {
    const noisy = Array.from({ length: 5 }, (_, index) => item({
      id: `x-${index}`,
      capability: "x",
      backend: "twitter-cli",
      sourceItemId: `x-${index}`,
      queryLabel: "primary",
      nativeRank: index + 1,
      author: "same-author",
      locator: `https://x.com/same/status/${index}`,
    }));
    const other = item({
      id: "reddit-other",
      capability: "reddit",
      backend: "reddit",
      sourceItemId: "other",
      queryLabel: "primary",
      nativeRank: 1,
      author: "other-author",
      locator: "https://reddit.com/r/test/comments/other",
    });

    const fused = fuseEvidence([
      { label: "primary", capability: "x", weight: 1, items: noisy },
      { label: "primary", capability: "reddit", weight: 1, items: [other] },
    ], { ...plan, sourceWeights: { x: 1, reddit: 1 } });

    expect(fused.filter((candidate) => candidate.author === "same-author")).toHaveLength(3);
    expect(fused.some((candidate) => candidate.author === "other-author")).toBe(true);
  });

  it("rewards evidence that appears in multiple independent streams", () => {
    const repeated = item({
      id: "shared",
      capability: "reddit",
      backend: "reddit",
      sourceItemId: "shared-r",
      queryLabel: "one",
      nativeRank: 2,
      locator: "https://example.com/shared",
    });
    const unique = item({
      id: "unique",
      capability: "reddit",
      backend: "reddit",
      sourceItemId: "unique-r",
      queryLabel: "one",
      nativeRank: 1,
      locator: "https://example.com/unique",
    });
    const repeatedAgain = item({
      id: "shared-web",
      capability: "web",
      backend: "web",
      sourceItemId: "shared-w",
      queryLabel: "two",
      nativeRank: 1,
      locator: "https://www.example.com/shared",
    });

    const fused = fuseEvidence([
      { label: "one", capability: "reddit", weight: 1, items: [unique, repeated] },
      { label: "two", capability: "web", weight: 1, items: [repeatedAgain] },
    ], plan);

    expect(fused[0].locator).toContain("shared");
    expect(fused[0].rrfScore).toBeGreaterThan(fused[1].rrfScore);
  });
});
