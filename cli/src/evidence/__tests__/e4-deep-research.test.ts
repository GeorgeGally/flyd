import { describe, expect, it } from "vitest";
import { clusterEvidence } from "../clustering.js";
import { extractEvidenceConflicts } from "../contradictions.js";
import {
  evidenceSurfaceIdForResolution,
  finalizeEvidenceSurface,
  parseEvidenceSurfaceRoute,
  publishEvidenceSurface,
  renderEvidenceSurfaceHtml,
} from "../compose-surface.js";
import { evidenceSurfaceUrl, normalizeEvidenceSurfaceUrl } from "../compose-url.js";
import { classifyEvidenceNeed } from "../evidence-need.js";
import { planEvidence } from "../query-planner.js";
import { enrichResolutionPromptWithEvidence } from "../resolution-evidence.js";
import type { EvidenceBundle, EvidenceComposeSurface, RankedEvidence } from "../types.js";

function ranked(
  id: string,
  content: string,
  capability: RankedEvidence["capability"],
  score: number,
  title = "Flyd research",
): RankedEvidence {
  return {
    id,
    capability,
    backend: `${capability}:test`,
    kind: capability === "reddit" ? "discussion" : "reference",
    title,
    content,
    locator: `https://example.com/${id}`,
    sourceItemId: id,
    retrievedAt: "2026-07-30T00:00:00.000Z",
    publishedAt: "2026-07-29T00:00:00.000Z",
    author: `${capability}-author`,
    queryLabel: "primary",
    nativeRank: 1,
    localRelevance: 0.9,
    freshness: 0.9,
    sourceQuality: 0.9,
    provenance: [{ capability, backend: `${capability}:test`, queryLabel: "primary", nativeRank: 1, sourceItemId: id, locator: `https://example.com/${id}` }],
    rrfScore: score,
    capabilities: [capability],
  };
}

function bundle(query: string, evidence: RankedEvidence[]): EvidenceBundle {
  return {
    query,
    intent: "factual",
    generatedAt: "2026-07-30T00:00:00.000Z",
    plan: planEvidence(query, ["web"], "deep"),
    evidence,
    clusters: clusterEvidence(evidence),
    conflicts: [],
    gaps: [],
    capabilityHealth: [],
  };
}

function prompt(intent: string): string {
  return `ROUTE DECISION:\n- Kind: ask_answer\n- Placement: answer_panel\n- Scene: concise_answer\n\nCURRENT CONTEXT:\n- Application: Browser\n- Element value: ""\n- Selected text: ""\n- Sufficiency: semantic\n\nUSER INTENT: "${intent}"\n\nRELEVANT USER GOALS:\n- none\n\nRESOLUTION RULES:\n1. Return JSON.`;
}

