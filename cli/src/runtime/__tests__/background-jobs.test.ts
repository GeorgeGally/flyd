import { describe, expect, it, vi } from "vitest";
import { jobEvents, jobMessage, startBackgroundJob, MAX_RUNNING_JOBS } from "../background-jobs.js";

describe("background jobs", () => {
  it("returns at once and brings the result back when the work is done", async () => {
    let finish: (value: string) => void = () => {};
    const run = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const deliver = vi.fn(async () => undefined);
    const done = new Promise((resolve) => jobEvents.once("done", resolve));
    const id = startBackgroundJob("generate two DIR sets and judge them", { run, deliver });
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    finish("Two sets in mixes/: the second is better, tighter vocals.");
    expect(await done).toEqual({ id, task: "generate two DIR sets and judge them", status: "ok", result: "Two sets in mixes/: the second is better, tighter vocals." });
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("caps how many jobs run at once", () => {
    const never = () => new Promise<string>(() => undefined);
    for (let index = 0; index < MAX_RUNNING_JOBS; index += 1) startBackgroundJob(`job ${index}`, { run: never });
    expect(() => startBackgroundJob("one too many", { run: never })).toThrow(/already running/);
  });

  it("tells the unattended turn to judge its own output", () => {
    expect(jobMessage("new DIR mixes")).toContain("judge it honestly");
  });
});
