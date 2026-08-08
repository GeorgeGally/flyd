import { describe, expect, it, vi } from "vitest";
import { buildMemoryPack, buildResolutionPrompt } from "../resolve.js";
import { gateLearningCandidate } from "../memory-gate.js";
import { createLearningReceipt } from "../memory-receipt.js";
import { suppressContradictedMemories, gateCurrentness, type ContradictionSignal } from "../lib/currentness-gate.js";
import type { ScoredEvidence } from "../lib/librarian.js";

const retrieveResilientLexicalBrainEvidence = vi.fn();

vi.mock("../lib/brain-retrieval.js", () => ({
  get retrieveResilientLexicalBrainEvidence() { return retrieveResilientLexicalBrainEvidence; },
}));

const emptyWorldState = {
  version: "1.0" as const, source: "flyd-cli" as const, generatedAt: "",
  goals: [], tensions: [], signals: [], curiosity: [], nudges: [],
  profile: [], knowledge: [], reports: [], capabilities: [],
  recentEvents: [], brainHealth: [], review: [], suggestions: [],
};

const env = {
  application: { bundle_id: "com.test", name: "Test" },
  window: { title: "", ref: "win_01" },
  focused_element: { ref: "el_01", role: "AXTextArea", description: "", value: "", placeholder: "", selected_text: "" },
  selection: "", sufficiency: "semantic" as const,
};

function mkMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: `memory_match:${Math.random().toString(36).slice(2, 8)}`,
    type: "memory_match" as const,
    source: "cli.retrieval" as const,
    epistemicStatus: "observation",
    confidence: 0.7,
    confidenceProfile: { epistemicConfidence: 0.5, freshness: 1, interestAffinity: 0, retrievalUtility: 0.5, associationStrength: 0 },
    generatedAt: "2026-07-28T00:00:00Z",
    evidenceRefs: [],
    content: { path: "raw/test.md", archive: "raw" as const, excerpt: "test", retrievalScore: 70, recencyWeight: 1, reliabilityWeight: 0.5, corroborationCount: 0, stale: false, lastUpdated: null },
    ...overrides,
  };
}

describe("memory pipeline integration", () => {
  it("preserves epistemic status through full pipeline", async () => {
    retrieveResilientLexicalBrainEvidence.mockResolvedValueOnce({
      version: "1.0", source: "flyd-cli", query: "test", generatedAt: "",
      sufficiency: { verdict: "sufficient", reason: "" },
      matches: [
        mkMatch({ epistemicStatus: "verified", content: { ...mkMatch().content, excerpt: "George prefers concise answers." }, confidenceProfile: { ...mkMatch().confidenceProfile, epistemicConfidence: 0.9 } }),
        mkMatch({ epistemicStatus: "speculative", content: { ...mkMatch().content, excerpt: "Flyd deploys via Cloudflare Pages." }, confidenceProfile: { ...mkMatch().confidenceProfile, epistemicConfidence: 0.3 } }),
      ],
    });
    const pack = await buildMemoryPack("test", env);
    expect(pack.relevant).toHaveLength(2);
    expect(pack.relevant[0].epistemicStatus).toBe("verified");
    expect(pack.relevant[0].epistemicConfidence).toBe(0.9);
    expect(pack.relevant[1].epistemicStatus).toBe("speculative");
  });

  it("groups contradictory claims into conflict pairs", async () => {
    retrieveResilientLexicalBrainEvidence.mockResolvedValueOnce({
      version: "1.0", source: "flyd-cli", query: "test", generatedAt: "",
      sufficiency: { verdict: "conflicting", reason: "" },
      matches: [
        mkMatch({ epistemicStatus: "contradictory", content: { ...mkMatch().content, excerpt: "Flyd uses dynamic cards." } }),
        mkMatch({ epistemicStatus: "contradictory", content: { ...mkMatch().content, excerpt: "Flyd uses text-only interaction." } }),
      ],
    });
    const pack = await buildMemoryPack("test", env);
    expect(pack.conflicts.length).toBeGreaterThan(0);
    expect(pack.relevant.every(c => c.epistemicStatus === "contradictory")).toBe(true);
  });

  it("resolution prompt formats epistemic status labels", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "test", { kind: "ask_answer", placement: "answer_panel", scene: "concise_answer" }, {
      current: [], conflicts: [], gaps: [], sources: [],
      relevant: [
        { claimId: "1", content: "George prefers concise answers.", kind: "preference", scope: "global", epistemicStatus: "verified", epistemicConfidence: 0.9, freshness: 0.9, sourceRefs: [], relevance: 0.9 },
        { claimId: "2", content: "Flyd may deploy through Cloudflare.", kind: "state", scope: "global", epistemicStatus: "speculative", epistemicConfidence: 0.3, freshness: 0.8, sourceRefs: [], relevance: 0.5 },
      ],
    });
    expect(prompt).toContain("[verified · high confidence]");
    expect(prompt).toContain("[speculative · low confidence]");
  });

  it("shows memory status when nothing retrieved and no bundles", () => {
    const prompt = buildResolutionPrompt(emptyWorldState, env, "test", { kind: "ask_answer", placement: "answer_panel", scene: "concise_answer" });
    expect(prompt).toContain("MEMORY STATUS");
    expect(prompt).toContain("NEVER claim you lack access");
  });
});

