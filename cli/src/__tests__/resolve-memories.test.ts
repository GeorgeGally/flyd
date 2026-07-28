import { beforeEach, describe, expect, it, vi } from "vitest";
import { retrieveMemories } from "../resolve.js";

const retrieveResilientLexicalBrainEvidence = vi.fn(async (query: string) => ({
  version: "1.0" as const,
  source: "flyd-cli" as const,
  query,
  generatedAt: "2026-07-28T00:00:00Z",
  sufficiency: { verdict: "sufficient", reason: "" },
  matches: [
    {
      id: "memory_match:abc",
      type: "memory_match" as const,
      source: "cli.retrieval" as const,
      epistemicStatus: "observation" as const,
      confidence: 0.8,
      generatedAt: "2026-07-28T00:00:00Z",
      evidenceRefs: [],
      content: {
        path: "raw/2026-07-01.md",
        archive: "raw" as const,
        excerpt: "George is building flyd.",
        retrievalScore: 80,
        recencyWeight: 1,
        reliabilityWeight: 1,
        corroborationCount: 0,
        stale: false,
        lastUpdated: null,
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

describe("retrieveMemories", () => {
  it("searches with the intent only — app name and window title stay out of the query", async () => {
    const memories = await retrieveMemories("who am I", env);

    expect(retrieveResilientLexicalBrainEvidence).toHaveBeenCalledTimes(1);
    const query = retrieveResilientLexicalBrainEvidence.mock.calls[0][0];
    expect(query).toBe("who am I");
    expect(query).not.toContain("Mail");
    expect(query).not.toContain("Inbox");
    expect(memories).toEqual([
      { path: "raw/2026-07-01.md", excerpt: "George is building flyd." },
    ]);
  });

  it("returns nothing for an empty intent without searching", async () => {
    const memories = await retrieveMemories("   ", env);
    expect(memories).toEqual([]);
    expect(retrieveResilientLexicalBrainEvidence).not.toHaveBeenCalled();
  });
});
