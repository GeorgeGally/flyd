import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RUNNING_JOBS,
  jobEvents,
  jobMessage,
  listJobs,
  normalizeContract,
  parseChecks,
  recoverInterruptedJobs,
  startBackgroundJob,
  verifyMessage,
  type JobContract,
  type JobResult,
} from "../background-jobs.js";

const contract: JobContract = {
  task: "generate two DIR sets and judge them",
  doneWhen: ["two new sets exist in DIR/mixes", "each set is judged against the last one"],
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-jobs-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function nextDone(): Promise<JobResult> {
  return new Promise((resolve) => jobEvents.once("done", resolve));
}

describe("background jobs", () => {
  it("returns at once, checks the work independently, and brings back a verified result", async () => {
    let finish: (value: string) => void = () => {};
    const run = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const verify = vi.fn(async () => "MET 1: two folders in mixes/\nMET 2: report compares both");
    const deliver = vi.fn(async () => undefined);
    const done = nextDone();
    const id = startBackgroundJob(contract, { run, verify, deliver, dir });
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(listJobs(dir)[0]).toMatchObject({ id, status: "running" });
    finish("Two sets in mixes/: the second is better, tighter vocals.");
    expect(await done).toEqual({ id, task: contract.task, status: "ok", result: "Two sets in mixes/: the second is better, tighter vocals." });
    expect(verify).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledOnce();
    expect(listJobs(dir)[0]).toMatchObject({ status: "ok", attempts: 1 });
  });

  it("sends unmet points back to the builder once, then says plainly what is still short", async () => {
    const run = vi.fn(async (_message: string) => "Made one set.");
    const verify = vi.fn(async () => "MET 1: sets exist\nUNMET 2: no comparison anywhere");
    const done = nextDone();
    startBackgroundJob(contract, { run, verify, dir });
    const result = await done;
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toContain("no comparison anywhere");
    expect(result.status).toBe("ok");
    expect(result.result).toContain("still short on: each set is judged against the last one (no comparison anywhere)");
    expect(listJobs(dir)[0]).toMatchObject({ status: "short", attempts: 2 });
  });

  it("fails a missing deliverable on disk without asking a model", async () => {
    const verify = vi.fn(async () => "MET 1: fine\nMET 2: fine");
    const done = nextDone();
    startBackgroundJob({ ...contract, deliverable: "~/nowhere/mixes" }, { run: async () => "Done, it's in ~/nowhere/mixes.", verify, exists: () => false, dir });
    expect((await done).result).toContain("result is at ~/nowhere/mixes (nothing there)");
    expect(verify).not.toHaveBeenCalled();
  });

  it("doesn't rebuild when the check itself breaks", async () => {
    const run = vi.fn(async () => "Made both.");
    const done = nextDone();
    startBackgroundJob(contract, { run, verify: async () => { throw new Error("model down"); }, dir });
    expect((await done).result).toContain("I couldn't check this one");
    expect(run).toHaveBeenCalledOnce();
  });

  it("caps how many jobs run at once", () => {
    const never = () => new Promise<string>(() => undefined);
    for (let index = 0; index < MAX_RUNNING_JOBS; index += 1) startBackgroundJob({ ...contract, task: `job ${index}` }, { run: never, dir });
    expect(() => startBackgroundJob(contract, { run: never, dir })).toThrow(/already running/);
  });

  it("reports jobs a restart cut off instead of losing them", async () => {
    const other = mkdtempSync(join(tmpdir(), "flyd-jobs-"));
    try {
      const { writeFileSync, readdirSync, readFileSync } = await import("node:fs");
      const orphan = { id: "deadbeef", contract, status: "running", pid: 999_999, startedAt: "2026-09-28T09:00:00Z", updatedAt: "2026-09-28T09:00:00Z", attempts: 0, checks: [] };
      writeFileSync(join(other, "deadbeef.json"), JSON.stringify(orphan));
      const deliver = vi.fn(async () => undefined);
      const recovered = recoverInterruptedJobs({ dir: other, deliver, isAlive: () => false });
      expect(recovered).toEqual([expect.objectContaining({ id: "deadbeef", status: "failed" })]);
      expect(recovered[0].result).toContain("cut off when I restarted");
      expect(deliver).toHaveBeenCalledOnce();
      expect(JSON.parse(readFileSync(join(other, readdirSync(other)[0]), "utf8")).status).toBe("interrupted");
      expect(recoverInterruptedJobs({ dir: other, isAlive: () => false })).toEqual([]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("job contracts", () => {
  it("requires done_when so completion is defined before the work starts", () => {
    expect(normalizeContract({ task: "new mixes" })).toMatch(/needs done_when/);
    expect(normalizeContract({ task: " new  mixes ", done_when: ["three exist", ""], deliverable: "~/DIR/mixes" }))
      .toEqual({ task: "new mixes", doneWhen: ["three exist"], deliverable: "~/DIR/mixes" });
    expect(normalizeContract({ task: "x", done_when: "one point" })).toEqual({ task: "x", doneWhen: ["one point"] });
  });

  it("puts the contract in front of the builder and asks the checker to disprove", () => {
    expect(jobMessage(contract)).toContain("1. two new sets exist in DIR/mixes");
    expect(verifyMessage(contract, "all done")).toContain("find what would make it unacceptable");
  });

  it("counts points the checker didn't answer as unmet", () => {
    expect(parseChecks(contract, "**MET 1**: saw them\nsome chatter")).toEqual([
      { criterion: contract.doneWhen[0], met: true, note: "saw them" },
      { criterion: contract.doneWhen[1], met: false, note: "the check couldn't confirm it" },
    ]);
  });
});
