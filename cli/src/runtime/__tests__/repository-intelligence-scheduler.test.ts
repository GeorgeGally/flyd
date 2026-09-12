import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refreshRepositoryIntelligence,
  startRepositoryIntelligenceScheduler,
  stopRepositoryIntelligenceScheduler,
} from "../repository-intelligence-scheduler.js";

describe("repository intelligence scheduler", () => {
  afterEach(() => {
    stopRepositoryIntelligenceScheduler();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs immediately and then on the configured cadence", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);

    const stop = startRepositoryIntelligenceScheduler({
      intervalMs: 60_000,
      refresh,
    });

    expect(stop).toBe(stopRepositoryIntelligenceScheduler);
    await vi.runAllTicks();
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    stopRepositoryIntelligenceScheduler();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("degrades when refresh fails instead of rejecting Core", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await refreshRepositoryIntelligence(async () => {
      throw new Error("work index unavailable");
    });

    expect(result).toEqual({ ok: false });
    expect(warn).toHaveBeenCalledWith(
      "[repository-intelligence] refresh failed:",
      "work index unavailable",
    );
  });
});
