import { describe, it, expect } from "vitest";
import { createMemoryReceipt, createLearningReceipt, provisionalLearn, getPendingLearnings, acknowledgeLearning } from "../memory-receipt.js";

describe("createMemoryReceipt", () => {
  it("creates a self-contained receipt", () => {
    const receipt = createMemoryReceipt(
      "always use tabs",
      "native",
      "succeeded",
      "Chrome — AXTextArea",
      null,
      "explicit preference",
      "explicit_preference"
    );
    expect(receipt.receiptId).toBeTruthy();
    expect(receipt.source).toBe("flyd-overlay");
    expect(receipt.belief.what).toBe("explicit preference");
    expect(receipt.selfContained).toBe(true);
    expect(receipt.eventType).toBe("explicit_preference");
    expect(receipt.derivedSignal).toBe("preference");
    expect(receipt.topics).toContain("tabs");
  });

  it("includes correction when provided", () => {
    const receipt = createMemoryReceipt(
      "tell me about birds",
      "native",
      "failed",
      "Chrome — AXTextArea",
      "not what I wanted",
      "user correction",
      "correction"
    );
    expect(receipt.selfContained).toBe(true);
    expect(receipt.belief.what).toBe("user correction");
    expect(receipt.evidence.correction).toBe("not what I wanted");
    expect(receipt.eventType).toBe("correction");
    expect(receipt.derivedSignal).toBe("correction_feedback");
  });

  it("produces empty topics for short generic intents", () => {
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
  });

  it("extracts keywords as topics from intent text", () => {
    const receipt = createMemoryReceipt(
      "flyd should remember that George prefers dark mode",
      "native",
      "succeeded",
      "",
      null,
      "explicit preference",
      "explicit_preference"
    );
    expect(receipt.topics.length).toBeGreaterThan(0);
    expect(receipt.topics).toContain("flyd");
  });
});

describe("createLearningReceipt", () => {
  const candidate = {
    id: "candidate-1",
    source: "correction" as const,
    content: "User prefers dark mode",
    domain: "response_style",
    outcomeRef: "outcome-123",
    epistemicConfidence: "high" as const,
    timestamp: "2026-08-05T00:00:00.000Z",
  };

  it("carries provenance fields", () => {
    const receipt = createLearningReceipt(candidate, "correction gate: high confidence", "response_style");
    expect(receipt.provenance.epistemicConfidence).toBe("high");
    expect(receipt.provenance.sourceType).toBe("correction");
    expect(receipt.provenance.domain).toBe("response_style");
    expect(receipt.provenance.outcomeRef).toBe("outcome-123");
    expect(receipt.provenance.timestamp).toBe("2026-08-05T00:00:00.000Z");
  });

  it("is distinguishable from legacy resolution receipts", () => {
    const learningReceipt = createLearningReceipt(candidate, "gate reason", "domain");
    const legacyReceipt = createMemoryReceipt(
      "test intent", "native", "succeeded", "env", null, "reason", "explicit_preference"
    );

    expect(learningReceipt.source).toBe("flyd-work-intelligence");
    expect(legacyReceipt.source).toBe("flyd-overlay");
    expect(learningReceipt.eventType).toBe("wt_correction");
    expect(legacyReceipt.eventType).toBe("explicit_preference");
  });

  it("preserves epistemic confidence and source type", () => {
    const receipt = createLearningReceipt(
      { ...candidate, epistemicConfidence: "medium", source: "verified_outcome" },
      "gate reason",
      "test_domain"
    );
    expect(receipt.provenance.epistemicConfidence).toBe("medium");
    expect(receipt.provenance.sourceType).toBe("verified_outcome");
  });

  it("generates unique receipt IDs", () => {
    const r1 = createLearningReceipt(candidate, "reason", "domain");
    const r2 = createLearningReceipt(candidate, "reason", "domain");
    expect(r1.receiptId).not.toBe(r2.receiptId);
  });

  it("extracts topics from learning content", () => {
    const receipt = createLearningReceipt(
      { ...candidate, content: "flyd should remember dark mode preferences" },
      "reason",
      "domain"
    );
    expect(receipt.topics.length).toBeGreaterThan(0);
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
