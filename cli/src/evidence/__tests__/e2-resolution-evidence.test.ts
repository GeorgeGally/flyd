import { describe, expect, it, vi } from "vitest";
import { enrichResolutionPromptWithEvidence } from "../resolution-evidence.js";
import type { EvidenceBundle } from "../types.js";

const SYSTEM = "You are Flyd's resolution engine. You convert user intents into executable operations.";

function prompt(intent: string): string {
  return `ROUTE DECISION:
- Kind: ask_answer
- Placement: answer_panel
- Scene: concise_answer

CURRENT CONTEXT:
- Application: Browser
- Element value: ""
- Selected text: ""
- Sufficiency: semantic

USER INTENT: "${intent}"

RELEVANT USER GOALS:
- none

RESOLUTION RULES:
1. Return JSON.`;
}

function bundle(): EvidenceBundle {
  return {
    query: "latest Flyd release",
    intent: "breaking_news",
    generatedAt: "2026-07-30T07:00:00.000Z",
    plan: {
      query: "latest Flyd release",
      intent: "breaking_news",
      depth: "quick",
      sourceWeights: { github: 1 },
      subqueries: [],
      maxResults: 12,
      maxPerStream: 6,
    },
    evidence: [{
      id: "ev-1",
      capability: "github",
      backend: "github:rest",
      kind: "release",
      title: "Flyd v2",
      content: "The release adds live evidence retrieval.",
      locator: "https://github.com/example/flyd/releases/tag/v2",
      sourceItemId: "release-2",
      retrievedAt: "2026-07-30T07:00:00.000Z",
      publishedAt: "2026-07-30T06:00:00.000Z",
      author: "example",
      queryLabel: "primary",
      nativeRank: 1,
      localRelevance: 1,
      freshness: 1,
      sourceQuality: 0.98,
      provenance: [{
        capability: "github",
        backend: "github:rest",
        queryLabel: "primary",
        nativeRank: 1,
        sourceItemId: "release-2",
        locator: "https://github.com/example/flyd/releases/tag/v2",
      }],
      rrfScore: 0.02,
      capabilities: ["github"],
    }],
    conflicts: [],
    gaps: [],
    capabilityHealth: [],
  };
}

describe("E2 resolution evidence enrichment", () => {
  it("injects live evidence before resolution rules", async () => {
    const research = vi.fn(async () => bundle());
    const result = await enrichResolutionPromptWithEvidence(
      prompt("What is the latest Flyd release?"),
      SYSTEM,
      { researcher: { research } },
    );

    expect(research).toHaveBeenCalledOnce();
    expect(result.prompt).toContain("EXTERNAL EVIDENCE");
    expect(result.prompt).toContain("Flyd v2");
    expect(result.prompt.indexOf("EXTERNAL EVIDENCE")).toBeLessThan(result.prompt.indexOf("RESOLUTION RULES"));
  });

  it("does not retrieve for stable conceptual questions", async () => {
    const research = vi.fn(async () => bundle());
    const original = prompt("Explain the concept of reciprocal rank fusion");
    const result = await enrichResolutionPromptWithEvidence(original, SYSTEM, { researcher: { research } });

    expect(research).not.toHaveBeenCalled();
    expect(result.prompt).toBe(original);
  });

  it("fails closed when required evidence exceeds the latency budget", async () => {
    const research = vi.fn(() => new Promise<EvidenceBundle>(() => {}));
    const result = await enrichResolutionPromptWithEvidence(
      prompt("What is the latest Flyd release?"),
      SYSTEM,
      { researcher: { research }, timeoutMs: 5 },
    );

    expect(result.timedOut).toBe(true);
    expect(result.prompt).toContain("could not be retrieved");
    expect(result.prompt).toContain("Do not answer the time-sensitive");
  });

  it("ignores non-resolution model calls", async () => {
    const research = vi.fn(async () => bundle());
    const original = prompt("What is the latest Flyd release?");
    const result = await enrichResolutionPromptWithEvidence(original, "You are a general writer.", { researcher: { research } });

    expect(research).not.toHaveBeenCalled();
    expect(result.prompt).toBe(original);
  });
});
