import { describe, it, expect, vi, beforeAll } from "vitest";

const calls: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: (params: Record<string, unknown>) => {
        calls.push(params);
        if (params.tools) {
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "t1", name: "grep", input: { pattern: "x" } }],
          };
        }
        return { stop_reason: "end_turn", content: [{ type: "text", text: "best available answer" }] };
      },
    };
  },
}));

import { agentLoop } from "../llm.js";

describe("agentLoop budget exhaustion", () => {
  beforeAll(() => {
    process.env.FLYD_MODEL_API_KEY = "test-key";
  });

  it("forces a no-tools final answer instead of throwing when budget is exhausted", async () => {
    const tool = {
      name: "grep",
      description: "search",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    };
    const answer = await agentLoop(
      "system",
      "do the thing",
      [tool],
      () => "no matches",
      "claude-test",
      2,
    );

    expect(answer).toBe("best available answer");
    expect(calls.length).toBe(2);
    expect(calls[0].tools).toBeTruthy();
    expect(calls[1].tools).toBeUndefined();
    expect(String(calls[1].system)).toContain("Tool budget is exhausted");
  });
});
