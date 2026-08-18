import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { rawDir } = vi.hoisted(() => {
  const { join } = require("path") as typeof import("path");
  const { tmpdir } = require("os") as typeof import("os");
  const { randomUUID } = require("crypto") as typeof import("crypto");
  return { rawDir: join(tmpdir(), `flyd-memory-ingest-${randomUUID()}`) };
});

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, RAW_DIR: rawDir, PROJECT: { name: "flyd", path: "/tmp/flyd" } };
});

import {
  extractMemoryPayload,
  handleIndexNowUtterance,
  handleMemoryIngestUtterance,
  isIndexNowUtterance,
  isMemoryIngestUtterance,
  splitMemoryEntries,
} from "../memory-ingest.js";
import { presentModelReply } from "../conversation-responder.js";

describe("memory ingest", () => {
  beforeEach(() => {
    mkdirSync(rawDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rawDir, { recursive: true, force: true });
  });

  it("detects add-to-memory intents", () => {
    expect(isMemoryIngestUtterance("add these to memories. foo")).toBe(true);
    expect(isMemoryIngestUtterance("add these to memory:")).toBe(true);
    expect(isMemoryIngestUtterance("remember this: I like tea")).toBe(true);
    expect(isMemoryIngestUtterance("add Bridgestone and Linkedin bio")).toBe(false);
  });

  it("captures a short explicit 'remember this' statement inline", async () => {
    const reply = await handleMemoryIngestUtterance("remember this: I like tea and long walks");
    expect(reply).toMatch(/Saved 1 memory lines to the raw archive/);
    const files = readdirSync(rawDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(1);
    const bodies = files.map((file) => readFileSync(join(rawDir, file), "utf8"));
    expect(bodies.some((text) => text.includes("I like tea and long walks"))).toBe(true);
  });

  it("does not hijack ordinary 'remember'/'capture' statements", () => {
    expect(isMemoryIngestUtterance("remember to buy milk")).toBe(false);
    expect(isMemoryIngestUtterance("remember we have a meeting at 3")).toBe(false);
    expect(isMemoryIngestUtterance("capture a screenshot")).toBe(false);
    expect(isMemoryIngestUtterance("capture the meeting notes")).toBe(false);
    expect(isMemoryIngestUtterance("save this to memory")).toBe(true);
  });

  it("strips the lead-in from the payload", () => {
    const payload = extractMemoryPayload(
      "add these to memories. this is extracted memories from chatgpt: [date] - Preferred name: George.",
    );
    expect(payload).toContain("Preferred name: George");
    expect(payload).not.toMatch(/^add these/i);
  });

  it("saves a long memory paste to the raw archive", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `[2026-01-${String(i + 1).padStart(2, "0")}] - Fact number ${i}.`).join("\n");
    const message = `add these to memories. this is extracted memories from chatgpt: ${body}`;
    const reply = await handleMemoryIngestUtterance(message);
    expect(reply).toMatch(/Saved 30 memories as separate archive entries/);
    const files = readdirSync(rawDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(30);
    const bodies = files.map((file) => readFileSync(join(rawDir, file), "utf8"));
    expect(bodies.some((text) => text.includes("Fact number 0"))).toBe(true);
  });

  it("splits a ChatGPT memory dump into one archive file per entry", async () => {
    const body = [
      "[date unavailable] - Preferred name: George.",
      "[2025-04-23] - Building Kokoland, a parenting voice app.",
      "[2025-04-24] - Kokoland voice-system concern: interruption handling.",
      "[2025-05-05] - Focusing on Kokoland as the active product.",
    ].join("\n");
    const reply = await handleMemoryIngestUtterance(`remember this:\n${body}`);
    expect(reply).toMatch(/Saved 4 memories as separate archive entries/);
    const files = readdirSync(rawDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(4);
    const bodies = files.map((file) => readFileSync(join(rawDir, file), "utf8"));
    expect(bodies.some((text) => text.includes("Preferred name: George"))).toBe(true);
  });

  it("leaves unstructured prose as a single capture", () => {
    expect(splitMemoryEntries("remember that I like tea and also long walks.")).toHaveLength(1);
  });

  it("handles index now locally without requiring an agent loop", async () => {
    expect(isIndexNowUtterance("index now")).toBe(true);
    expect(isIndexNowUtterance("reindex")).toBe(true);
    expect(isIndexNowUtterance("update the index")).toBe(true);
    expect(isIndexNowUtterance("what is the index now")).toBe(false);
    const reply = await handleIndexNowUtterance("index now");
    expect(reply).toMatch(/Memory index updated/);
    expect(reply).toMatch(/Interests:/);
  });

  it("does not treat long pastes containing 'active projects' as Present Model questions", () => {
    const paste = `add these to memories.\n[2025-09-01] - treated Koko and Museq1 as active projects.\n${"x".repeat(400)}`;
    expect(
      presentModelReply(
        paste,
        "Get GNM sponsor outreach moving is first — due 5 September.",
      ),
    ).toBeNull();
  });
});
