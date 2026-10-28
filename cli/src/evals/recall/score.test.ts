import { expect, it } from "vitest";
import { scoreRecall } from "./score.js";

it("scores top ranks, misses, stale current results and negative cases", () => {
  const rows = [
    { answers: ["a.md"], stale: [], paths: ["a.md"], noAnswer: false },
    { answers: ["b.md"], stale: ["old.md"], paths: ["old.md", "b.md"], noAnswer: false },
    { answers: ["c.md"], stale: [], paths: ["other.md"], noAnswer: false },
    { answers: [], stale: [], paths: ["unrelated.md"], noAnswer: true },
  ];
  expect(scoreRecall(rows)).toEqual({ answerCases: 3, top1: 1, top5: 2, misses: 1, staleTop1: 1, negativeCases: 1, negativeWithResults: 1 });
});

it("validates the labelled answer against the exact source file", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadRecallCases } = await import("./schema.js");
  const root = mkdtempSync(join(tmpdir(), "recall-label-"));
  try {
    writeFileSync(join(root, "bird.md"), "A blue heron lives here.");
    expect(loadRecallCases(new URL("./synthetic.json", import.meta.url).pathname, root)).toHaveLength(2);
    writeFileSync(join(root, "bird.md"), "No bird here.");
    expect(() => loadRecallCases(new URL("./synthetic.json", import.meta.url).pathname, root)).toThrow("does not contain label");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
