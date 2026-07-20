import { describe, expect, it } from "vitest";
import { interpretAgentInput } from "../input-interpreter.js";

describe("interpretAgentInput", () => {
  it("keeps ordinary conversation out of the coding runtime", () => {
    expect(interpretAgentInput("let's just chat")).toEqual({
      kind: "conversation",
      message: "let's just chat",
    });
    expect(interpretAgentInput("What was I last working on?")).toEqual({
      kind: "conversation",
      message: "What was I last working on?",
    });
  });

  it("routes concrete repository changes to the coding runtime", () => {
    expect(interpretAgentInput("Fix chat so cmd+enter submits")).toEqual({
      kind: "coding",
      outcome: "Fix chat so cmd+enter submits",
    });
    expect(interpretAgentInput("Can you implement the next PRD slice?")).toEqual({
      kind: "coding",
      outcome: "Can you implement the next PRD slice?",
    });
    expect(interpretAgentInput("Could you fix the failing test?")).toEqual({
      kind: "coding",
      outcome: "Could you fix the failing test?",
    });
    expect(interpretAgentInput("Would you update the chat prompt?")).toEqual({
      kind: "coding",
      outcome: "Would you update the chat prompt?",
    });
    expect(interpretAgentInput("I need you to fix chat now")).toEqual({
      kind: "coding",
      outcome: "I need you to fix chat now",
    });
    expect(interpretAgentInput("Investigate the failing test")).toEqual({
      kind: "coding",
      outcome: "Investigate the failing test",
    });
    expect(interpretAgentInput("Review this PR")).toEqual({
      kind: "coding",
      outcome: "Review this PR",
    });
  });

  it("keeps ordinary personal actions in conversation", () => {
    expect(interpretAgentInput("Build me a travel itinerary")).toEqual({
      kind: "conversation",
      message: "Build me a travel itinerary",
    });
    expect(interpretAgentInput("Add milk to my shopping list")).toEqual({
      kind: "conversation",
      message: "Add milk to my shopping list",
    });
    expect(interpretAgentInput("Remove this reminder")).toEqual({
      kind: "conversation",
      message: "Remove this reminder",
    });
  });

  it("supports explicit session controls without treating them as conversation", () => {
    expect(interpretAgentInput("/code improve startup speed")).toEqual({
      kind: "coding",
      outcome: "improve startup speed",
    });
    expect(interpretAgentInput("/resume")).toEqual({ kind: "resume" });
    expect(interpretAgentInput("/exit")).toEqual({ kind: "exit" });
  });

  it("does not mistake questions about coding for permission to edit", () => {
    expect(interpretAgentInput("Why is the chat so slow?")).toEqual({
      kind: "conversation",
      message: "Why is the chat so slow?",
    });
    expect(interpretAgentInput("How should we fix the memory system?")).toEqual({
      kind: "conversation",
      message: "How should we fix the memory system?",
    });
  });
});
