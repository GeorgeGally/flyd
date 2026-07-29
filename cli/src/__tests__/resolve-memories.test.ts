import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMemoryPack } from "../resolve.js";
import type { BrainRetrievalResult } from "../lib/brain-retrieval.js";

const retrieveResilientLexicalBrainEvidence = vi.fn(async (query: string): Promise<BrainRetrievalResult> => ({
  version: "1.0",
  source: "flyd-cli",
  query,
  generatedAt: "2026-07-28T00:00:00Z",
  sufficiency: { verdict: "sufficient", reason: "", coverage: 1 },
  matches: [
    {
      id: "memory_match:abc",
      type: "memory_match",
      source: "cli.retrieval",
      epistemicStatus: "observation",
      confidence: 0.8,
      confidenceProfile: {
        epistemicConfidence: 0.5,
        freshness: 1,
        interestAffinity: 0,
        retrievalUtility: 0.5,
        associationStrength: 0,
      },
      generatedAt: "2026-07-28T00:00:00Z",
      evidenceRefs: [],
      content: {
        path: "raw/2026-07-01.md",
        archive: "raw",
        excerpt: "George is building flyd.",
        retrievalScore: 80,
        recencyWeight: 1,
        reliabilityWeight: 1,
        corroborationCount: 0,
        stale: false,
        lastUpdated: null,
        isCurrent: false,
      },
    },
  ],
}));

vi.mock("../lib/brain-retrieval.js", () => ({
  get retrieveResilientLexicalBrainEvidence() {
    return retrieveResilientLexicalBrainEvidence;
  },
}));

const env = {
  application: { bundle_id: "com.apple.mail", name: "Mail" },
  window: { title: "Inbox", ref: "win_01" },
  focused_element: {
    ref: "el_01",
    role: "AXTextArea",
    description: "Message body",
    value: "",
    placeholder: "",
    selected_text: "",
  },
  selection: "",
  sufficiency: "semantic" as const,
};

beforeEach(() => {
  retrieveResilientLexicalBrainEvidence.mockClear();
});

describe("buildMemoryPack", () => {
  it("searches with the intent only — app name and window title stay out of the query", async () => {
    const pack = await buildMemoryPack("who am I", env);

    expect(retrieveResilientLexicalBrainEvidence).toHaveBeenCalledTimes(1);
    const query = retrieveResilientLexicalBrainEvidence.mock.calls[0][0];
    expect(query).toBe("who am I");
    expect(query).not.toContain("Mail");
    expect(query).not.toContain("Inbox");
    expect(pack.relevant).toHaveLength(1);
    expect(pack.relevant[0].content).toBe("George is building flyd.");
    expect(pack.relevant[0].epistemicStatus).toBe("observation");
    expect(pack.sources).toContain("raw/2026-07-01.md");
  });

  it("returns empty memory pack for an empty intent without searching", async () => {
    const pack = await buildMemoryPack("   ", env);
    expect(pack.relevant).toEqual([]);
    expect(pack.conflicts).toEqual([]);
    expect(pack.gaps).toEqual([]);
    expect(retrieveResilientLexicalBrainEvidence).not.toHaveBeenCalled();
  });

  it("carries epistemic metadata into RetrievedClaims", async () => {
    retrieveResilientLexicalBrainEvidence.mockResolvedValueOnce({
      version: "1.0" as const,
      source: "flyd-cli" as const,
      query: "test",
      generatedAt: "2026-07-28T00:00:00Z",
      sufficiency: { verdict: "sufficient", reason: "", coverage: 1 },
      matches: [{
        id: "memory_match:xyz",
        type: "memory_match" as const,
        source: "cli.retrieval" as const,
        epistemicStatus: "verified" as const,
        confidence: 0.9,
        confidenceProfile: {
          epistemicConfidence: 0.9,
          freshness: 0.85,
          interestAffinity: 0,
          retrievalUtility: 0.5,
          associationStrength: 0,
        },
        generatedAt: "2026-07-28T00:00:00Z",
        evidenceRefs: [],
        content: {
          path: "wiki/preferences/george.md",
          archive: "wiki",
          excerpt: "George prefers concise answers.",
          retrievalScore: 95,
          recencyWeight: 0.9,
          reliabilityWeight: 0.85,
          corroborationCount: 2,
          stale: false,
          lastUpdated: "2026-07-20",
          isCurrent: false,
        },
      }],
    });
    const pack = await buildMemoryPack("George preferences", env);
    expect(pack.relevant[0].epistemicStatus).toBe("verified");
    expect(pack.relevant[0].epistemicConfidence).toBe(0.9);
    expect(pack.relevant[0].freshness).toBe(0.85);
  });

  it("routes matches flagged isCurrent into pack.current instead of pack.relevant", async () => {
    retrieveResilientLexicalBrainEvidence.mockResolvedValueOnce({
      version: "1.0" as const,
      source: "flyd-cli" as const,
      query: "what am I working on",
      generatedAt: "2026-07-29T00:00:00Z",
      sufficiency: { verdict: "sufficient", reason: "", coverage: 1 },
      matches: [{
        id: "memory_match:current",
        type: "memory_match" as const,
        source: "cli.retrieval" as const,
        epistemicStatus: "observation" as const,
        confidence: 0.9,
        confidenceProfile: {
          epistemicConfidence: 0.9,
          freshness: 0.95,
          interestAffinity: 0,
          retrievalUtility: 0.5,
          associationStrength: 0,
        },
        generatedAt: "2026-07-29T00:00:00Z",
        evidenceRefs: [],
        content: {
          path: "wiki/projects/flyd.md",
          archive: "wiki" as const,
          excerpt: "Flyd memory recall repair is in progress.",
          retrievalScore: 90,
          recencyWeight: 0.95,
          reliabilityWeight: 0.9,
          corroborationCount: 0,
          stale: false,
          lastUpdated: "2026-07-29",
          isCurrent: true,
        },
      }],
    });

    const pack = await buildMemoryPack("what am I working on", env);

    expect(pack.current).toHaveLength(1);
    expect(pack.current[0].content).toBe("Flyd memory recall repair is in progress.");
    expect(pack.relevant).toHaveLength(0);
  });

  it("names the missing signal in gaps when a current_state query has no current match", async () => {
    const pack = await buildMemoryPack("what am I working on", env);

    expect(pack.current).toHaveLength(0);
    expect(pack.gaps).toHaveLength(1);
    expect(pack.gaps[0].importance).toBe("high");
  });

  it("does not add a currentness gap for non current_state queries", async () => {
    const pack = await buildMemoryPack("who am I", env);
    expect(pack.gaps).toHaveLength(0);
  });
});
