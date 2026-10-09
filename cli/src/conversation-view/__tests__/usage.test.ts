import { describe, expect, it } from "vitest";
import { parsePlanUsage, PlanUsageReader } from "../plan-usage.js";
import { contextWindow, conversationFromLines } from "../transcript-filter.js";
import { captain } from "./transcript-fixture.js";

function assistantWithUsage(model: string, usage: Record<string, number>, sidechain = false): string {
  return JSON.stringify({
    type: "assistant",
    isSidechain: sidechain,
    uuid: `a-${Math.random()}`,
    timestamp: "2026-10-05T20:00:00.000Z",
    message: { role: "assistant", model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage },
  });
}

describe("context usage", () => {
  it("reports the newest main-chain turn's input, cached and newly cached tokens against the window", () => {
    const snapshot = conversationFromLines([
      captain("hi"),
      assistantWithUsage("claude-opus-5-5", { input_tokens: 10, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 5_000, output_tokens: 300 }),
      assistantWithUsage("claude-opus-5-5", { input_tokens: 2, cache_read_input_tokens: 628_833, cache_creation_input_tokens: 1_083, output_tokens: 341 }),
      assistantWithUsage("claude-haiku-4-5-20251001", { input_tokens: 999_999 }, true),
    ]);
    expect(snapshot.context).toEqual({ tokens: 629_918, window: 1_000_000 });
  });

  it("knows the window from the model, from what the session has used, or from an override", () => {
    expect(contextWindow("claude-opus-5-5", 10_000, {})).toBe(1_000_000);
    expect(contextWindow("claude-sonnet-4-5[1m]", 10_000, {})).toBe(1_000_000);
    expect(contextWindow("claude-sonnet-4-5", 10_000, {})).toBe(200_000);
    expect(contextWindow("claude-sonnet-4-5", 250_000, {})).toBe(1_000_000);
    expect(contextWindow("claude-opus-5-5", 10_000, { FLYD_VIEW_CONTEXT_WINDOW: "400000" })).toBe(400_000);
  });

  it("has nothing to say before the assistant has answered", () => {
    expect(conversationFromLines([captain("hi")]).context).toBeUndefined();
  });
});

describe("plan usage", () => {
  const report = (windows: unknown[], status = "ok") => JSON.stringify({
    providers: [
      { provider: "codex", windows: [{ label: "session", percentRemaining: 1 }] },
      { provider: "claude", windows, state: { status } },
    ],
  });

  it("reads Claude's windows from quota-axi", () => {
    expect(parsePlanUsage(report([
      { id: "five_hour", label: "session", percentRemaining: 72, resetsAt: "2026-10-06T07:00:00.000Z" },
      { id: "weekly", label: "week", percentRemaining: 41.5 },
      { id: "broken" },
    ]))).toEqual({
      source: "quota-axi",
      windows: [
        { label: "session", percentRemaining: 72, resetsAt: "2026-10-06T07:00:00.000Z" },
        { label: "week", percentRemaining: 41.5 },
      ],
    });
  });

  it("shows nothing when quota-axi cannot read Claude without a prompt, or is missing", async () => {
    expect(parsePlanUsage(report([], "auth_required"))).toBeNull();
    expect(parsePlanUsage("not json")).toBeNull();
    const calls: string[][] = [];
    const reader = new PlanUsageReader(async (args) => (calls.push(args), report([], "auth_required")));
    expect(await reader.refresh()).toBeNull();
    expect(calls[0]).toEqual(["--provider", "claude", "--json", "--no-credential-refresh", "--max-age", "10m"]);
    const missing = new PlanUsageReader(async () => { throw new Error("ENOENT"); });
    expect(await missing.refresh()).toBeNull();
  });
});
