import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  script: [] as Array<string | null>,
  cursor: 0,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: (params: Record<string, unknown>) => {
        state.calls.push(params);
        const toolName = state.script[state.cursor] ?? null;
        state.cursor += 1;
        if (params.tools && toolName) {
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: `t${state.cursor}`, name: toolName, input: { pattern: "x" } }],
          };
        }
        return { stop_reason: "end_turn", content: [{ type: "text", text: "final answer" }] };
      },
    };
  },
}));

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: (params: Record<string, unknown>) => {
          state.calls.push(params);
          return { choices: [{ finish_reason: "stop", message: { content: "answer" } }] };
        },
      },
    };
  },
}));

import { agentLoop } from "../llm.js";

const readTool = {
  name: "grep",
  description: "search",
  input_schema: { type: "object" as const, properties: {}, required: [] },
};

describe("agentLoop tool budget", () => {
  afterEach(() => {
    state.calls.length = 0;
    state.script.length = 0;
    state.cursor = 0;
    process.env.FLYD_MODEL_API_KEY = "test-key";
  });

  it("reaches a write after more than eight read rounds", async () => {
    process.env.FLYD_MODEL_API_KEY = "test-key";
    const readRounds = 12;
    state.script = [...Array(readRounds).fill("grep"), "edit_file", null];
    const tools = [readTool, { ...readTool, name: "edit_file" }];
    const called: string[] = [];

    const answer = await agentLoop(
      "system",
      "fix the thing",
      tools,
      (name) => {
        called.push(name);
        return "ok";
      },
      "claude-test",
    );

    expect(answer).toBe("final answer");
    expect(called.filter((name) => name === "grep")).toHaveLength(readRounds);
    expect(called).toContain("edit_file");
  });

  it("names Flyd's own tool limit instead of faking an external failure", async () => {
    process.env.FLYD_MODEL_API_KEY = "test-key";
    state.script = Array.from({ length: 64 }, () => "grep");

    const answer = await agentLoop("system", "endless", [readTool], () => "ok", "claude-test");

    const last = state.calls.at(-1) as Record<string, unknown>;
    expect(last.tools).toBeUndefined();
    expect(String(last.system)).toContain("Flyd's tool-call limit");
    expect(String(last.system)).not.toContain("Tool budget is exhausted");
    expect(answer).toBe("final answer");
  });

  it("omits temperature from OpenAI-compatible chat requests", async () => {
    process.env.FLYD_MODEL_API_KEY = "test-key";
    await agentLoop("system", "answer", [], () => "", "gpt-4o-mini", 1);

    expect(state.calls.at(-1)).not.toHaveProperty("temperature");
  });
});
