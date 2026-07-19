import { describe, expect, it } from "vitest";
import type { BaseEntry } from "../retrieval.js";
import { retrieveBrainEvidence } from "../brain-retrieval.js";

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
});
