import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const FLYD_DIR = join(tmpdir(), `flyd-test-ingest-${randomUUID()}`);
const wikiDir = join(FLYD_DIR, "wiki");
const rawDir = join(FLYD_DIR, "raw");
const cacheDir = join(FLYD_DIR, "cache");

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    FLYD_DIR,
    WIKI_DIR: wikiDir,
    RAW_DIR: rawDir,
    CACHE_DIR: cacheDir,
  };
});

function setupWiki(): void {
  mkdirSync(wikiDir, { recursive: true });
  mkdirSync(join(wikiDir, "topics"), { recursive: true });
  mkdirSync(join(wikiDir, "meta"), { recursive: true });
  writeFileSync(join(wikiDir, "index.md"), "# Wiki Index\n\n## topics (1)\n- [topics/react.md](topics/react.md) — React patterns\n", "utf8");
  writeFileSync(join(wikiDir, "schema.md"), "# Schema\n", "utf8");
  writeFileSync(join(wikiDir, "log.md"), "", "utf8");
}

function setupRaw(): void {
  mkdirSync(rawDir, { recursive: true });
}

beforeEach(() => {
  setupWiki();
  setupRaw();
});

afterEach(() => {
  rmSync(FLYD_DIR, { recursive: true, force: true });
});

describe("addToQueue", () => {
  it("adds non-trivial captures to the queue", async () => {
    const filename = "test-capture.md";
    writeFileSync(
      join(rawDir, filename),
      "---\ntimestamp: 2026-06-04 15:30:00\n---\n\nThis is a significant capture about React components and their lifecycle hooks in modern applications.",
      "utf8"
    );

    const { addToQueue, getQueueSize } = await import("../../lib/ingest.js");
    const added = addToQueue(filename);
    expect(added).toBe(true);
    expect(getQueueSize()).toBe(1);
  });

  it("skips trivial captures", async () => {
    const filename = "short-capture.md";
    writeFileSync(join(rawDir, filename), "---\ntimestamp: 2026-06-04\n---\n\nok cool thanks", "utf8");

    const { addToQueue, getQueueSize } = await import("../../lib/ingest.js");
    const added = addToQueue(filename);
    expect(added).toBe(false);
    expect(getQueueSize()).toBe(0);
  });

  it("skips non-existent captures", async () => {
    const { addToQueue } = await import("../../lib/ingest.js");
    const added = addToQueue("nonexistent.md");
    expect(added).toBe(false);
  });

  it("handles empty queue gracefully", async () => {
    const { getQueueSize, clearQueue } = await import("../../lib/ingest.js");
    clearQueue();
    expect(getQueueSize()).toBe(0);
  });
});

describe("getQueuedTopics", () => {
  it("finds topics with 3+ mentions not yet in wiki", async () => {
    const { addToQueue, getQueuedTopics } = await import("../../lib/ingest.js");

    const topic = "typescript patterns modern types";
    for (let i = 0; i < 4; i++) {
      const filename = `capture-${i}.md`;
      writeFileSync(
        join(rawDir, filename),
        `---\ntimestamp: 2026-06-0${i + 1}\n---\n\nDiscussion about ${topic} in the codebase. We explored how to use advanced types.`,
        "utf8"
      );
      addToQueue(filename);
    }

    const topics = getQueuedTopics();
    const tsTopic = topics.find(t => t.topic === "typescript");
    expect(tsTopic).toBeDefined();
    expect(tsTopic!.count).toBeGreaterThanOrEqual(3);
  });
});

describe("runBatchIngest", () => {
  it("returns null when queue is empty", async () => {
    const { runBatchIngest, clearQueue } = await import("../../lib/ingest.js");
    clearQueue();
    const result = await runBatchIngest();
    expect(result).toBeNull();
  });
});
