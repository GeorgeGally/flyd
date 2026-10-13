import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatModelChain, claudeChatModel, quickModelChain, resolveModelConnection } from "../config.js";
import {
  claudeAvailable,
  claudeHeaders,
  readSpendLedger,
  recordClaudeUsage,
  setSpendNotifier,
  spendStatus,
  spendWarning,
  usageCostUsd,
} from "../claude-spend.js";

let dir: string;
const notices: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-claude-"));
  vi.stubEnv("FLYD_CLAUDE_SPEND_FILE", join(dir, "spend.json"));
  vi.stubEnv("FLYD_CLAUDE", "1");
  vi.stubEnv("CLAUDE_API_KEY", "claude-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("FLYD_PROVIDER", "opencode-go");
  vi.stubEnv("FLYD_MODEL", "opencode-go/deepseek-v4.1-flash");
  vi.stubEnv("FLYD_CHAT_MODEL", "opencode-go/deepseek-v4.1-flash");
  vi.stubEnv("FLYD_CHAT_FALLBACK_MODELS", "");
  vi.stubEnv("COMMANDCODE_API_KEY", "");
  vi.stubEnv("CMD_API_KEY", "");
  vi.stubEnv("FLYD_CLAUDE_MONTHLY_CAP_USD", "");
  notices.length = 0;
  setSpendNotifier((_title, message) => { notices.push(message); });
});

afterEach(() => {
  setSpendNotifier(null);
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("model chains with Claude", () => {
  it("puts Claude Sonnet ahead of the configured chat model, which stays as the fallback", () => {
    expect(chatModelChain()).toEqual(["anthropic:claude-sonnet-5-5", "opencode-go/deepseek-v4.1-flash"]);
  });

  it("puts Claude Haiku ahead of the models quick jobs used before", () => {
    expect(quickModelChain()).toEqual(["anthropic:claude-haiku-5-5", "opencode-go/deepseek-v4.1-flash"]);
  });

  it("takes model overrides from the environment and qualifies bare Claude ids", () => {
    vi.stubEnv("FLYD_CLAUDE_CHAT_MODEL", "claude-opus-5-5");
    vi.stubEnv("FLYD_CLAUDE_QUICK_MODEL", "anthropic:claude-sonnet-5-5");
    expect(chatModelChain()[0]).toBe("anthropic:claude-opus-5-5");
    expect(quickModelChain()[0]).toBe("anthropic:claude-sonnet-5-5");
  });

  it("leaves Claude out when FLYD_CLAUDE=0 or no key is set", () => {
    vi.stubEnv("FLYD_CLAUDE", "0");
    expect(chatModelChain()).toEqual(["opencode-go/deepseek-v4.1-flash"]);
    vi.stubEnv("FLYD_CLAUDE", "1");
    vi.stubEnv("CLAUDE_API_KEY", "");
    expect(claudeChatModel()).toBeNull();
  });

  it("reads CLAUDE_API_KEY, else ANTHROPIC_API_KEY, for Anthropic models", () => {
    expect(resolveModelConnection("anthropic:claude-sonnet-5-5")).toMatchObject({
      apiKey: "claude-key",
      providerIdentity: "api.anthropic.com/claude-sonnet-5-5",
    });
    vi.stubEnv("CLAUDE_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    expect(resolveModelConnection("anthropic:claude-haiku-5-5").apiKey).toBe("anthropic-key");
  });

  it("names the workspace for a key that is not scoped to one", () => {
    expect(claudeHeaders()).toEqual({});
    vi.stubEnv("CLAUDE_WORKSPACE_ID", "wrkspc_123");
    expect(claudeHeaders()).toEqual({ "anthropic-workspace-id": "wrkspc_123" });
  });

  it("still has a chain when FLYD_MODEL is unset but Claude is on", () => {
    vi.stubEnv("FLYD_MODEL", "");
    expect(quickModelChain()).toEqual(["anthropic:claude-haiku-5-5"]);
  });
});

describe("monthly Claude spend", () => {
  it("prices usage per model, cache reads at a tenth", () => {
    expect(usageCostUsd("claude-sonnet-5-5", { input_tokens: 1_000_000 })).toBeCloseTo(2);
    expect(usageCostUsd("claude-sonnet-5-5", { output_tokens: 1_000_000 })).toBeCloseTo(10);
    expect(usageCostUsd("claude-sonnet-5-5", { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(usageCostUsd("claude-sonnet-5-5", { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(2.5);
    expect(usageCostUsd("anthropic:claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(0.6);
  });

  it("adds each call to this month's total by source and starts fresh next month", () => {
    const october = new Date(2026, 9, 13);
    recordClaudeUsage("claude-sonnet-5-5", { input_tokens: 500_000 }, "chat", october);
    recordClaudeUsage("claude-haiku-5-5", { input_tokens: 1_000_000 }, "quick", october);
    const ledger = readSpendLedger(october);
    expect(ledger.usd).toBeCloseTo(1.1);
    expect(ledger.calls).toBe(2);
    expect(ledger.bySource.chat.usd).toBeCloseTo(1);
    expect(ledger.bySource.quick.calls).toBe(1);
    expect(readSpendLedger(new Date(2026, 10, 1)).usd).toBe(0);
  });

  it("warns once near the cap, once at it, then drops Claude from every chain", () => {
    vi.stubEnv("FLYD_CLAUDE_MONTHLY_CAP_USD", "10");
    const now = new Date();
    recordClaudeUsage("claude-sonnet-5-5", { output_tokens: 700_000 }, "chat", now); // $7
    expect(notices).toEqual([]);
    recordClaudeUsage("claude-sonnet-5-5", { output_tokens: 100_000 }, "chat", now); // $8
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("$8 of $10");
    recordClaudeUsage("claude-sonnet-5-5", { output_tokens: 10_000 }, "chat", now);
    expect(notices).toHaveLength(1);
    expect(claudeAvailable(now)).toBe(true);
    recordClaudeUsage("claude-sonnet-5-5", { output_tokens: 300_000 }, "chat", now); // past $10
    expect(notices).toHaveLength(2);
    expect(notices[1]).toContain("backup models");
    expect(spendStatus(now).capped).toBe(true);
    expect(claudeAvailable(now)).toBe(false);
    expect(chatModelChain()).toEqual(["opencode-go/deepseek-v4.1-flash"]);
    expect(quickModelChain()).toEqual(["opencode-go/deepseek-v4.1-flash"]);
  });

  it("defaults the cap to $100 and words the warning for George", () => {
    expect(spendStatus().cap).toBe(100);
    expect(spendWarning({ month: "2026-10", usd: 50, cap: 100, fraction: 0.5, capped: false, calls: 1, bySource: {} })).toBeNull();
    expect(spendWarning({ month: "2026-10", usd: 83, cap: 100, fraction: 0.83, capped: false, calls: 1, bySource: {} }))
      .toBe("Claude spend this month is at $83 of $100. At $100 I'll switch to the backup models until the 1st.");
  });

  it("keeps an opt-in per-call trail for measuring cache hits", () => {
    const trail = join(dir, "usage.jsonl");
    vi.stubEnv("FLYD_CLAUDE_USAGE_LOG", trail);
    recordClaudeUsage("claude-haiku-5-5", { input_tokens: 10, cache_read_input_tokens: 900 }, "prediction");
    const line = JSON.parse(readFileSync(trail, "utf8").trim()) as { source: string; usage: { cache_read_input_tokens: number } };
    expect(line.source).toBe("prediction");
    expect(line.usage.cache_read_input_tokens).toBe(900);
  });
});
