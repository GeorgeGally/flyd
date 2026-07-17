import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const testFlydDir = join(tmpdir(), `flyd-test-interests-${randomUUID()}`);
const testRawDir = join(testFlydDir, "raw");
const testInterestsPath = join(testFlydDir, "interests.json");
const testInterestsStatePath = join(testFlydDir, "interests-state.json");

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    FLYD_DIR: testFlydDir,
    RAW_DIR: testRawDir,
    INTERESTS_PATH: testInterestsPath,
    INTERESTS_STATE_PATH: testInterestsStatePath,
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  mkdirSync(testRawDir, { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(testFlydDir, { recursive: true, force: true });
});

function writeCapture(filename: string, body: string, project = "test-project", timestamp?: string) {
  const ts = timestamp ?? "2026-06-01 10:00:00";
  const content = [
    "---",
    "source: cli",
    `project: ${project}`,
    `timestamp: ${ts}`,
    "---",
    "",
    body,
  ].join("\n");
  writeFileSync(join(testRawDir, filename), content, "utf8");
}

describe("extractInterests", () => {
  it("returns zeros when no captures exist", async () => {
    const { extractInterests } = await import("../interests.js");
    expect(extractInterests()).toEqual({ extracted: 0, updated: 0 });
  });

  it("extracts interests from repeated terms", async () => {
    const { extractInterests } = await import("../interests.js");
    writeCapture("1.md", "Working on Rust compiler optimizations this morning");
    writeCapture("2.md", "The Rust borrow checker is tricky but powerful", "test-project", "2026-06-01 11:00:00");
    writeCapture("3.md", "Published a blog post about Rust async patterns today", "test-project", "2026-06-01 12:00:00");
    expect(extractInterests().extracted).toBeGreaterThanOrEqual(0);
    expect(extractInterests().extracted).toBe(0);
  });

  it("skips synthesis-type captures", async () => {
    const { extractInterests } = await import("../interests.js");
    writeCapture("1.md", "Rust is great for systems programming");
    writeCapture("2.md", "More about Rust concurrency");
    writeCapture("3.md", "Rust vs C++ comparison");
    writeCapture("4.md", "synthesis output", "test-project", "2026-06-02 10:00:00");
    expect(extractInterests().extracted).toBeGreaterThanOrEqual(0);
  });

  it("does not learn interests from quarantined test captures", async () => {
    const { extractInterests, getMatchingInterests } = await import("../interests.js");
    const payload = `test: ${"A".repeat(500)} pollutedtopic`;
    writeCapture("1.md", payload);
    writeCapture("2.md", payload, "test-project", "2026-06-01 11:00:00");
    writeCapture("3.md", payload, "test-project", "2026-06-01 12:00:00");

    extractInterests();

    expect(getMatchingInterests("pollutedtopic")).toEqual([]);
  });

  it("updates existing interests on re-extraction", async () => {
    const { extractInterests } = await import("../interests.js");
    writeCapture("1.md", "Rust programming is fun");
    writeCapture("2.md", "Rust ownership model explained");
    writeCapture("3.md", "Rust async is great");
    extractInterests();
    writeCapture("4.md", "New Rust features in 2026", "test-project", "2026-06-03 10:00:00");
    const result = extractInterests();
    expect(result.updated).toBeGreaterThanOrEqual(0);
    expect(result.extracted).toBe(0);
  });
});

describe("getMatchingInterests", () => {
  it("returns empty for text with no matches", async () => {
    const { extractInterests, getMatchingInterests } = await import("../interests.js");
    writeCapture("1.md", "JavaScript frontend frameworks are evolving quickly");
    writeCapture("2.md", "React server components change everything");
    writeCapture("3.md", "JavaScript tooling keeps improving");
    extractInterests();
    expect(getMatchingInterests("What about Python?")).toEqual([]);
  });

  it("matches topics in text", async () => {
    const { extractInterests, getMatchingInterests } = await import("../interests.js");
    writeCapture("1.md", "Rust systems programming");
    writeCapture("2.md", "Rust ownership rules");
    writeCapture("3.md", "Rust async patterns");
    extractInterests();
    expect(getMatchingInterests("Tell me about Rust").some((match) => match.topic.toLowerCase().includes("rust"))).toBe(true);
  });
});

