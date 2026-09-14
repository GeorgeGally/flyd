import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promoteProjectKnowledge } from "../work/project-knowledge-promotion.js";

describe("project knowledge promotion", () => {
  it("preserves human AGENTS content and durable promoted knowledge", () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-agents-"));
    writeFileSync(join(root, "AGENTS.md"), "# AGENTS.md\n\nHuman rule.\n");
    const result = promoteProjectKnowledge({
      projectRoot: root,
      candidates: [{
        text: "Use the canonical repository observer for basic Git state.",
        kind: "architecture",
        source: "verified-outcome",
        confidence: "high",
        durable: true,
      }],
      apply: true,
    });
    const text = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(result.changed).toBe(true);
    expect(text).toContain("Human rule.");
    expect(text).toContain("canonical repository observer");
  });

  it("rejects temporary state and deduplicates prior knowledge", () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-agents-"));
    const durable = {
      text: "Verification runs in the isolated verifier sandbox.",
      kind: "constraint" as const,
      source: "verified-outcome",
      confidence: "high" as const,
      durable: true,
    };
    promoteProjectKnowledge({ projectRoot: root, candidates: [durable], apply: true });
    const result = promoteProjectKnowledge({
      projectRoot: root,
      candidates: [durable, { ...durable, text: "Currently blocked on migration." }],
      apply: true,
    });
    expect(result.changed).toBe(false);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
  });
});
