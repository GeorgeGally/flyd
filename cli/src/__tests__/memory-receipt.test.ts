import { describe, it, expect } from "vitest";
import { createMemoryReceipt, provisionalLearn, getPendingLearnings, acknowledgeLearning } from "../memory-receipt.js";

describe("createMemoryReceipt", () => {
  it("creates a self-contained receipt", () => {
    const receipt = createMemoryReceipt(
      "always use tabs",
      "native",
      "succeeded",
      "Chrome — AXTextArea",
      null,
      "explicit preference"
    );
    expect(receipt.receiptId).toBeTruthy();
    expect(receipt.source).toBe("flyd-overlay");
    expect(receipt.belief.what).toBe("explicit preference");
    expect(receipt.selfContained).toBe(true);
  });

  it("includes correction when provided", () => {
    const receipt = createMemoryReceipt(
      "tell me about birds",
      "native",
      "failed",
      "Chrome — AXTextArea",
      "not what I wanted",
      "user correction"
    );
    expect(receipt.selfContained).toBe(true);
    expect(receipt.belief.what).toBe("user correction");
    expect(receipt.evidence.correction).toBe("not what I wanted");
  });
});

describe("provisionalLearn", () => {
  it("detects verbosity preference", () => {
    const learning = provisionalLearn("keep answers short");
    expect(learning).not.toBeNull();
    expect(learning!.domain).toBe("response_verbosity");
    expect(learning!.value).toBe("concise");
  });

  it("detects style preference", () => {
    const learning = provisionalLearn("write in the style of Shakespeare");
    expect(learning).not.toBeNull();
    expect(learning!.domain).toBe("response_style");
  });

  it("detects format preference", () => {
    const learning = provisionalLearn("show as bullet");
    expect(learning).not.toBeNull();
    expect(learning!.domain).toBe("response_format");
  });

  it("returns null for generic intents", () => {
    const learning = provisionalLearn("what time is it");
    expect(learning).toBeNull();
  });
});

describe("learning lifecycle", () => {
  it("tracks pending learnings", () => {
    provisionalLearn("keep answers short");
    const pending = getPendingLearnings();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].domain).toBe("response_verbosity");
  });

  it("acknowledges learnings", () => {
    const learning = provisionalLearn("keep answers short");
    expect(learning).not.toBeNull();
    const ok = acknowledgeLearning(learning!.learningId);
    expect(ok).toBe(true);
    const pending = getPendingLearnings();
    expect(pending.find((l) => l.learningId === learning!.learningId)).toBeUndefined();
  });

  it("returns false for unknown learningId", () => {
    expect(acknowledgeLearning("nonexistent")).toBe(false);
  });
});
