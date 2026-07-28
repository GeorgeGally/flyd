import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createMemoryReceipt } from "../memory-receipt.js";
import { persistReceipt } from "../memory-persistence.js";

const OVERLAY_TEST_DIR = join(homedir(), ".flyd", "raw", "overlay");

describe("persistReceipt", () => {
  afterEach(() => {
    try { rmSync(OVERLAY_TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  it("writes receipt with event-semantic frontmatter fields", async () => {
    const receipt = createMemoryReceipt(
      "keep answers short",
      "augment",
      "succeeded",
      "Chrome - AXTextArea",
      null,
      "Explicit preference: keep answers short",
      "explicit_preference"
    );

    const filepath = await persistReceipt(receipt);
    expect(filepath).toBeTruthy();
    expect(existsSync(filepath!)).toBe(true);

    const content = readFileSync(filepath!, "utf-8");
    expect(content).toContain("timestamp:");
    expect(content).toContain("event_type: explicit_preference");
    expect(content).toContain("outcome: succeeded");
    expect(content).toContain("signal: preference");
    expect(content).toContain("topics:");
    expect(content).toContain("  - ");
    expect(content).toContain("generated_at:");
    expect(content).toContain("category: Explicit preference");
  });

  it("writes receipt with correction event type", async () => {
    const receipt = createMemoryReceipt(
      "no, not that",
      "native",
      "rejected",
      "",
      "I wanted a table",
      "user correction",
      "correction"
    );

    const filepath = await persistReceipt(receipt);
    const content = readFileSync(filepath!, "utf-8");
    expect(content).toContain("event_type: correction");
    expect(content).toContain("signal: correction_feedback");
    expect(content).toContain("outcome: rejected");
  });

  it("does not include topics block when topics are empty", async () => {
    const receipt = createMemoryReceipt(
      "hi",
      "native",
      "succeeded",
      "",
      null,
      "generic",
      "generic_qa"
    );
    expect(receipt.topics).toEqual([]);

    const filepath = await persistReceipt(receipt);
    const content = readFileSync(filepath!, "utf-8");
    expect(content).not.toContain("topics:");
  });

  it("timestamp has no trailing Z to avoid daysAgo double-append bug", async () => {
    const receipt = createMemoryReceipt(
      "keep answers short",
      "augment",
      "succeeded",
      "",
      null,
      "explicit",
      "explicit_preference"
    );
    const filepath = await persistReceipt(receipt);
    const content = readFileSync(filepath!, "utf-8");
    const timestampLine = content.split("\n").find((l) => l.startsWith("timestamp:"));
    expect(timestampLine).toBeDefined();
    expect(timestampLine).not.toContain("Z");
  });
});
