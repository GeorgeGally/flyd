import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { getStaleness, stalenessSummary } from "../staleness.js";

let testRoot = "";
let recentFile = "";

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "flyd-staleness-"));
  recentFile = join(testRoot, "recent.md");
  writeFileSync(recentFile, "recent\n", "utf8");
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("getStaleness", () => {
  it("returns non-stale for recent entries", () => {
    const result = getStaleness("/fake/path.md", {});
    expect(result.stale).toBe(false);
    expect(result.veryStale).toBe(false);
  });

  it("returns stale when last_confirmed is 45 days ago", () => {
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const result = getStaleness("/fake/path.md", { last_confirmed: oldDate });
    expect(result.stale).toBe(true);
    expect(result.veryStale).toBe(false);
    expect(result.daysSince).toBe(45);
  });

  it("returns veryStale when last_confirmed is 95 days ago", () => {
    const oldDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
    const result = getStaleness("/fake/path.md", { last_confirmed: oldDate });
    expect(result.stale).toBe(true);
    expect(result.veryStale).toBe(true);
    expect(result.daysSince).toBe(95);
  });

  it("uses file mtime when last_confirmed is absent", () => {
    const result = getStaleness(recentFile, {});
    expect(result.stale).toBe(false);
    expect(result.lastUpdated).not.toBeNull();
  });

  it("returns correct message for stale entries", () => {
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const result = getStaleness("/fake/path.md", { last_confirmed: oldDate });
    expect(result.message).not.toBeNull();
    expect(result.message).toContain("potentially-stale");
    expect(result.message).toContain("45");
  });

  it("returns correct message for very stale entries", () => {
    const oldDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
    const result = getStaleness("/fake/path.md", { last_confirmed: oldDate });
    expect(result.message).toContain("stale");
    expect(result.message).toContain("95");
  });
});

describe("stalenessSummary", () => {
  it("returns empty for no stale entries", () => {
    const entries = [{ path: "a.md", metadata: {}, fullPath: recentFile }];
    expect(stalenessSummary(entries)).toEqual([]);
  });

  it("detects stale entries", () => {
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const entries = [
      { path: "a.md", metadata: { last_confirmed: oldDate }, fullPath: "/fake/a.md" },
    ];
    const result = stalenessSummary(entries);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain("older entry");
  });
});
