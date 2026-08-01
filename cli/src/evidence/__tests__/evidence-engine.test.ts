import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capability-registry.js";
import { EvidenceEngine } from "../evidence-engine.js";
import type { CapabilityAdapter, EvidenceItem } from "../types.js";

function result(capability: string, backend: string): EvidenceItem {
  return {
    id: `${capability}-1`,
    capability,
    backend,
    kind: "discussion",
    content: "Developers are discussing the tradeoffs.",
    locator: `https://example.com/${capability}/1`,
    sourceItemId: "1",
    retrievedAt: "2026-07-30T00:00:00.000Z",
    queryLabel: "primary",
    nativeRank: 1,
    localRelevance: 0.9,
    freshness: 0.9,
    sourceQuality: 0.8,
    provenance: [{ capability, backend, queryLabel: "primary", nativeRank: 1, sourceItemId: "1" }],
  };
}

describe("EvidenceEngine", () => {
  it("researches only through healthy capabilities and records missing/auth gaps honestly", async () => {
    const reddit: CapabilityAdapter = {
      id: "reddit-ready",
      capability: "reddit",
      priority: 1,
      operations: ["search"],
      signals: ["discussion"],
      probe: async () => ({ status: "ready" }),
      search: async () => [result("reddit", "reddit-ready")],
    };
    const x: CapabilityAdapter = {
      id: "x-cookie",
      capability: "x",
      priority: 1,
      operations: ["search"],
      signals: ["social"],
      probe: async () => ({ status: "auth_required", reason: "cookies missing" }),
      search: async () => [result("x", "x-cookie")],
    };

    const registry = new CapabilityRegistry([reddit, x], () => new Date("2026-07-30T00:00:00.000Z"));
    const engine = new EvidenceEngine(registry, () => new Date("2026-07-30T00:00:01.000Z"));

    const bundle = await engine.research("what are people saying about Flyd?", "quick");

    expect(bundle.intent).toBe("opinion");
    expect(bundle.evidence).toHaveLength(1);
    expect(bundle.evidence[0].capability).toBe("reddit");
    expect(bundle.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "x", code: "capability_auth_required" }),
      expect.objectContaining({ capability: "youtube", code: "capability_unavailable" }),
    ]));
  });

  it("returns an explicit insufficient-evidence gap when every search returns empty", async () => {
    const web: CapabilityAdapter = {
      id: "web",
      capability: "web",
      priority: 1,
      operations: ["search"],
      signals: ["reference"],
      probe: async () => ({ status: "ready" }),
      search: async () => [],
    };
    const registry = new CapabilityRegistry([web]);
    const engine = new EvidenceEngine(registry);

    const bundle = await engine.research("what happened?", "quick");

    expect(bundle.evidence).toHaveLength(0);
    expect(bundle.gaps.some((gap) => gap.code === "insufficient_evidence")).toBe(true);
  });
});
