import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const rawDir = join(tmpdir(), `flyd-test-raw-${randomUUID()}`);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, RAW_DIR: rawDir };
});

beforeEach(() => {
  mkdirSync(rawDir, { recursive: true });
});

afterEach(() => {
  rmSync(rawDir, { recursive: true, force: true });
});

describe("runCapture", () => {
  it("writes a file to RAW_DIR with frontmatter", async () => {
    const { runCapture } = await import("../capture.js");
    await runCapture("Test capture text.");
    const files = readdirSync(rawDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(1);
    const content = readFileSync(join(rawDir, files[0]), "utf8");
    expect(content).toContain("source: cli");
    expect(content).toContain("project: ");
    expect(content).toContain("project_path: ");
    expect(content).toContain("Test capture text.");
  });

  it("generates a timestamp-based filename", async () => {
    const { runCapture } = await import("../capture.js");
    await runCapture("test");
    const files = readdirSync(rawDir);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
  });

  it("creates the raw directory if it does not exist", async () => {
    rmSync(rawDir, { recursive: true, force: true });
    expect(existsSync(rawDir)).toBe(false);
    const { runCapture } = await import("../capture.js");
    await runCapture("test");
    expect(existsSync(rawDir)).toBe(true);
  });
});
