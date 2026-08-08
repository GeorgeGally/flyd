import { describe, it, expect } from "vitest";
import { memoryGate, gateLearningCandidate, type LearningCandidate } from "../memory-gate.js";

describe("memoryGate", () => {
  const baseInput = {
    intent: "test",
    resolutionMode: "native",
    outcomeStatus: "succeeded",
    correction: null as string | null,
    intentHistory: [] as Array<{ intent: string; timestamp: string }>,
    topicCount: 0,
  };

  it("remembers explicit preferences", () => {
    const result = memoryGate({ ...baseInput, intent: "always keep answers short" });
    expect(result.shouldRemember).toBe(true);
  });

  it("remembers corrections from outcome", () => {
    const result = memoryGate({
      ...baseInput,
      intent: "tell me about cats",
      correction: "no, that's wrong — cats are mammals",
    });
    expect(result.shouldRemember).toBe(true);
  });

  it("remembers never/stop commands", () => {
    const result = memoryGate({ ...baseInput, intent: "never use emojis" });
    expect(result.shouldRemember).toBe(true);
  });

  it("remembers prefer commands", () => {
    const result = memoryGate({ ...baseInput, intent: "I prefer dark mode" });
    expect(result.shouldRemember).toBe(true);
  });

  it("discards generic QA questions", () => {
    const result = memoryGate({ ...baseInput, intent: "what is the capital of France" });
    expect(result.shouldRemember).toBe(false);
  });

  it("discards short factual questions", () => {
    const result = memoryGate({ ...baseInput, intent: "how do I" });
    expect(result.shouldRemember).toBe(false);
  });

  it("remembers repeated topics", () => {
    const history = [
      { intent: "python programming tips", timestamp: new Date().toISOString() },
      { intent: "python programming guide", timestamp: new Date().toISOString() },
      { intent: "python programming help", timestamp: new Date().toISOString() },
    ];
    const result = memoryGate({
      ...baseInput,
      intent: "python programming basics",
      intentHistory: history,
      topicCount: 4,
    });
    expect(result.shouldRemember).toBe(true);
    expect(result.category).toBe("repeated_topic");
  });
});

describe("gateLearningCandidate", () => {
  function makeCandidate(overrides: Partial<LearningCandidate> = {}): LearningCandidate {
    return {
      id: "test-1",
      source: "correction",
      content: "User prefers concise responses",
      domain: "response_style",
      outcomeRef: "outcome-123",
      epistemicConfidence: "high",
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  it("passes a correction with high confidence", () => {
    const result = gateLearningCandidate(makeCandidate({ source: "correction", epistemicConfidence: "high" }));
    expect(result.shouldRemember).toBe(true);
    expect(result.category).toBe("correction");
    expect(result.confidence).toBe("high");
  });

  it("passes an accepted standard with medium confidence", () => {
    const result = gateLearningCandidate(makeCandidate({ source: "accepted_standard", epistemicConfidence: "medium" }));
    expect(result.shouldRemember).toBe(true);
    expect(result.category).toBe("accepted_standard");
  });

  it("passes a durable decision with high confidence", () => {
    const result = gateLearningCandidate(makeCandidate({ source: "durable_decision", epistemicConfidence: "high" }));
    expect(result.shouldRemember).toBe(true);
  });

  it("passes a productive procedure with medium confidence", () => {
    const result = gateLearningCandidate(makeCandidate({ source: "productive_procedure", epistemicConfidence: "medium" }));
    expect(result.shouldRemember).toBe(true);
  });

  it("passes a verified outcome with high confidence", () => {
    const result = gateLearningCandidate(makeCandidate({ source: "verified_outcome", epistemicConfidence: "high" }));
    expect(result.shouldRemember).toBe(true);
    expect(result.category).toBe("verified_outcome");
  });

  it("rejects a correction with low confidence", () => {
    const result = gateLearningCandidate(makeCandidate({ source: "correction", epistemicConfidence: "low" }));
    expect(result.shouldRemember).toBe(false);
    expect(result.confidence).toBe("low");
  });

  it("rejects a verified outcome with low confidence", () => {
    const result = gateLearningCandidate(makeCandidate({ source: "verified_outcome", epistemicConfidence: "low" }));
    expect(result.shouldRemember).toBe(false);
  });

  it("preserves existing gate test cases", () => {
    const result = memoryGate({
      intent: "what is the capital of France",
      resolutionMode: "native",
      outcomeStatus: "succeeded",
      correction: null,
      intentHistory: [],
      topicCount: 0,
    });
    expect(result.shouldRemember).toBe(false);
    expect(result.category).toBe("generic_qa");
  });
});
