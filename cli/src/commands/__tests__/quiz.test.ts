import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const testReviewStatePath = join(tmpdir(), `flyd-test-quiz-${randomUUID()}.json`);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    REVIEW_STATE_PATH: testReviewStatePath,
  };
});

vi.mock("readline", () => {
  const mockInterface = {
    question: (_: string, cb: (a: string) => void) => cb(""),
    close: () => {},
  };
  return {
    createInterface: () => mockInterface,
  };
});

beforeEach(() => {
  const items = [
    {
      id: "raw-test-1",
      sourcePath: "capture1.md",
      sourceType: "raw",
      title: "Test Capture",
      question: "What is flyd?",
      answer: "A personal memory CLI tool written in TypeScript",
      created: "2026-06-01T00:00:00.000Z",
      lastReview: null,
      nextReview: new Date().toISOString(),
      stability: 1,
      difficulty: 5,
      reviewCount: 0,
      lapses: 0,
    },
  ];
  writeFileSync(testReviewStatePath, JSON.stringify({ version: 1, updated: new Date().toISOString(), items }));
});

afterEach(() => {
  if (existsSync(testReviewStatePath)) rmSync(testReviewStatePath, { force: true });
  vi.restoreAllMocks();
});

describe("quiz", () => {
  describe("runQuiz", () => {
    it("shows message when no items exist", async () => {
      if (existsSync(testReviewStatePath)) rmSync(testReviewStatePath, { force: true });
      writeFileSync(testReviewStatePath, JSON.stringify({ version: 1, updated: new Date().toISOString(), items: [] }));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { runQuiz } = await import("../quiz.js");
      await runQuiz();

      const output = consoleSpy.mock.calls.map(c => c[0]).join("\n");
      expect(output).toContain("No review items available");
      consoleSpy.mockRestore();
    });

    it("executes with existing items", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { runQuiz } = await import("../quiz.js");
      await runQuiz({ limit: 1, mode: "qa" });

      const output = consoleSpy.mock.calls.map(c => c[0]).join("\n");
      expect(output).toContain("Quiz");
      expect(output).toContain("What is flyd");
      consoleSpy.mockRestore();
    });
  });
});
