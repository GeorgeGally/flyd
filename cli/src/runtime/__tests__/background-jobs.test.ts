import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RUNNING_JOBS,
  describeJobs,
  jobEvents,
  jobMessage,
  listJobs,
  normalizeContract,
  recoverInterruptedJobs,
  startBackgroundJob,
  verifyMessage,
  type JobContract,
  type JobResult,
} from "../background-jobs.js";
import { parseVerdicts } from "../acceptance.js";

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

describe("done_when gate", () => {
  const canva: JobContract = {
    task: "import the pitch deck into Canva",
    doneWhen: ["the deck is imported into Canva as an editable design, or if blocked, report one specific blocker with evidence"],
  };

  async function finish(job: JobContract, deps: Omit<Parameters<typeof startBackgroundJob>[1], "dir">) {
    const done = nextDone();
    const id = startBackgroundJob(job, { ...deps, dir });
    const result = await done;
    return { result, record: listJobs(dir).find((entry) => entry.id === id)! };
  }

  it("ends a self-declared success with a false predicate not-done, citing the clause", async () => {
    const verify = vi.fn(async (_message: string) => "UNMET 1: no design with that name in the Canva account");
    const { result, record } = await finish(canva, { run: async () => "All done! The deck is imported into Canva and looks great.", verify });
    expect(result.status).toBe("short");
    expect(record.status).toBe("short");
    expect(record.unresolved).toEqual(["the deck is imported into Canva as an editable design: no design with that name in the Canva account"]);
    // The blocker clause is judged apart: the checker only ever sees the success clause.
    expect(verify.mock.calls[0][0]).toContain("1. the deck is imported into Canva as an editable design\n");
    expect(verify.mock.calls[0][0]).not.toContain("if blocked");
  });

  it("keeps a job an unattended run started unattended through its build and check turns", async () => {
    const run = vi.fn(async (_message: string, _id: string, _background?: boolean) => "Imported the deck into Canva as design DAGk3x9QbZ1.");
    const verify = vi.fn(async (_message: string, _id: string, _background?: boolean) => "MET 1: it's in Canva");
    await finish({ ...canva, background: true }, { run, verify });
    await finish(canva, { run, verify });
    expect(run.mock.calls.map((call) => call[2])).toEqual([true, undefined]);
    expect(verify.mock.calls.map((call) => call[2])).toEqual([true, undefined]);
  });

  it("doesn't count a success claim for a Canva import without evidence", async () => {
    const { result, record } = await finish(canva, { run: async () => "Imported the deck into Canva, it's all set.", verify: async () => "MET 1: it's in Canva" });
    expect(result.status).not.toBe("ok");
    expect(record.status).toBe("short");
    expect(record.unresolved?.[0]).toMatch(/^the deck is imported into Canva as an editable design: /);
  });

  it("counts the same claim once it cites a design id or command output", async () => {
    const verify = async () => "MET 1: it's in Canva";
    const byId = await finish(canva, { run: async () => "Imported the deck into Canva as design DAGk3x9QbZ1.", verify });
    expect(byId.result.status).toBe("ok");
    expect(byId.record).toMatchObject({ status: "ok", unresolved: [] });
    const byOutput = await finish(canva, { run: async () => "Imported the deck into Canva: `canva import deck.pdf` printed `created design`.", verify });
    expect(byOutput.record.status).toBe("ok");
  });

  it("still succeeds when every point is met with evidence", async () => {
    const { result, record } = await finish(contract, {
      run: async () => "Two sets in ~/DIR/mixes/set-3 and set-4; ~/DIR/mixes/compare.md judges each against the last.",
      verify: async () => "MET 1: ls ~/DIR/mixes shows set-3/ and set-4/\nMET 2: compare.md ranks set-4 over set-3",
    });
    expect(result.status).toBe("ok");
    expect(record).toMatchObject({ status: "ok", attempts: 1, unresolved: [] });
  });

  it("records an honest, evidenced blocker as blocked, not succeeded", async () => {
    const { result, record } = await finish(canva, {
      run: async () => "I couldn't import it: `canva import deck.pdf` failed with HTTP 403, the token lacks design:write.",
      verify: async () => "UNMET 1: nothing was imported",
    });
    expect(result.status).toBe("blocked");
    expect(record.status).toBe("blocked");
    expect(record.unresolved?.[0]).toContain("blocked: I couldn't import it");
  });

  it("flags a job that finishes with a process it started still running", async () => {
    const leftovers = vi.fn(() => [{ pid: 4242, command: "cloudflared tunnel --url http://localhost:8000" }]);
    const { result, record } = await finish(canva, {
      run: async () => "Imported the deck into Canva as design DAGk3x9QbZ1.",
      verify: async () => "MET 1: design DAGk3x9QbZ1 is in the account",
      leftovers,
    });
    expect(result.status).toBe("short");
    expect(result.result).toContain("nothing it started is left running (still running: pid 4242 `cloudflared tunnel");
    expect(record.unresolved).toEqual([expect.stringMatching(/^nothing it started is left running: still running: pid 4242/)]);
    expect(leftovers).toHaveBeenCalledWith(record.id);
  });

  it("finds what a job's shell commands left running by their registered process group", async () => {
    const { registerJobProcessGroup, jobLeftovers } = await import("../background-jobs.js");
    expect(jobLeftovers("nojob", () => { throw new Error("must not list processes"); })).toEqual([]);
    registerJobProcessGroup("abc12345", 700);
    const table = () => [
      { pid: 701, pgid: 700, command: "python3 -m http.server 8000" },
      { pid: 702, pgid: 1, command: "unrelated" },
    ];
    expect(jobLeftovers("abc12345", table)).toEqual([{ pid: 701, command: "python3 -m http.server 8000" }]);
  });

  it("runs a job's shell command in its own registered group and finds what it left behind", async () => {
    const { runJobShell, jobLeftovers } = await import("../background-jobs.js");
    const { stdout } = await runJobShell("feedface", "sleep 30 >/dev/null 2>&1 & echo started", { cwd: dir, timeoutMs: 10_000, maxBuffer: 1024 });
    expect(stdout.trim()).toBe("started");
    const left = jobLeftovers("feedface");
    try {
      expect(left).toEqual([expect.objectContaining({ command: "sleep 30" })]);
    } finally {
      for (const process_ of left) { try { process.kill(process_.pid, "SIGKILL"); } catch { /* already gone */ } }
    }
    await expect(runJobShell("feedface", "exit 3", { cwd: dir, timeoutMs: 10_000, maxBuffer: 1024 })).rejects.toThrow(/^Command failed: .*exit code 3/);
  });
});