describe("E4 deep research", () => {
  it("creates weighted official, community, limitations, alternatives and recent lenses", () => {
    const plan = planEvidence(
      "Compare Flyd with other agent interfaces",
      ["web", "github", "reddit", "x", "hackernews", "youtube", "rss"],
      "deep",
    );
    expect(plan.subqueries.map((query) => query.label)).toEqual([
      "primary", "official", "community", "limitations", "alternatives", "recent",
    ]);
    expect(plan.subqueries.every((query) => query.capabilities.length > 0)).toBe(true);
    expect(plan.maxResults).toBe(60);
  });

  it("clusters corroborating evidence and exposes cross-source diversity", () => {
    const evidence = [
      ranked("a", "Flyd uses a health aware evidence engine for current external research.", "web", 1),
      ranked("b", "The Flyd evidence engine adds current research and provider health checks.", "github", 0.9),
      ranked("c", "Users discuss Flyd voice latency and interface behaviour.", "reddit", 0.7, "Flyd user experience"),
    ];
    const clusters = clusterEvidence(evidence);
    expect(clusters[0].evidenceIds).toEqual(expect.arrayContaining(["a", "b"]));
    expect(clusters[0].sourceDiversity).toBeGreaterThanOrEqual(2);
  });

  it("surfaces opposing independent assertions instead of averaging them", () => {
    const evidence = [
      ranked("positive", "The Flyd evidence engine works and supports current GitHub research.", "github", 1),
      ranked("negative", "The Flyd evidence engine does not support current GitHub research and fails completely.", "reddit", 0.9),
    ];
    const conflicts = extractEvidenceConflicts(evidence);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].left).toBe("positive");
    expect(conflicts[0].right).toBe("negative");
  });

  it("classifies explicit deep work as a composed dossier and publishes a unique target", async () => {
    const evidence = [ranked("a", "Flyd supports live evidence.", "web", 1)];
    const result = await enrichResolutionPromptWithEvidence(
      prompt("Do a deep dive into Flyd evidence"),
      "You are Flyd's resolution engine.",
      {
        researcher: { research: async () => bundle("Flyd evidence", evidence) },
        surfacePublisher: async () => ({ ready: true, surfaceId: "surface-1" }),
        timeoutMs: 100,
      },
    );
    expect(result.decision?.depth).toBe("deep");
    expect(result.decision?.manifestation).toBe("compose");
    expect(result.surfaceId).toBe("surface-1");
    expect(result.prompt).toContain('Return mode "requires_compose"');
    expect(result.prompt).toContain("surfaceSynthesis");
    expect(result.prompt).toContain('"composeUrl": "http://127.0.0.1:3000/surface/surface-1"');
  });

  it("binds concurrent dossiers to their own resolution ids and claims only the requested handoff", async () => {
    const first = await publishEvidenceSurface(bundle(
      "first investigation",
      [ranked("first", "First investigation evidence.", "web", 1)],
    ));
    const second = await publishEvidenceSurface(bundle(
      "second investigation",
      [ranked("second", "Second investigation evidence.", "web", 1)],
    ));
    expect(first.ready).toBe(true);
    expect(second.ready).toBe(true);
    expect(first.surfaceId).not.toBe(second.surfaceId);

    const firstResolution = "11111111-1111-1111-1111-111111111111";
    const secondResolution = "22222222-2222-2222-2222-222222222222";
    finalizeEvidenceSurface(first.surfaceId, JSON.stringify({ resolution_id: firstResolution }));
    finalizeEvidenceSurface(second.surfaceId, JSON.stringify({ resolution_id: secondResolution }));

    expect(evidenceSurfaceIdForResolution(firstResolution)).toBe(first.surfaceId);
    expect(evidenceSurfaceIdForResolution(secondResolution)).toBe(second.surfaceId);

    const directProbe = await fetch(`http://127.0.0.1:3000/surface/${firstResolution}`, {
      method: "HEAD",
      redirect: "manual",
    });
    expect(directProbe.status).toBe(200);

    const compatibilityHandoff = await fetch("http://127.0.0.1:3000/surface", {
      redirect: "manual",
    });
    expect(compatibilityHandoff.status).toBe(302);
    expect(compatibilityHandoff.headers.get("location")).toBe(`/surface/${second.surfaceId}`);

    const historicalLiveness = await fetch("http://127.0.0.1:3000/surface", {
      method: "HEAD",
      redirect: "manual",
    });
    expect(historicalLiveness.status).toBe(404);
  });

  it("accepts only unique Core-owned loopback dossier URLs", () => {
    expect(evidenceSurfaceUrl("abc-123")).toBe("http://127.0.0.1:3000/surface/abc-123");
    expect(normalizeEvidenceSurfaceUrl("http://127.0.0.1:3000/surface/abc-123")).toBe("http://127.0.0.1:3000/surface/abc-123");
    expect(normalizeEvidenceSurfaceUrl("https://evil.example/surface/abc-123")).toBe("http://127.0.0.1:3000/surface");
    expect(normalizeEvidenceSurfaceUrl("http://user:pass@127.0.0.1:3000/surface/abc-123")).toBe("http://127.0.0.1:3000/surface");
  });

  it("never treats unrelated browser requests as dossier handoffs", () => {
    expect(parseEvidenceSurfaceRoute("/surface")).toEqual({ kind: "handoff" });
    expect(parseEvidenceSurfaceRoute("/surface/")).toEqual({ kind: "handoff" });
    expect(parseEvidenceSurfaceRoute("/surface/ABC-123")).toEqual({ kind: "surface", surfaceId: "abc-123" });
    expect(parseEvidenceSurfaceRoute("/favicon.ico")).toBeNull();
    expect(parseEvidenceSurfaceRoute("/robots.txt")).toBeNull();
  });

  it("renders an editorial dossier with synthesis, sources and no remote scripts", () => {
    const evidence = [ranked("a", "Flyd supports live evidence.", "web", 1)];
    const surface: EvidenceComposeSurface = {
      kind: "evidence_dossier",
      version: "1.0",
      id: "surface-1",
      query: "Flyd evidence",
      generatedAt: "2026-07-30T00:00:00.000Z",
      clusters: clusterEvidence(evidence),
      conflicts: [],
      evidence,
      gaps: [],
      synthesis: {
        title: "Flyd learns to look outward",
        executiveSummary: "External evidence is now part of the intelligence loop.",
        findings: [{ heading: "Currentness", summary: "Flyd verifies volatile claims.", evidenceIds: ["a"], confidence: "high" }],
        recommendation: "Use deep research for consequential comparisons.",
        uncertainties: ["Long-term source reliability"],
      },
    };
    const html = renderEvidenceSurfaceHtml(surface);
    expect(html).toContain("Flyd learns to look outward");
    expect(html).toContain("Recommended direction");
    expect(html).toContain("Open source");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("<script");
  });

  it("marks the deep classifier decision directly", () => {
    const decision = classifyEvidenceNeed({
      intent: "Build a comprehensive comparison of Flyd and Clicky",
      routeKind: "ask_answer",
      locators: [],
    });
    expect(decision).toMatchObject({ level: "required", depth: "deep", manifestation: "compose" });
  });
});
