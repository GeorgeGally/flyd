import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyEvidence, MAX_VERIFY_ENTRIES, type VerifierEntry } from "../librarian-verifier.js";

function entry(overrides: Partial<VerifierEntry> = {}): VerifierEntry {
  return {
    path: "wiki/projects/flyd.md",
    body: "Flyd uses a generative librarian to rank memories.",
    freshness: 0.8,
    epistemicConfidence: 0.9,
    stalenessMessage: null,
    ...overrides,
  };
}

const VERDICT_JSON = JSON.stringify({
  reasoning:
    "The flyd project entry directly describes the librarian ranking approach, so it answers the question. The unrelated cooking entry does not.",
  entries: [
    { path: "wiki/projects/flyd.md", relevant: true, reason: "Directly describes the ranking mechanism asked about." },
    { path: "wiki/topics/cooking.md", relevant: false, reason: "About recipes, not memory ranking." },
  ],
  sufficiency: { verdict: "sufficient", reason: "One authoritative entry fully covers the mechanism." },
  conflicts: [],
});

const CONFLICT_JSON = JSON.stringify({
  reasoning: "The two entries claim different primary languages for the same person.",
  entries: [
    { path: "wiki/skills/ruby.md", relevant: true, reason: "States Ruby was the main language." },
    { path: "wiki/skills/swift.md", relevant: true, reason: "States Swift became the main language." },
  ],
  sufficiency: { verdict: "conflicting", reason: "Entries disagree about the current primary language." },
  conflicts: [
    { a: "wiki/skills/ruby.md", b: "wiki/skills/swift.md", reason: "Both claim to be the current primary language." },
  ],
});

const PROMPT_MARKER = "these memories actually answer";

describe("verifyEvidence", () => {
  beforeEach(() => {
    process.env.FLYD_MODEL_FIXTURE = "";
  });

  afterEach(() => {
    delete process.env.FLYD_MODEL_FIXTURE;
  });

  it("returns parsed verdicts, sufficiency and conflicts on a well-formed response", async () => {
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({
      rules: [{ contains: PROMPT_MARKER, respond: VERDICT_JSON }],
    });

    const result = await verifyEvidence(
      [
        entry(),
        entry({ path: "wiki/topics/cooking.md", body: "How to cook lentils.", epistemicConfidence: 0.5 }),
      ],
      "How does Flyd rank memories?",
    );

    expect(result.verified).toBe(true);
    expect(result.verdicts.get("wiki/projects/flyd.md")?.relevant).toBe(true);
    expect(result.verdicts.get("wiki/projects/flyd.md")?.reason).toContain("ranking mechanism");
    expect(result.verdicts.get("wiki/topics/cooking.md")?.relevant).toBe(false);
    expect(result.sufficiency.verdict).toBe("sufficient");
    expect(result.conflicts).toEqual([]);
  });

  it("surfaces verified conflicts between entries", async () => {
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({
      rules: [{ contains: PROMPT_MARKER, respond: CONFLICT_JSON }],
    });

    const result = await verifyEvidence(
      [
        entry({ path: "wiki/skills/ruby.md", body: "Ruby is my main language." }),
        entry({ path: "wiki/skills/swift.md", body: "Swift is my main language now." }),
      ],
      "What is my primary programming language?",
    );

    expect(result.sufficiency.verdict).toBe("conflicting");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      a: "wiki/skills/ruby.md",
      b: "wiki/skills/swift.md",
    });
  });

  it("fails soft with verified:false when the model returns malformed output", async () => {
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({
      rules: [{ contains: PROMPT_MARKER, respond: "I cannot answer that." }],
    });

    const result = await verifyEvidence([entry()], "anything");

    expect(result.verified).toBe(false);
    expect(result.verdicts.size).toBe(0);
    expect(result.conflicts).toEqual([]);
    expect(result.sufficiency.verdict).toBe("insufficient");
  });

  it("fails soft when the model call throws", async () => {
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({ rules: [] });

    const result = await verifyEvidence([entry()], "anything");

    expect(result.verified).toBe(false);
    expect(result.verdicts.size).toBe(0);
  });

  it("caps verification at the entry limit", async () => {
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({
      rules: [{
        contains: PROMPT_MARKER,
        respond: JSON.stringify({
          reasoning: "All ten entries are filler.",
          entries: Array.from({ length: MAX_VERIFY_ENTRIES }, (_, i) => ({
            path: `wiki/entries/e${i}.md`,
            relevant: true,
            reason: "filler",
          })),
          sufficiency: { verdict: "partial", reason: "filler entries only." },
          conflicts: [],
        }),
      }],
    });

    const many: VerifierEntry[] = [];
    for (let i = 0; i < MAX_VERIFY_ENTRIES + 5; i++) {
      many.push(entry({ path: `wiki/entries/e${i}.md`, body: `Entry ${i} filler.` }));
    }

    const result = await verifyEvidence(many, "question");

    expect(result.verified).toBe(true);
    for (const e of many.slice(MAX_VERIFY_ENTRIES)) {
      expect(result.verdicts.has(e.path)).toBe(false);
    }
  });

  it("includes formula signals in the prompt so the verifier reasons over them", async () => {
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({
      rules: [{ contains: "freshness=0.80", respond: VERDICT_JSON }],
    });

    const result = await verifyEvidence([entry()], "How does Flyd rank memories?");

    expect(result.verified).toBe(true);
  });
});