describe("background jobs", () => {
  it("returns at once, checks the work independently, and brings back a verified result", async () => {
    let finish: (value: string) => void = () => {};
    const run = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const verify = vi.fn(async () => "MET 1: two folders in mixes/\nMET 2: mixes/compare.md ranks the second higher");
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
    const verify = vi.fn(async () => "MET 1: set-a/ is in mixes/\nUNMET 2: no comparison anywhere");
    const done = nextDone();
    startBackgroundJob(contract, { run, verify, dir });
    const result = await done;
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toContain("no comparison anywhere");
    expect(result.status).toBe("short");
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

  it("doesn't rebuild when the checker's reply has no verdicts", async () => {
    const run = vi.fn(async () => "Made both.");
    const done = nextDone();
    startBackgroundJob(contract, { run, verify: async () => "Looks good!", dir });
    expect((await done).result).toContain("I couldn't check this one");
    expect(run).toHaveBeenCalledOnce();
  });

  it("lists jobs with how many points were met", async () => {
    const done = nextDone();
    startBackgroundJob(contract, { run: async () => "ok", verify: async () => "MET 1: two folders in mixes/\nUNMET 2: no comparison", dir });
    await done;
    expect(describeJobs(listJobs(dir))).toMatch(/short · 1\/2 points met .*\n    ✗ each set is judged against the last one: no comparison/);
  });

  it("fails a job whose work comes back empty instead of calling it done", async () => {
    const verify = vi.fn(async () => "MET 1: ok\nMET 2: ok");
    const done = nextDone();
    startBackgroundJob(contract, { run: async () => "  ", verify, dir });
    expect(await done).toMatchObject({ status: "failed", result: "Couldn't finish: the work came back empty" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("caps how many jobs run at once", async () => {
    let release: (value: string) => void = () => {};
    const held = new Promise<string>((resolve) => { release = resolve; });
    const finished = new Promise<void>((resolve) => {
      let left = MAX_RUNNING_JOBS;
      const onDone = () => { left -= 1; if (!left) { jobEvents.off("done", onDone); resolve(); } };
      jobEvents.on("done", onDone);
    });
    for (let index = 0; index < MAX_RUNNING_JOBS; index += 1) startBackgroundJob({ ...contract, task: `job ${index}` }, { run: () => held, dir });
    expect(() => startBackgroundJob(contract, { run: () => held, dir })).toThrow(/already running/);
    // Let them finish so no job outlives the test.
    release("ok");
    await finished;
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
      writeFileSync(join(other, "torn.json"), JSON.stringify({ id: "torn", status: "running" }));
      expect(() => recoverInterruptedJobs({ dir: other, isAlive: () => false })).not.toThrow();
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
    expect(normalizeContract({ task: "x", done_when: ["p"], deliverable: "out/mixes" })).toMatch(/absolute or ~\/ path/);
  });

  it("puts the contract in front of the builder and asks the checker to disprove", () => {
    expect(jobMessage(contract)).toContain("1. two new sets exist in DIR/mixes");
    expect(verifyMessage(contract, "all done")).toContain("find what would make it unacceptable");
  });

  it("counts points the checker didn't answer as unmet", () => {
    expect(parseVerdicts(contract.doneWhen, "**MET 1**: saw them\nsome chatter")).toEqual([
      { criterion: contract.doneWhen[0], met: true, note: "saw them" },
      { criterion: contract.doneWhen[1], met: false, note: "the check couldn't confirm it" },
    ]);
  });
});