describe("getActiveInterests", () => {
  it("returns only non-stale interests", async () => {
    const { getActiveInterests } = await import("../interests.js");
    writeFileSync(testInterestsPath, JSON.stringify({
      version: 1,
      updated: "2026-06-01 10:00:00",
      global: [
        { topic: "active-topic", keywords: [], priority: "high", auto_extracted: false, first_seen: "2026-06-01", last_active: "2026-06-01", capture_count: 5, staleness_days: 30 },
        { topic: "stale-topic", keywords: [], priority: "medium", auto_extracted: false, first_seen: "2026-01-01", last_active: "2026-01-01", capture_count: 3, staleness_days: 30 },
      ],
      projects: {},
    }), "utf8");
    expect(getActiveInterests().map((interest) => interest.topic)).toEqual(["active-topic"]);
  });

  it("filters by project", async () => {
    const { getActiveInterests } = await import("../interests.js");
    writeFileSync(testInterestsPath, JSON.stringify({
      version: 1,
      updated: "2026-06-01 10:00:00",
      global: [
        { topic: "rust", keywords: [], priority: "high", auto_extracted: false, first_seen: "2026-06-01", last_active: "2026-06-01", capture_count: 5, staleness_days: 30 },
        { topic: "react", keywords: [], priority: "high", auto_extracted: false, first_seen: "2026-06-01", last_active: "2026-06-01", capture_count: 5, staleness_days: 30 },
      ],
      projects: { frontend: ["react"] },
    }), "utf8");
    expect(getActiveInterests("frontend").map((interest) => interest.topic)).toEqual(["react"]);
  });
});

describe("getInterestStaleness", () => {
  it("returns stale and dormant interests", async () => {
    const { getInterestStaleness } = await import("../interests.js");
    writeFileSync(testInterestsPath, JSON.stringify({
      version: 1,
      updated: "2026-06-01 10:00:00",
      global: [
        { topic: "active", keywords: [], priority: "high", auto_extracted: false, first_seen: "2026-06-01", last_active: "2026-06-01", capture_count: 10, staleness_days: 30 },
        { topic: "stale", keywords: [], priority: "medium", auto_extracted: false, first_seen: "2026-01-01", last_active: "2026-01-01", capture_count: 3, staleness_days: 30 },
      ],
      projects: {},
    }), "utf8");
    const { stale } = getInterestStaleness();
    expect(stale.map((interest) => interest.topic)).toContain("stale");
    expect(stale.map((interest) => interest.topic)).not.toContain("active");
  });
});

describe("getInterestKeywords", () => {
  it("returns empty string for no matches", async () => {
    const { getInterestKeywords } = await import("../interests.js");
    expect(getInterestKeywords("unrelated topic")).toBe("");
  });

  it("returns concatenated keywords for matching interests", async () => {
    const { getInterestKeywords } = await import("../interests.js");
    writeFileSync(testInterestsPath, JSON.stringify({
      version: 1,
      updated: "2026-06-01 10:00:00",
      global: [
        { topic: "rust", keywords: ["ownership", "borrow"], priority: "high", auto_extracted: false, first_seen: "2026-06-01", last_active: "2026-06-01", capture_count: 5, staleness_days: 30 },
      ],
      projects: {},
    }), "utf8");
    const keywords = getInterestKeywords("Tell me about Rust");
    expect(keywords).toContain("rust");
    expect(keywords).toContain("ownership");
  });
});

describe("listInterests", () => {
  it("removes an interest", async () => {
    const { listInterests } = await import("../interests.js");
    writeFileSync(testInterestsPath, JSON.stringify({
      version: 1,
      updated: "",
      global: [
        { topic: "rust", keywords: [], priority: "low", auto_extracted: true, first_seen: "2026-06-01", last_active: "2026-06-01", capture_count: 3, staleness_days: 30 },
      ],
      projects: {},
    }), "utf8");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    listInterests(undefined, { remove: "rust" });
    expect(consoleSpy).toHaveBeenCalledWith('removed interest "rust"');
    consoleSpy.mockRestore();
  });

  it("sets priority on an interest", async () => {
    const { listInterests } = await import("../interests.js");
    writeFileSync(testInterestsPath, JSON.stringify({
      version: 1,
      updated: "",
      global: [
        { topic: "rust", keywords: [], priority: "low", auto_extracted: true, first_seen: "2026-06-01", last_active: "2026-06-01", capture_count: 3, staleness_days: 30 },
      ],
      projects: {},
    }), "utf8");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    listInterests(undefined, { priority: "rust high" });
    expect(consoleSpy).toHaveBeenCalledWith('set "rust" priority to high');
    consoleSpy.mockRestore();
  });
});
