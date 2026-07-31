import { describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "../capability-registry.js";
import { EvidenceEngine } from "../evidence-engine.js";
import type { CapabilityAdapter, EvidenceItem } from "../types.js";

function item(capability: string, locator: string): EvidenceItem {
  return {
    id: `${capability}-1`,
    capability,
    backend: `${capability}:fake`,
    kind: capability === "github" ? "code" : "reference",
    title: "Direct source",
    content: "Fresh direct source content",
    locator,
    sourceItemId: "source-1",
    retrievedAt: "2026-07-30T07:00:00.000Z",
    queryLabel: "direct_read",
    nativeRank: 1,
    localRelevance: 1,
    freshness: 1,
    sourceQuality: 0.9,
    provenance: [{
      capability,
      backend: `${capability}:fake`,
      queryLabel: "direct_read",
      nativeRank: 1,
      sourceItemId: "source-1",
      locator,
    }],
  };
}

function readAdapter(capability: string, read: CapabilityAdapter["read"]): CapabilityAdapter {
  return {
    id: `${capability}:fake`,
    capability,
    priority: 1,
    operations: ["read"],
    signals: ["reference"],
    probe: async () => ({ status: "ready" }),
    read,
  };
}

describe("E2 direct reads", () => {
  it("routes GitHub locators to github.read without search", async () => {
    const read = vi.fn(async ({ locator }: { locator: string }) => [item("github", locator)]);
    const engine = new EvidenceEngine(new CapabilityRegistry([readAdapter("github", read)]));

    const result = await engine.research("Would Flyd use this?", "quick", {
      locators: ["https://github.com/example/reach"],
      includeSearch: false,
    });

    expect(read).toHaveBeenCalledOnce();
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].capability).toBe("github");
    expect(result.gaps).toEqual([]);
  });

  it("routes ordinary pages to web.read", async () => {
    const read = vi.fn(async ({ locator }: { locator: string }) => [item("web", locator)]);
    const engine = new EvidenceEngine(new CapabilityRegistry([readAdapter("web", read)]));

    const result = await engine.research("Summarize this page", "quick", {
      locators: ["https://example.com/article"],
      includeSearch: false,
    });

    expect(read).toHaveBeenCalledOnce();
    expect(result.evidence[0].capability).toBe("web");
  });

  it("records an explicit gap when a direct reader is unavailable", async () => {
    const engine = new EvidenceEngine(new CapabilityRegistry());
    const result = await engine.research("What is this?", "quick", {
      locators: ["https://example.com/article"],
      includeSearch: false,
    });

    expect(result.evidence).toEqual([]);
    expect(result.gaps.some((gap) => gap.capability === "web")).toBe(true);
    expect(result.gaps.some((gap) => gap.code === "insufficient_evidence")).toBe(true);
  });
});
