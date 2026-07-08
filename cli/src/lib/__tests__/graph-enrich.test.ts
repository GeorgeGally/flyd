import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const testFlydDir = join(tmpdir(), `flyd-test-graph-enrich-${randomUUID()}`);
const testRawDir = join(testFlydDir, "raw");
const testWikiDir = join(testFlydDir, "wiki");
const testGraphDir = join(testFlydDir, "graph");

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    FLYD_DIR: testFlydDir,
    RAW_DIR: testRawDir,
    WIKI_DIR: testWikiDir,
  };
});

beforeEach(() => {
  mkdirSync(testRawDir, { recursive: true });
  mkdirSync(testWikiDir, { recursive: true });
  mkdirSync(testGraphDir, { recursive: true });
  // Initialize graph with version 1
  writeFileSync(join(testGraphDir, "graph.json"), JSON.stringify({
    version: 1,
    built: "2026-01-01T00:00:00.000Z",
    entities: {},
    edges: [],
  }));
});

afterEach(() => {
  rmSync(testFlydDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("graph enrich functions", () => {
  describe("searchGraph", () => {
    it("returns empty array when graph has no matching nodes", async () => {
      const { searchGraph } = await import("../../lib/graph.js");
      const results = searchGraph("nonexistent", 1);
      expect(results).toHaveLength(0);
    });

    it("finds edges via BFS from matching nodes", async () => {
      // Populate graph with known entities
      writeFileSync(join(testGraphDir, "graph.json"), JSON.stringify({
        version: 2,
        built: "2026-06-01T00:00:00.000Z",
        entities: {
          "flyd": { path: "flyd", type: "project", lastUpdated: "2026-06-01", links: [] },
          "qmd": { path: "qmd", type: "tool", lastUpdated: "2026-06-01", links: [] },
        },
        edges: [
          { from: "flyd", to: "qmd", rel_type: "uses", confidence: 0.9, source: "frontmatter" },
        ],
      }));

      const { searchGraph } = await import("../../lib/graph.js");
      const results = searchGraph("flyd", 2);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.from === "flyd" && r.to === "qmd")).toBe(true);
    });

    it("returns up to maxHops depth", async () => {
      writeFileSync(join(testGraphDir, "graph.json"), JSON.stringify({
        version: 2,
        built: "2026-06-01T00:00:00.000Z",
        entities: {
          "test-a": { path: "test-a", type: "concept", lastUpdated: "2026-06-01", links: [] },
          "test-b": { path: "test-b", type: "concept", lastUpdated: "2026-06-01", links: [] },
          "test-c": { path: "test-c", type: "concept", lastUpdated: "2026-06-01", links: [] },
        },
        edges: [
          { from: "test-a", to: "test-b", rel_type: "relates", confidence: 0.8, source: "frontmatter" },
          { from: "test-b", to: "test-c", rel_type: "relates", confidence: 0.6, source: "frontmatter" },
        ],
      }));

      const { searchGraph } = await import("../../lib/graph.js");
      const results1 = searchGraph("test-a", 1);
      expect(results1).toHaveLength(1);

      const results2 = searchGraph("test-a", 2);
      expect(results2).toHaveLength(2);
    });
  });

  describe("getRelatedNodes", () => {
    it("returns related nodes sorted by confidence desc", async () => {
      writeFileSync(join(testGraphDir, "graph.json"), JSON.stringify({
        version: 2,
        built: "2026-06-01T00:00:00.000Z",
        entities: {
          "flyd": { path: "flyd", type: "project", lastUpdated: "2026-06-01", links: [] },
          "qmd": { path: "qmd", type: "tool", lastUpdated: "2026-06-01", links: [] },
          "typescript": { path: "typescript", type: "language", lastUpdated: "2026-06-01", links: [] },
        },
        edges: [
          { from: "flyd", to: "qmd", rel_type: "uses", confidence: 0.9, source: "frontmatter" },
          { from: "flyd", to: "typescript", rel_type: "written-in", confidence: 0.7, source: "frontmatter" },
        ],
      }));

      const { getRelatedNodes } = await import("../../lib/graph.js");
      const results = getRelatedNodes("flyd");
      expect(results).toHaveLength(2);
      expect(results[0].confidence).toBeGreaterThanOrEqual(results[1].confidence);
    });
  });

  describe("getGraphStats", () => {
    it("counts bodyEdges and frontmatterEdges separately", async () => {
      writeFileSync(join(testGraphDir, "graph.json"), JSON.stringify({
        version: 2,
        built: "2026-06-01T00:00:00.000Z",
        entities: {},
        edges: [
          { from: "a", to: "b", rel_type: "relates", confidence: 0.8, source: "frontmatter" },
          { from: "c", to: "d", rel_type: "relates", confidence: 0.6, source: "body-extraction" },
        ],
      }));

      const { getGraphStats } = await import("../../lib/graph.js");
      const stats = getGraphStats();
      expect(stats.frontmatterEdges).toBe(1);
      expect(stats.bodyEdges).toBe(1);
      expect(stats.edges).toBe(2);
    });
  });
});
