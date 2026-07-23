import { describe, it, expect } from "vitest";
import { memoryGate } from "../memory-gate.js";

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
