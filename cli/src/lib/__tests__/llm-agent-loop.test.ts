import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  script: [] as Array<string | null>,
  openAIResponses: [] as Array<{ finish_reason: string; content: string; tool_calls?: unknown[] }>,
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
          const response = state.openAIResponses.shift() ?? { finish_reason: "stop", content: "answer" };
          return { choices: [{ finish_reason: response.finish_reason, message: { content: response.content, tool_calls: response.tool_calls } }] };
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
  beforeEach(() => {
    vi.stubEnv("FLYD_PROVIDER", "anthropic");
    vi.stubEnv("FLYD_MODEL_API_KEY", "test-key");
  });

  afterEach(() => {
    state.calls.length = 0;
    state.script.length = 0;
    state.openAIResponses.length = 0;
    state.cursor = 0;
    vi.unstubAllEnvs();
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

  it("honors a caller's smaller tool budget for a conversational turn", async () => {
    state.script = ["grep", "grep", null];
    const called: string[] = [];

    const answer = await agentLoop(
      "system",
      "quick question",
      [readTool],
      (name) => {
        called.push(name);
        return "ok";
      },
      "claude-test",
      2,
    );

    expect(answer).toBe("final answer");
    expect(called).toEqual(["grep"]);
    expect(state.calls.at(-1)).not.toHaveProperty("tools");
  });

  it("omits temperature from OpenAI-compatible chat requests", async () => {
    process.env.FLYD_MODEL_API_KEY = "test-key";
    await agentLoop("system", "answer", [], () => "", "gpt-4o-mini", 1);

    expect(state.calls.at(-1)).not.toHaveProperty("temperature");
  });

  it("retries an OpenAI-compatible provider that returns DSML tool markup as text", async () => {
    state.openAIResponses.push(
      { finish_reason: "stop", content: "<｜｜DSML｜｜calls><｜｜DSML｜｜invoke name=\"grep\">x</｜｜DSML｜｜invoke>" },
      { finish_reason: "stop", content: "grounded answer" },
    );

    const answer = await agentLoop("system", "answer", [readTool], () => "", "gpt-4o-mini", 3);

    expect(answer).toBe("grounded answer");
    expect(state.calls).toHaveLength(2);
    const retryMessages = state.calls[1].messages as Array<{ role: string; content: string }>;
    expect(retryMessages.some((message) => message.content.includes("not user-facing text"))).toBe(true);
  });
});
