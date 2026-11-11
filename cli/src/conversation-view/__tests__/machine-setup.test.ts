import { describe, expect, it, vi } from "vitest";
import { MachineSetupReader, modelName, usageFrom } from "../machine-setup.js";

const QUOTA = {
  providers: [
    {
      provider: "claude",
      windows: [
        { id: "five_hour", resetsAt: "2026-11-08T18:20:00Z", percentRemaining: 93 },
        { id: "seven_day", resetsAt: "2026-11-13T21:00:00Z", percentRemaining: 69 },
      ],
      quotaSemantics: { effectiveAvailability: [{ scope: "all_models", effectivePercentRemaining: 69, limitingWindowIds: ["seven_day"], runway: { status: "projected_exhaustion", projectedExhaustedAt: "2026-11-08T15:55:00Z" } }] },
    },
    { provider: "opencode-go", windows: [{ id: "month", resetsAt: "2026-11-22T00:00:00Z", percentRemaining: 0 }] },
    { provider: "copilot", notSetUp: true },
    { provider: "cursor", windows: [] },
  ],
};

describe("a model's name", () => {
  it("reads as people say it, with the route it takes", () => {
    expect(["anthropic:claude-sonnet-5-5", "claude-haiku-5-5", "opencode-go/gpt-6-luna", "openai:gpt-5.6-luna", "openrouter/inception/mercury-2.5", "gpt-realtime-2.1"].map(modelName))
      .toEqual(["Claude Sonnet 5.5", "Claude Haiku 5.5", "GPT-6 Luna through OpenCode Go", "GPT-5.6 Luna", "Mercury 2.5 through OpenRouter", "gpt-realtime-2.1"]);
  });
});

describe("the newest tool versions", () => {
  it("are read in the background and kept, never waited on", async () => {
    let calls = 0;
    const reader = new MachineSetupReader(async () => ({ providers: [] }), async () => { calls += 1; return { codex: "0.167.0" }; });
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await reader.read()).latest).toEqual({ codex: "0.167.0" });
    expect(calls).toBe(1);
  });
});

describe("the Machines tab's usage", () => {
  it("reads quota-axi's JSON as one row per provider with a number, its tightest window and a run-out before the reset", () => {
    expect(usageFrom(QUOTA)).toEqual([
      { provider: "Claude", left: 69, resetsAt: "2026-11-13T21:00:00Z", runsOutAt: "2026-11-08T15:55:00Z" },
      { provider: "OpenCode Go", left: 0, resetsAt: "2026-11-22T00:00:00Z" },
    ]);
  });

  it("is nothing when quota-axi said nothing usable", () => {
    expect(usageFrom(null)).toEqual([]);
    expect(usageFrom({ providers: "no" })).toEqual([]);
  });

  it("answers at once with the last usage it has, reading quota-axi in the background", async () => {
    let calls = 0;
    const reader = new MachineSetupReader(async () => { calls += 1; return QUOTA; }, async () => ({}));
    const first = await reader.read();
    expect(calls).toBe(1);
    expect(Array.isArray(first.models)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await reader.read();
    expect(second.usage.map((one) => one.provider)).toEqual(["Claude", "OpenCode Go"]);
    expect(calls).toBe(1);
  });

  it("keeps the last successful reading on failure and clears it on an empty success", async () => {
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_800_000_000_000);
      let finishEmpty!: (value: unknown) => void;
      const quota = vi.fn<() => Promise<unknown>>()
        .mockResolvedValueOnce(QUOTA).mockRejectedValueOnce(new Error("unavailable"))
        .mockImplementationOnce(() => new Promise((resolve) => { finishEmpty = resolve; }));
      const reader = new MachineSetupReader(quota, async () => ({}));
      await reader.read();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const first = await reader.read();
      now.mockReturnValue(1_800_000_600_000);
      await reader.read();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const failed = await reader.read();
      expect(failed.usage).toEqual(first.usage);
      expect(failed.usageAt).toBe(first.usageAt);
      finishEmpty({ providers: [] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect((await reader.read()).usage).toEqual([]);
    } finally { now.mockRestore(); }
  });
});
