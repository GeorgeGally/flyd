import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const testRawDir = join(tmpdir(), `flyd-test-synthesis-raw-${randomUUID()}`);
const testStatePath = join(tmpdir(), `flyd-test-synthesis-state-${randomUUID()}.json`);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    RAW_DIR: testRawDir,
    SYNTHESIS_STATE_PATH: testStatePath,
  };
});

vi.mock("../../lib/llm.js", async () => ({
  query: vi.fn().mockResolvedValue(`# TestProject — Project Synthesis (v1)

## What it is
A test project for unit testing.

## Architecture
- Component A
- Component B

## Key Decisions
- Use TypeScript for type safety

## Recent Activity
- Initial implementation complete

## Current State
- All tests passing`),
}));

// Ensure clean state before each test
beforeEach(() => {
  mkdirSync(testRawDir, { recursive: true });
  if (existsSync(testStatePath)) rmSync(testStatePath, { force: true });
});

afterEach(() => {
  rmSync(testRawDir, { recursive: true, force: true });
  if (existsSync(testStatePath)) rmSync(testStatePath, { force: true });
});

function writeCapture(filename: string, body: string, project = "testproject", type = "", timestamp?: string) {
  const ts = timestamp ?? "2026-05-30 10:00:00";
  const frontmatter = [
    "---",
    `source: auto`,
    `project: ${project}`,
    `timestamp: ${ts}`,
    ...(type ? [`type: ${type}`] : []),
    "---",
    "",
    body,
  ].join("\n");
  mkdirSync(testRawDir, { recursive: true });
  writeFileSync(join(testRawDir, filename), frontmatter, "utf8");
}

describe("synthesis", () => {
  describe("runSynthesis", () => {
    it("skips projects with fewer than 5 new captures", async () => {
      const { runSynthesis } = await import("../../lib/synthesis.js");

      // Write only 3 captures
      for (let i = 0; i < 3; i++) {
        writeCapture(`2026-05-30-0${i}-00-00.md`, `capture ${i} content`);
      }

      const { synthesized, skipped } = await runSynthesis();
      expect(synthesized).toHaveLength(0);
      expect(skipped).toContain("testproject");
    });

    it("synthesizes project with 5+ captures", async () => {
      const { runSynthesis } = await import("../../lib/synthesis.js");

      // Write 6 captures
      for (let i = 0; i < 6; i++) {
        writeCapture(`2026-05-30-0${i}-00-00.md`, `capture ${i} about test project`);
      }

      const { synthesized, skipped } = await runSynthesis();
      expect(synthesized).toContain("testproject");
      expect(skipped).not.toContain("testproject");
    });

    it("writes a synthesis file with type: synthesis frontmatter", async () => {
      const { runSynthesis } = await import("../../lib/synthesis.js");

      for (let i = 0; i < 6; i++) {
        writeCapture(`2026-05-05-0${i}-00-00.md`, `capture ${i}`);
      }

      await runSynthesis();

      const files = readdirSync(testRawDir).filter((f) => f.endsWith(".md"));
      const synthFile = files.find((f) => {
        const content = readFileSync(join(testRawDir, f), "utf8");
        return content.includes("type: synthesis");
      });
      expect(synthFile).toBeDefined();
    });

    it("increments version on successive syntheses", async () => {
      const { synthesizeProject } = await import("../../lib/synthesis.js");

      // First batch — timestamps in the past
      for (let i = 0; i < 6; i++) {
        writeCapture(`2026-05-28-0${i}-00-00.md`, `first batch capture ${i}`, "testproject", "", "2026-05-28 10:00:00");
      }

      await synthesizeProject("testproject");

      // Second batch — timestamps in the far future (always newer than first synthesis)
      for (let i = 0; i < 6; i++) {
        writeCapture(`2099-06-01-0${i}-00-00.md`, `second batch capture ${i}`, "testproject", "", "2099-06-01 10:00:00");
      }

      await synthesizeProject("testproject");

      const synthFiles = readdirSync(testRawDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => {
          const content = readFileSync(join(testRawDir, f), "utf8");
          const versionMatch = content.match(/synthesis_version:\s*(\d+)/);
          return versionMatch ? parseInt(versionMatch[1], 10) : null;
        })
        .filter((v) => v !== null) as number[];

      const maxVersion = Math.max(...synthFiles);
      expect(maxVersion).toBeGreaterThanOrEqual(2);
    });

    it("skips synthesis captures from being used as input", async () => {
      const { runSynthesis } = await import("../../lib/synthesis.js");

      // Write synthesis captures (type: synthesis)
      writeCapture("2026-05-28-00-00-00.md", "previous synthesis content", "testproject", "synthesis");
      // Write new regular captures
      for (let i = 0; i < 5; i++) {
        writeCapture(`2026-05-29-0${i}-00-00.md`, `new capture ${i}`);
      }

      await runSynthesis();

      const files = readdirSync(testRawDir).filter((f) => f.endsWith(".md"));
      const synthFiles = files.filter((f) => {
        const content = readFileSync(join(testRawDir, f), "utf8");
        return content.includes("type: synthesis") && !content.includes("previous synthesis");
      });
      // New synthesis should be produced
      expect(synthFiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("synthesizeProject", () => {
    it("returns false when no captures exist for project", async () => {
      const { synthesizeProject } = await import("../../lib/synthesis.js");
      const result = await synthesizeProject("nonexistent");
      expect(result).toBe(false);
    });
  });
});