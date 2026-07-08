import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const testFlydDir = join(tmpdir(), `flyd-test-crystallize-${randomUUID()}`);
const testRawDir = join(testFlydDir, "raw");
const testWikiDir = join(testFlydDir, "wiki");
const testCrystallizeStatePath = join(testFlydDir, "crystallize-state.json");

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    FLYD_DIR: testFlydDir,
    RAW_DIR: testRawDir,
    WIKI_DIR: testWikiDir,
    CRYSTALLIZE_STATE_PATH: testCrystallizeStatePath,
  };
});

vi.mock("../../lib/llm.js", () => ({
  query: vi.fn().mockResolvedValue("No action needed"),
  agentLoop: vi.fn(),
}));

vi.mock("../../lib/qmd.js", () => ({
  updateRaw: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mkdirSync(testRawDir, { recursive: true });
  mkdirSync(testWikiDir, { recursive: true });
});

afterEach(() => {
  rmSync(testFlydDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeCapture(filename: string, body: string, project = "testproject") {
  const content = [
    "---",
    `source: auto`,
    `project: ${project}`,
    `timestamp: 2026-06-01 10:00:00`,
    "---",
    "",
    body,
  ].join("\n");
  writeFileSync(join(testRawDir, filename), content, "utf8");
}

describe("crystallize", () => {
  it("skips when no unprocessed captures exist", async () => {
    const { runCrystallize } = await import("../../lib/crystallize.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCrystallize();

    const output = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("no new captures");
    consoleSpy.mockRestore();
  });

  it("processes captures and calls agentLoop", async () => {
    const { agentLoop } = await import("../../lib/llm.js");
    (agentLoop as ReturnType<typeof vi.fn>).mockImplementation(
      async (_system: string, _msg: string, _tools: unknown[], _handler: (name: string, input: Record<string, unknown>) => string) => {
        _handler("propose_new_page", {
          path: "projects/test-project.md",
          content: "# Test Project\nA test project.",
          summary: "Add test project page",
        });
        return "done";
      },
    );

    writeCapture("capture-1.md", "A".repeat(300));
    writeCapture("capture-2.md", "B".repeat(300));

    const { runCrystallize } = await import("../../lib/crystallize.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCrystallize();

    const output = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("analyzing 2 unprocessed captures");
    expect(output).toContain("new_page");
    expect(output).toContain("Add test project page");
    consoleSpy.mockRestore();
  });

  it("dry-run does not write files", async () => {
    const { agentLoop } = await import("../../lib/llm.js");
    (agentLoop as ReturnType<typeof vi.fn>).mockImplementation(
      async (_system: string, _msg: string, _tools: unknown[], handler: (name: string, input: Record<string, unknown>) => string) => {
        handler("propose_new_page", {
          path: "projects/test.md",
          content: "# Test\nContent.",
          summary: "Test page",
        });
        return "done";
      },
    );

    writeCapture("capture-3.md", "C".repeat(300));

    const { runCrystallize } = await import("../../lib/crystallize.js");
    await runCrystallize({ dryRun: true });

    const wikiPage = join(testWikiDir, "projects/test.md");
    expect(existsSync(wikiPage)).toBe(false);
  });
});
