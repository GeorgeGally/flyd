import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ params: Record<string, unknown>; options: Record<string, unknown>; client: Record<string, unknown> }>,
  replies: [] as Array<Record<string, unknown>>,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(private readonly config: Record<string, unknown>) {}
    messages = {
      create: (params: Record<string, unknown>, options: Record<string, unknown> = {}) => {
        state.calls.push({ params, options, client: this.config });
        return state.replies.shift() ?? {
          stop_reason: "end_turn",
          content: [{ type: "thinking", thinking: "" }, { type: "text", text: "final answer" }],
          usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
        };
      },
    };
  },
}));

import { agentLoop, agentLoopWithFailover, PROMPT_CACHE_BREAK, quickQuery, resetProviderCooldowns } from "../llm.js";
import { readSpendLedger } from "../claude-spend.js";

const tool = {
  name: "web_search",
  description: "search",
  input_schema: { type: "object" as const, properties: { query: { type: "string" } }, required: ["query"] },
};
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-llm-claude-"));
  vi.stubEnv("FLYD_CLAUDE_SPEND_FILE", join(dir, "spend.json"));
  vi.stubEnv("FLYD_CLAUDE", "1");
  vi.stubEnv("CLAUDE_API_KEY", "claude-key");
  vi.stubEnv("CLAUDE_WORKSPACE_ID", "wrkspc_1");
  vi.stubEnv("FLYD_MODEL", "anthropic:claude-sonnet-4-6");
  vi.stubEnv("FLYD_CHAT_FALLBACK_MODELS", "");
  vi.stubEnv("COMMANDCODE_API_KEY", "");
  vi.stubEnv("FLYD_CLAUDE_CHAT_EFFORT", "");
  state.calls.length = 0;
  state.replies.length = 0;
  resetProviderCooldowns();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("Claude request shape", () => {
  it("runs chat on Sonnet with adaptive thinking, no sampling override, and cached prompt, tools and history", async () => {
    state.replies.push({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "web_search", input: { query: "x" } }],
      usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 3000 },
    });
    const system = `who Flyd is\n\n${PROMPT_CACHE_BREAK}\n\nthis turn's plan`;
    const answer = await agentLoop(system, "what's new?", [tool], async () => "result", "anthropic:claude-sonnet-5-5", 5);
    expect(answer).toBe("final answer");

    const [first, second] = state.calls;
    expect(first.client.defaultHeaders).toEqual({ "anthropic-workspace-id": "wrkspc_1" });
    expect(first.params.temperature).toBeUndefined();
    expect(first.params.output_config).toEqual({ effort: "medium" });
    expect(first.params.thinking).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    expect(first.options.headers).toEqual({ "anthropic-beta": "thinking-binding-controls-2026-08-01" });
    expect(first.params.system).toEqual([
      { type: "text", text: "who Flyd is", cache_control: { type: "ephemeral" } },
      { type: "text", text: "this turn's plan" },
    ]);
    expect((first.params.tools as Array<Record<string, unknown>>).at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    // The newest message carries the rolling breakpoint; stored history stays unmarked.
    const history = second.params.messages as Array<{ content: Array<Record<string, unknown>> }>;
    expect(history.at(-1)?.content.at(-1)).toMatchObject({ type: "tool_result", cache_control: { type: "ephemeral" } });
    expect(JSON.stringify(history.slice(0, -1))).not.toContain("cache_control");

    const ledger = readSpendLedger();
    expect(ledger.calls).toBe(2);
    expect(ledger.bySource.chat.usd).toBeGreaterThan(0);
  });

  it("runs quick jobs on Haiku with thinking off", async () => {
    expect(await quickQuery("route this")).toBe("final answer");
    const [call] = state.calls;
    expect(call.params.model).toBe("claude-haiku-5-5");
    expect(call.params.thinking).toEqual({ type: "disabled" });
    expect(call.params.temperature).toBeUndefined();
    expect(readSpendLedger().bySource.quick.calls).toBe(1);
  });

  it("keeps a low temperature for older Claude models", async () => {
    await quickQuery("x", { model: "anthropic:claude-sonnet-4-6" });
    expect(state.calls[0].params.temperature).toBe(0.2);
    expect(state.calls[0].params.thinking).toBeUndefined();
  });

  it("fails over to the next model when Claude declines", async () => {
    state.replies.push({ stop_reason: "refusal", content: [], usage: { input_tokens: 10, output_tokens: 0 } });
    const result = await agentLoopWithFailover(
      ["anthropic:claude-sonnet-5-5", "anthropic:claude-sonnet-4-6"], "system", "hi", [tool], async () => "r", 3,
    );
    expect(result).toEqual({ answer: "final answer", model: "anthropic:claude-sonnet-4-6" });
  });

  it("stops calling Claude for quick jobs once the month's cap is spent", async () => {
    vi.stubEnv("FLYD_CLAUDE_MONTHLY_CAP_USD", "0.00001");
    await quickQuery("first");
    await quickQuery("second");
    expect(state.calls.map((call) => call.params.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-4-6"]);
  });
});
