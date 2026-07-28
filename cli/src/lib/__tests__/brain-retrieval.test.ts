import { describe, expect, it, vi } from "vitest";
import { isContentRelevant, type BaseEntry } from "../retrieval.js";
import { createResilientLexicalSearchRaw, mergeSearchResults, retrieveBrainEvidence } from "../brain-retrieval.js";

function entry(
  path: string,
  body: string,
  source: "raw" | "wiki",
  confidence: unknown = 0.8,
  metadata: Record<string, unknown> = {},
): BaseEntry {
  return { path, body, source, score: 80, metadata: { confidence, timestamp: "2026-07-15 10:00:00", ...metadata } };
}

describe("targeted brain retrieval", () => {
  it("returns ranked structured evidence and a sufficiency judgment", async () => {
    const result = await retrieveBrainEvidence("What did I decide about Flyd surfaces?", {
      searchRaw: async () => [
        entry("decision.md", "I decided that Flyd surfaces express the intelligence.", "raw"),
        entry("test.md", "test: " + "A".repeat(500), "raw"),
      ],
      searchWiki: () => [entry("principles/flyd.md", "Flyd surfaces express intelligence, not stored records.", "wiki", "not-a-number")],
      searchGraph: () => [],
      now: () => new Date("2026-07-16T00:00:00Z"),
    });

    expect(result.version).toBe("1.0");
    expect(result.query).toBe("What did I decide about Flyd surfaces?");
    expect(result.matches).toHaveLength(2);
    expect(result.matches.map((match) => match.content.path)).not.toContain("test.md");
    expect(result.matches.every((match) => Number.isFinite(match.confidence))).toBe(true);
    expect(result.matches[0]).toMatchObject({ type: "memory_match", source: "cli.retrieval", evidenceRefs: [] });
    expect(["sufficient", "partial", "insufficient", "conflicting"]).toContain(result.sufficiency.verdict);
  });

  it("does not fail when the archive has no matching evidence", async () => {
    const result = await retrieveBrainEvidence("unknown", {
      searchRaw: async () => [],
      searchWiki: () => [],
      searchGraph: () => [],
      now: () => new Date("2026-07-16T00:00:00Z"),
    });

    expect(result.matches).toEqual([]);
    expect(result.sufficiency.verdict).toBe("insufficient");
  });

  it("preserves user authority when retrieving a runtime correction from raw memory", async () => {
    const result = await retrieveBrainEvidence("What did I correct about Rails?", {
      searchRaw: async () => [
        entry(
          "runtime-correction.md",
          "Correction: Rails is secondary -> Rails is a first-class surface.",
          "raw",
          1,
          { type: "flyd-runtime-task-corrected" },
        ),
      ],
      searchWiki: () => [],
      searchGraph: () => [],
      now: () => new Date("2026-07-16T00:00:00Z"),
    });

    expect(result.matches[0]?.epistemicStatus).toBe("user_confirmed");
  });

  it("does not promote a conversation index merely because it is stored in the wiki", async () => {
    const result = await retrieveBrainEvidence("What did we discuss about Flyd?", {
      searchRaw: async () => [],
      searchWiki: () => [
        entry(
          "conversations/session.md",
          "George discussed making Flyd remember conversations.",
          "wiki",
          1,
          { type: "conversation-index", promoted: false },
        ),
      ],
      searchGraph: () => [],
      now: () => new Date("2026-07-16T00:00:00Z"),
    });

    expect(result.matches[0]?.epistemicStatus).toBe("observation");
  });
});

describe("mergeSearchResults", () => {
  it("dedups by path keeping the max score, sorted descending", () => {
    const merged = mergeSearchResults([
      [{ path: "a.md", score: 30 }, { path: "b.md", score: 90 }],
      [{ path: "a.md", score: 70 }, { path: "c.md", score: 50 }],
    ]);
    expect(merged).toEqual([
      { path: "b.md", score: 90 },
      { path: "a.md", score: 70 },
      { path: "c.md", score: 50 },
    ]);
  });
});

describe("createResilientLexicalSearchRaw", () => {
  const mapEntries = (results: Array<{ path: string; score: number }>): BaseEntry[] =>
    results.map((r) => entry(r.path, "george was here", "raw"));

  it("does not fan out when the full query already matches", async () => {
    const searchFn = vi.fn(async () => [{ path: "hit.md", score: 80 }]);
    const buildEntries = vi.fn((results: Array<{ path: string; score: number }>) => mapEntries(results));
    const searchRaw = createResilientLexicalSearchRaw(searchFn, buildEntries as never);

    const entries = await searchRaw("george gally", ["george", "gally"]);
    expect(entries).toHaveLength(1);
    expect(searchFn).toHaveBeenCalledTimes(1);
  });

  it("fans out per keyword when the full query misses, with relaxed relevance", async () => {
    const searchFn = vi.fn(async (query: string) =>
      query === "george" ? [{ path: "george.md", score: 80 }] : [],
    );
    const buildEntries = vi.fn(
      (results: Array<{ path: string; score: number }>, _keywords: string[], minMatches?: number) =>
        minMatches === 1 ? mapEntries(results) : [],
    );
    const searchRaw = createResilientLexicalSearchRaw(searchFn, buildEntries as never);

    const entries = await searchRaw("who is george what do you know about me", ["george"]);
    expect(entries.map((e) => e.path)).toEqual(["george.md"]);
    expect(searchFn).toHaveBeenCalledTimes(2);
    expect(buildEntries).toHaveBeenLastCalledWith([{ path: "george.md", score: 80 }], ["george"], 1);
  });

  it("caps fan-out at four keywords", async () => {
    const searchFn = vi.fn(async () => []);
    const buildEntries = vi.fn(() => []);
    const searchRaw = createResilientLexicalSearchRaw(searchFn, buildEntries as never);

    await searchRaw("query", ["one", "two", "three", "four", "five", "six"]);
    expect(searchFn).toHaveBeenCalledTimes(5); // 1 primary + 4 fan-out
  });
});

describe("isContentRelevant with minMatches", () => {
  it("accepts a single-keyword match when relaxed to 1", () => {
    expect(isContentRelevant("george was here", ["george"], 1)).toBe(true);
  });

  it("keeps the strict default threshold without minMatches", () => {
    expect(isContentRelevant("george was here", ["george"])).toBe(false);
    expect(isContentRelevant("george gally was here", ["george", "gally"])).toBe(true);
  });
});