describe("closeout → learning promotion → memory retrieval pipeline", () => {
  it("promotes a correction with provenance through the full pipeline", () => {
    const candidate = {
      id: "candidate-1",
      source: "correction" as const,
      content: "User prefers dark mode",
      domain: "response_style",
      outcomeRef: "outcome-123",
      epistemicConfidence: "high" as const,
      timestamp: new Date().toISOString(),
    };

    const gateResult = gateLearningCandidate(candidate);
    expect(gateResult.shouldRemember).toBe(true);

    const receipt = createLearningReceipt(candidate, gateResult.reason, candidate.domain);
    expect(receipt.provenance.epistemicConfidence).toBe("high");
    expect(receipt.provenance.sourceType).toBe("correction");
    expect(receipt.provenance.outcomeRef).toBe("outcome-123");
    expect(receipt.source).toBe("flyd-work-intelligence");
  });

  it("rejects low-confidence candidates from the pipeline", () => {
    const candidate = {
      id: "candidate-2",
      source: "durable_decision" as const,
      content: "Deploy through Cloudflare",
      domain: "infrastructure",
      outcomeRef: "outcome-456",
      epistemicConfidence: "low" as const,
      timestamp: new Date().toISOString(),
    };

    const gateResult = gateLearningCandidate(candidate);
    expect(gateResult.shouldRemember).toBe(false);
  });

  it("contradicted memory is suppressed but not rewritten", () => {
    const entry: ScoredEvidence = {
      path: "wiki/projects/flyd.md",
      body: "flyd uses dynamic cards for its UI",
      source: "wiki",
      score: 85,
      metadata: {},
      staleness: null,
      librarianScore: 0.85,
      recencyWeight: 0.8,
      reliabilityWeight: 0.8,
      interestBoost: 0,
      corroborationCount: 0,
      contradictionCount: 0,
      isCurrent: true,
      confidenceProfile: {
        epistemicConfidence: 0.9,
        freshness: 0.9,
        interestAffinity: 0,
        retrievalUtility: 0.5,
        associationStrength: 0,
      },
    };

    const contradictions: ContradictionSignal[] = [{
      claim: "dynamic cards",
      contradictingEvidence: "flyd uses text-only interaction",
      source: "repository",
      timestamp: new Date().toISOString(),
    }];

    const originalConfidence = entry.confidenceProfile.epistemicConfidence;
    const result = suppressContradictedMemories([entry], contradictions);

    expect(result[0].isCurrent).toBe(false);
    expect(result[0].confidenceProfile.epistemicConfidence).toBe(originalConfidence);
  });

  it("project-scoped memory retrieval respects currentness gating", () => {
    const presentModel = {
      generatedAt: new Date().toISOString(),
      repository: {
        root: "/Users/george/flyd",
        name: "flyd",
        remote: null,
        branch: "main",
        head: "abc123",
        dirty: false,
        statusLines: [" M cli/src/resolve.ts"],
        statusDigest: "digest",
      },
      activeTask: null,
      recentCommits: [],
      gaps: [],
    };

    const inScopeEntry: ScoredEvidence = {
      path: "wiki/projects/flyd.md",
      body: "Working on resolve.ts changes",
      source: "wiki",
      score: 85,
      metadata: {},
      staleness: null,
      librarianScore: 0.85,
      recencyWeight: 0.8,
      reliabilityWeight: 0.8,
      interestBoost: 0,
      corroborationCount: 0,
      contradictionCount: 0,
      confidenceProfile: {
        epistemicConfidence: 0.9,
        freshness: 0.9,
        interestAffinity: 0,
        retrievalUtility: 0.5,
        associationStrength: 0,
      },
    };

    const outOfScopeEntry: ScoredEvidence = {
      path: "wiki/projects/other-repo.md",
      body: "Notes about an unrelated project",
      source: "wiki",
      score: 75,
      metadata: {},
      staleness: null,
      librarianScore: 0.75,
      recencyWeight: 0.6,
      reliabilityWeight: 0.6,
      interestBoost: 0,
      corroborationCount: 0,
      contradictionCount: 0,
      confidenceProfile: {
        epistemicConfidence: 0.8,
        freshness: 0.3,
        interestAffinity: 0,
        retrievalUtility: 0.5,
        associationStrength: 0,
      },
    };

    const currentPaths = gateCurrentness(
      [inScopeEntry, outOfScopeEntry],
      presentModel,
      { kind: "current_state", confidence: 0.9, reasons: [] }
    );

    expect(currentPaths.has(inScopeEntry.path)).toBe(true);
    expect(currentPaths.has(outOfScopeEntry.path)).toBe(false);
  });
});
