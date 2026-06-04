import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const wikiDir = join(tmpdir(), `flyd-test-wiki-${randomUUID()}`);

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, WIKI_DIR: wikiDir };
});

beforeEach(() => {
  mkdirSync(join(wikiDir, "skills"), { recursive: true });
  mkdirSync(join(wikiDir, "career"), { recursive: true });
  mkdirSync(join(wikiDir, "meta"), { recursive: true });
  writeFileSync(join(wikiDir, "skills", "react.md"), "---\ntype: skill\n---\n\n# React", "utf8");
  writeFileSync(join(wikiDir, "skills", "typescript.md"), "---\ntype: skill\n---\n\n# TypeScript", "utf8");
  writeFileSync(join(wikiDir, "career", "cto.md"), "---\ntype: career\n---\n\n# CTO at Acme", "utf8");
  writeFileSync(join(wikiDir, "meta", "notes.md"), "# Meta notes", "utf8");
  writeFileSync(join(wikiDir, "rejected.md"), "# Rejected\n\nNothing.", "utf8");
  writeFileSync(join(wikiDir, "index.md"), "# Index", "utf8");
});

afterEach(() => {
  rmSync(wikiDir, { recursive: true, force: true });
});

describe("walkWikiFiles", () => {
  it("returns all valid wiki files excluding meta, rejected, and index", async () => {
    const { walkWikiFiles } = await import("../wiki.js");
    const files = walkWikiFiles();
    const rel = files.map((f) => f.replace(wikiDir + "/", "")).sort();
    expect(rel).toEqual([
      "career/cto.md",
      "skills/react.md",
      "skills/typescript.md",
    ]);
  });
});

describe("readWikiFile", () => {
  it("reads frontmatter and body from a wiki file", async () => {
    const { readWikiFile } = await import("../wiki.js");
    const tmp = join(tmpdir(), `flyd-test-read-${randomUUID()}.md`);
    writeFileSync(tmp, "---\ntype: skill\nstatus: canon\n---\n\n# Go\n\n- Concurrency.", "utf8");
    const result = readWikiFile(tmp);
    expect(result.metadata.type).toBe("skill");
    expect(result.metadata.status).toBe("canon");
    expect(result.body).toBe("# Go\n\n- Concurrency.");
    rmSync(tmp);
  });

  it("parses a file with no metadata", async () => {
    const { readWikiFile } = await import("../wiki.js");
    const tmp = join(tmpdir(), `flyd-test-read-${randomUUID()}.md`);
    writeFileSync(tmp, "Just body text without frontmatter", "utf8");
    const result = readWikiFile(tmp);
    expect(result.metadata).toEqual({});
    expect(result.body).toBe("Just body text without frontmatter");
    rmSync(tmp);
  });
});

describe("WIKI_FOLDERS", () => {
  it("includes the topic folder", async () => {
    const { WIKI_FOLDERS } = await import("../wiki.js");
    expect(WIKI_FOLDERS.topic).toBe("topics");
  });
});

describe("wikiExists", () => {
  it("returns true when index.md exists", async () => {
    const { wikiExists } = await import("../wiki.js");
    expect(wikiExists()).toBe(true);
  });

  it("returns false when index.md missing", async () => {
    rmSync(join(wikiDir, "index.md"), { force: true });
    const { wikiExists } = await import("../wiki.js");
    expect(wikiExists()).toBe(false);
  });
});

describe("writeWikiPage", () => {
  it("writes a page and validates frontmatter", async () => {
    const { writeWikiPage, readWikiFile } = await import("../wiki.js");
    writeWikiPage("topics/test-topic.md", "---\ntype: topic\n---\n\n# Test Topic\n\nBody content.");
    expect(existsSync(join(wikiDir, "topics", "test-topic.md"))).toBe(true);
    const result = readWikiFile(join(wikiDir, "topics", "test-topic.md"));
    expect(result.metadata.type).toBe("topic");
    expect(result.body).toBe("# Test Topic\n\nBody content.");
  });

  it("creates parent directories", async () => {
    const { writeWikiPage } = await import("../wiki.js");
    writeWikiPage("deep/nested/page.md", "---\ntype: topic\n---\n\n# Deep");
    expect(existsSync(join(wikiDir, "deep", "nested", "page.md"))).toBe(true);
  });
});

describe("appendLog", () => {
  it("appends entries to log.md", async () => {
    const { appendLog } = await import("../wiki.js");
    appendLog({ type: "ingest", title: "Test ingestion", affected: ["topics/test.md"] });
    const logContent = readFileSync(join(wikiDir, "log.md"), "utf8");
    expect(logContent).toContain("ingest | Test ingestion");
    expect(logContent).toContain("topics/test.md");
  });
});

describe("createTopicPage", () => {
  it("creates a topic page with correct frontmatter and body", async () => {
    const { createTopicPage } = await import("../wiki.js");
    const { parse: parseFm } = await import("../frontmatter.js");
    const result = createTopicPage({
      slug: "test-concept",
      title: "Test Concept",
      body: "Content about the concept with [[wiki links]].",
      tags: ["test", "concept"],
      source: "ingest-auto",
      confidence: "high",
    });
    const parsed = parseFm(result);
    expect(parsed.metadata.type).toBe("topic");
    expect(parsed.metadata.source).toBe("ingest-auto");
    expect(parsed.metadata.confidence).toBe("high");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((parsed.metadata.tags as any[]).includes("test")).toBe(true);
    expect(parsed.body).toContain("# Test Concept");
    expect(parsed.body).toContain("[[wiki links]]");
  });
});
