import { describe, expect, it } from "vitest";
import { retrieveFastBrainEvidence } from "../fast-brain-retrieval.js";

describe("retrieveFastBrainEvidence", () => {
  it("returns bounded lexical memory without invoking semantic search", async () => {
    const result = await retrieveFastBrainEvidence("What is my Flyd daily driver goal?", {
      searchEntries: () => [
        {
          path: "flyd/product.md",
          body: "Flyd should become George's daily driver for coding work.",
          score: 84,
          metadata: {},
          source: "wiki",
        },
        {
          path: "flyd/unrelated.md",
          body: "A note about cooking dinner.",
          score: 30,
          metadata: {},
          source: "wiki",
        },
      ],
      now: () => new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(result.verdict).toBe("partial");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      path: "flyd/product.md",
      stale: false,
    });
  });

  it("skips retrieval work when conversational input has no useful terms", async () => {
    let searched = false;

    const result = await retrieveFastBrainEvidence("let's just chat", {
      searchEntries: () => {
        searched = true;
        return [];
      },
      now: () => new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(searched).toBe(false);
    expect(result).toEqual({ verdict: "insufficient", matches: [] });
  });

  it("does not let generic recency words outrank the requested personal fact", async () => {
    let observedKeywords: string[] = [];
    const result = await retrieveFastBrainEvidence("What is my current horoscope?", {
      searchEntries: (_query, keywords) => {
        observedKeywords = keywords;
        return [{
          path: "unrelated.md",
          body: "This describes the current project state.",
          score: 90,
          metadata: {},
          source: "raw",
        }];
      },
      now: () => new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(observedKeywords).toEqual(["horoscope"]);
    expect(result.matches).toEqual([]);
  });

  it("quarantines raw conversation transcripts from semantic memory", async () => {
    const result = await retrieveFastBrainEvidence("how can flyd improve", {
      searchEntries: () => [{
        path: "conversation-failed-answer.md",
        body: "George: how can flyd improve\nFlyd: Use enhanced contextual understanding.",
        score: 95,
        metadata: { type: "flyd-conversation-transcript" },
        source: "raw",
      }],
      now: () => new Date("2026-08-08T23:00:00.000Z"),
    });

    expect(result).toEqual({ verdict: "insufficient", matches: [] });
  });

  it("marks explicit corrections as user-confirmed authority", async () => {
    const result = await retrieveFastBrainEvidence("Which Flyd model should be used?", {
      searchEntries: () => [{
        path: "corrections/flyd-model.md",
        body: "Flyd should use the configured primary model.",
        score: 90,
        metadata: { type: "correction", source: "correction" },
        source: "wiki",
      }],
      now: () => new Date("2026-08-08T23:00:00.000Z"),
    });

    expect(result.matches[0]).toMatchObject({ authority: "user_confirmed" });
  });
});
