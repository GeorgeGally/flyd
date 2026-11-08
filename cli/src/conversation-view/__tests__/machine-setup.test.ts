import { describe, expect, it, vi } from "vitest";
import { MachineSetupReader, usageFrom } from "../machine-setup.js";

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
    const reader = new MachineSetupReader(async () => { calls += 1; return QUOTA; });
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
      const reader = new MachineSetupReader(quota);
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
