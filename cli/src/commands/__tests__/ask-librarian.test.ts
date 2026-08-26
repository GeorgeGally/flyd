import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateLibrarianEvidence } from "../ask.js";
import type { EvidenceEntry } from "../../lib/librarian.js";

function entry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    path: "wiki/projects/flyd.md",
    body: "Flyd ranks memories with a generative librarian.",
    source: "wiki",
    score: 80,
    metadata: { status: "canon", confidence: 0.9 },
    staleness: null,
    ...overrides,
  };
}

describe("evaluateLibrarianEvidence", () => {
  beforeEach(() => {
    process.env.FLYD_MODEL_FIXTURE = "";
  });

  afterEach(() => {
    delete process.env.FLYD_MODEL_FIXTURE;
  });

  it("blends verifier verdicts and uses generative sufficiency when the model responds", async () => {
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({
      rules: [{
        contains: "these memories actually answer",
        respond: JSON.stringify({
          reasoning: "Direct match.",
          entries: [{ path: "wiki/projects/flyd.md", relevant: true, reason: "Describes the mechanism." }],
          sufficiency: { verdict: "sufficient", reason: "Fully covered." },
          conflicts: [],
        }),
      }],
    });

    const result = await evaluateLibrarianEvidence([entry()], ["flyd"], "How does flyd rank memories?");

    expect(result.scored[0].verifiedRelevance).toBe(true);
    expect(result.scored[0].librarianScore).toBeGreaterThan(0.5);
    expect(result.sufficiency.verdict).toBe("sufficient");
    expect(result.sufficiency.reason).toBe("Fully covered.");
  });

  it("falls back to pure heuristic scoring when the model is unavailable", async () => {
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({ rules: [] });

    const result = await evaluateLibrarianEvidence(
      [entry({ body: "totally unrelated words here" })],
      ["unmatched"],
      "What about something else?",
    );

    expect(result.scored[0].verifiedRelevance).toBeUndefined();
    expect(result.sufficiency.verdict).toBe("partial");
  });

  it("skips live commit entries from verification", async () => {
    process.env.FLYD_MODEL_FIXTURE = JSON.stringify({
      rules: [{
        contains: "wiki/projects/flyd.md",
        respond: JSON.stringify({
          reasoning: "ok",
          entries: [{ path: "wiki/projects/flyd.md", relevant: true, reason: "yes" }],
          sufficiency: { verdict: "partial", reason: "" },
          conflicts: [],
        }),
      }],
    });

    const result = await evaluateLibrarianEvidence([
      entry(),
      entry({ path: "git:commit:abc123", body: "feat: add thing", source: "raw" }),
    ], ["flyd"], "How does flyd rank memories?");

    const commits = result.scored.find((s) => s.path === "git:commit:abc123");
    expect(commits?.verifiedRelevance).toBeUndefined();
    expect(result.scored.find((s) => s.path === "wiki/projects/flyd.md")?.verifiedRelevance).toBe(true);
  });
});
