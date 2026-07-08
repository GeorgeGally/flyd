import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { serialize } from "../../lib/frontmatter.js";

const rawDir = join(tmpdir(), `flyd-test-compound-${randomUUID()}`);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, RAW_DIR: rawDir };
});

vi.mock("../../lib/llm.js", async () => ({
  query: vi.fn().mockResolvedValue(`## Context
Working on flyd's plan and work commands.

## What We Learned
The plan command searches memory via QMD and creates structured implementation plans.

## Key Decisions
Used the same pattern as research.ts for consistency.

## Patterns to Follow
Commands follow: search memory -> call LLM -> save capture -> re-index.

## Open Questions
Should we add web research support?`),
}));

vi.mock("../../lib/qmd.js", async () => ({
  search: vi.fn().mockResolvedValue([
    { path: "2026-06-01-capture-1.md", score: 85 },
    { path: "2026-06-02-capture-2.md", score: 72 },
  ]),
  updateRaw: vi.fn().mockResolvedValue(undefined),
  embedRaw: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mkdirSync(rawDir, { recursive: true });
  for (const c of [
    { file: "2026-06-01-capture-1.md", body: "Started building flyd plan command" },
    { file: "2026-06-02-capture-2.md", body: "Plan command now searches QMD index for context" },
  ]) {
    writeFileSync(
      join(rawDir, c.file),
      serialize({ source: "cli", project: "flyd", timestamp: "2026-06-01 12:00:00" }, c.body),
      "utf8"
    );
  }
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(rawDir, { recursive: true, force: true });
});

describe("runCompound", () => {
  it("writes a compound capture to RAW_DIR", async () => {
    const { runCompound } = await import("../compound.js");
    await runCompound("plan command");
    const files = readdirSync(rawDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(3);
    const newFiles = files.filter((f) => f !== "2026-06-01-capture-1.md" && f !== "2026-06-02-capture-2.md");
    expect(newFiles.length).toBe(1);
    const content = readFileSync(join(rawDir, newFiles[0]), "utf8");
    expect(content).toContain("source: compound");
    expect(content).toContain("type: compound");
    expect(content).toContain("topic: plan command");
    expect(content).toContain("captures_used: 2");
  });

  it("prints a message when no captures found", async () => {
    vi.mocked((await import("../../lib/qmd.js")).search).mockResolvedValueOnce([]);
    const { runCompound } = await import("../compound.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCompound("nonexistent");
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no captures found for "nonexistent"'));
    log.mockRestore();
  });

  it("searches memory via QMD", async () => {
    const qmd = await import("../../lib/qmd.js");
    const { runCompound } = await import("../compound.js");
    await runCompound("memory test");
    expect(qmd.search).toHaveBeenCalledWith("memory test", "flyd-raw", 20);
  });

  it("passes capture content to the LLM", async () => {
    const llm = await import("../../lib/llm.js");
    const { runCompound } = await import("../compound.js");
    await runCompound("plan command");
    expect(llm.query).toHaveBeenCalled();
    const prompt = (llm.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prompt).toContain("plan command");
    expect(prompt).toContain("Started building flyd plan command");
  });
});
