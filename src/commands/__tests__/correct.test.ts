import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const wikiDir = join(tmpdir(), `flyd-test-correct-${randomUUID()}`);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, WIKI_DIR: wikiDir };
});

vi.mock("../../lib/llm.js", async () => ({
  query: vi.fn(),
}));

beforeEach(() => {
  mkdirSync(wikiDir, { recursive: true });
});

afterEach(() => {
  rmSync(wikiDir, { recursive: true, force: true });
});

describe("runCorrect routing", () => {
  it("uses knownDirs closed-set match — LLM returns 'projects'", async () => {
    const { query } = await import("../../lib/llm.js");
    const { runCorrect } = await import("../correct.js");

    (query as ReturnType<typeof vi.fn>).mockResolvedValue("projects");

    await runCorrect("resolver routing", "resolver now reads template directly");
    const files = (await import("fs")).readdirSync(join(wikiDir, "projects"));
    expect(files.some((f: string) => f.endsWith(".md"))).toBe(true);
  });

  it("falls back to corrections when LLM returns unrecognized dir", async () => {
    const { query } = await import("../../lib/llm.js");
    const { runCorrect } = await import("../correct.js");

    (query as ReturnType<typeof vi.fn>).mockResolvedValue("nonexistent_folder");

    await runCorrect("test topic", "test correction");
    const correctionsDir = join(wikiDir, "corrections");
    expect(existsSync(correctionsDir)).toBe(true);
    const files = (await import("fs")).readdirSync(correctionsDir);
    expect(files.some((f: string) => f.endsWith(".md"))).toBe(true);
  });

  it("falls back to corrections when LLM throws", async () => {
    const { query } = await import("../../lib/llm.js");
    const { runCorrect } = await import("../correct.js");

    (query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("api error"));

    await runCorrect("test topic", "test correction");
    const correctionsDir = join(wikiDir, "corrections");
    expect(existsSync(correctionsDir)).toBe(true);
    const files = (await import("fs")).readdirSync(correctionsDir);
    expect(files.some((f: string) => f.endsWith(".md"))).toBe(true);
  });

  it("respects knownDirs case-insensitively", async () => {
    const { query } = await import("../../lib/llm.js");
    const { runCorrect } = await import("../correct.js");

    (query as ReturnType<typeof vi.fn>).mockResolvedValue("IDENTITY");

    await runCorrect("background", "user background info");
    const identityDir = join(wikiDir, "identity");
    expect(existsSync(identityDir)).toBe(true);
  });
});