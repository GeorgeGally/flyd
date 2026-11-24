import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordClaudeUsage, recordCompatibleClaudeUsage } from "../claude-spend.js";
import { openAITokens, readTokenLedger, recordTokenUsage, usageTrailPath } from "../token-usage.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-tokens-"));
  vi.stubEnv("FLYD_TOKEN_USAGE_FILE", join(dir, "token-usage.json"));
  vi.stubEnv("FLYD_CLAUDE_SPEND_FILE", join(dir, "claude-spend.json"));
  vi.stubEnv("FLYD_CLAUDE_USAGE_LOG", "");
});
afterEach(() => vi.unstubAllEnvs());

const trail = (): Array<Record<string, unknown>> => readFileSync(usageTrailPath()!, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

describe("token usage", () => {
  it("keeps the per-call trail on by default under Flyd's home, and off only when asked", () => {
    expect(usageTrailPath()).toBe(join(process.env.FLYD_DIR!, "claude-usage.jsonl"));
    vi.stubEnv("FLYD_CLAUDE_USAGE_LOG", "off");
    expect(usageTrailPath()).toBeNull();
    vi.stubEnv("FLYD_CLAUDE_USAGE_LOG", join(dir, "calls.jsonl"));
    expect(usageTrailPath()).toBe(join(dir, "calls.jsonl"));
  });

  it("records OpenAI-style calls (OpenCode Go, OpenAI, OpenRouter) as tokens per source per day, unpriced", () => {
    vi.stubEnv("FLYD_CLAUDE_USAGE_LOG", join(dir, "calls.jsonl"));
    const usage = { prompt_tokens: 1_200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1_000 } };
    expect(recordCompatibleClaudeUsage("opencode-go:gpt-6-luna", "https://opencode.ai/zen/go/v1", usage, "card-words")).toBe(0);
    recordCompatibleClaudeUsage("openrouter:some/model", "https://openrouter.ai/api/v1", { prompt_tokens: 300, completion_tokens: 20 }, "card-words");
    recordCompatibleClaudeUsage("openai:gpt-5.6-luna", undefined, { prompt_tokens: 50, completion_tokens: 5 }, "runtime/agenda-tick:taste");
    const day = Object.values(readTokenLedger().days)[0]!;
    expect(day["card-words"]).toEqual({ calls: 2, input: 1_500, output: 100, cacheRead: 1_000, cacheWrite: 0 });
    expect(day["runtime/agenda-tick:taste"]).toMatchObject({ calls: 1, input: 50, output: 5 });
    // Never against the Claude cap.
    expect(existsSync(join(dir, "claude-spend.json"))).toBe(false);
    expect(trail().map((line) => [line.model, line.source])).toEqual([
      ["opencode-go:gpt-6-luna", "card-words"], ["openrouter:some/model", "card-words"], ["openai:gpt-5.6-luna", "runtime/agenda-tick:taste"],
    ]);
    expect(JSON.stringify(trail())).not.toMatch(/prompt|content/i);
  });

  it("adds direct Anthropic calls to the same daily totals and the trail, priced", () => {
    vi.stubEnv("FLYD_CLAUDE_USAGE_LOG", join(dir, "calls.jsonl"));
    recordClaudeUsage("claude-haiku-5-5", { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 900 }, "quick");
    expect(Object.values(readTokenLedger().days)[0]!.quick).toEqual({ calls: 1, input: 10, output: 4, cacheRead: 900, cacheWrite: 0 });
    expect(trail()[0]).toMatchObject({ source: "quick", tokens: { input: 10, output: 4, cacheRead: 900 } });
    expect(typeof trail()[0]!.usd).toBe("number");
  });

  it("splits by local day and keeps a bounded window", () => {
    for (let day = 1; day <= 70; day += 1) recordTokenUsage({ source: "chat", model: "m", tokens: { input: day, output: 1 }, now: new Date(2026, 0, day, 12) });
    const days = Object.keys(readTokenLedger().days).sort();
    expect(days).toHaveLength(62);
    expect(days.at(-1)).toBe("2026-03-11");
    expect(readTokenLedger().days["2026-03-11"]!.chat).toMatchObject({ calls: 1, input: 70 });
  });

  it("reads the Responses API's usage shape too", () => {
    expect(openAITokens({ input_tokens: 40, output_tokens: 9, input_tokens_details: { cached_tokens: 30 } })).toEqual({ input: 40, output: 9, cacheRead: 30 });
    expect(openAITokens(null)).toBeNull();
  });
});
