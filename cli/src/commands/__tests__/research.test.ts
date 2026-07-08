import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const rawDir = join(tmpdir(), `flyd-test-research-${randomUUID()}`);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, RAW_DIR: rawDir };
});

vi.mock("../../lib/llm.js", async () => ({
  query: vi.fn().mockResolvedValue(`## Overview
Edge computing is a distributed computing paradigm that brings computation closer to data sources.

## Key Facts
- Reduces latency by processing data locally
- Key players: AWS, Cloudflare, Fastly

## Current Landscape
Growing adoption in IoT, autonomous vehicles, and CDN services.

## Connections
Related to: cloud computing, IoT, 5G networks, CDN`),
}));

beforeEach(() => {
  mkdirSync(rawDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(rawDir, { recursive: true, force: true });
});

describe("runResearch", () => {
  it("writes a research capture to RAW_DIR", async () => {
    const { runResearch } = await import("../research.js");
    await runResearch("edge computing");
    const files = readdirSync(rawDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(1);
    const content = readFileSync(join(rawDir, files[0]), "utf8");
    expect(content).toContain("source: research");
    expect(content).toContain("type: research");
    expect(content).toContain("topic: edge computing");
    expect(content).toContain("Edge computing");
  });

  it("generates a timestamp-based filename", async () => {
    const { runResearch } = await import("../research.js");
    await runResearch("Rust");
    const files = readdirSync(rawDir);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
  });

  it("creates the raw directory if needed", async () => {
    rmSync(rawDir, { recursive: true, force: true });
    expect(existsSync(rawDir)).toBe(false);
    const { runResearch } = await import("../research.js");
    await runResearch("test");
    expect(existsSync(rawDir)).toBe(true);
  });

  it("passes topic to the LLM", async () => {
    const llm = await import("../../lib/llm.js");
    const { runResearch } = await import("../research.js");
    await runResearch("TypeScript generics");
    expect(llm.query).toHaveBeenCalled();
    const prompt = (llm.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prompt).toContain("TypeScript generics");
  });
});
