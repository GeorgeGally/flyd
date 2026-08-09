import { describe, expect, it } from "vitest";
import { openAICompletionLimit, openAIAgentTransport } from "../llm.js";

describe("OpenAI-compatible request parameters", () => {
  it("uses max_completion_tokens for the configured primary model", () => {
    expect(openAICompletionLimit(2048)).toEqual({ max_completion_tokens: 2048 });
    expect(openAICompletionLimit(2048)).not.toHaveProperty("max_tokens");
  });

  it("uses the Responses API for reasoning models with function tools", () => {
    expect(openAIAgentTransport("gpt-5.6-luna")).toBe("responses");
    expect(openAIAgentTransport("gpt-4o-mini")).toBe("chat_completions");
  });
});
