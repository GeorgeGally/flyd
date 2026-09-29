import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CREW_OPENCODE_CONFIG, MAX_CREW_ATTEMPTS, crewBrief, discardCrewTask, dispatchCrewTask, landCrewTask, lastSummary, listTasks, readTask, superviseCrew } from "../crew.js";

let home: string;
let repo: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-crew-"));
  process.env.FLYD_CREW_DIR = join(home, "crew");
  process.env.FLYD_CREW_WORKTREES = join(home, "worktrees");
  repo = join(home, "app");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.email", "t@t.test");
  git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A fake crewmate: commits a change in its worktree and logs OpenCode-style JSON events. */
function fakeCrewmate(commit = true) {
  return vi.fn((task: { worktree: string; log: string }, _brief: string) => {
    if (commit) {
      writeFileSync(join(task.worktree, "feature.txt"), "done\n");
      git(task.worktree, "add", ".");
      git(task.worktree, "commit", "-qm", "feat: add feature");
    }
    writeFileSync(task.log, `${JSON.stringify({ type: "text", part: { type: "text", text: "Added feature.txt; README unchanged." } })}\n`);
    return 424242;
  });
}

describe("crew", () => {
  it("dispatches a crewmate into its own worktree and branch with a brief", async () => {
    const launch = fakeCrewmate();
    const task = await dispatchCrewTask({ repo, outcome: "Add a feature file", launch });
    expect(task).toMatchObject({ status: "running", baseBranch: "main", pid: 424242, source: "chat" });
    expect(task.branch).toMatch(/^flyd\/add-a-feature-file-/);
    expect(existsSync(join(task.worktree, "README.md"))).toBe(true);
    const brief = launch.mock.calls[0][1] as string;
    expect(brief).toContain("Add a feature file");
    expect(brief).toContain("Never push");
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("verifies a finished crewmate, reports it, and lands it only when asked", async () => {
    const task = await dispatchCrewTask({ repo, outcome: "Add a feature file", launch: fakeCrewmate() });
    const notify = vi.fn(async () => {});
    const runCommand = vi.fn(async () => ({ ok: true, output: "all good" }));
    const [done] = await superviseCrew({ alive: () => false, runCommand, notify });
    expect(done).toMatchObject({ status: "ready", commits: 1, summary: "Added feature.txt; README unchanged." });
    expect(done.diffStat).toContain("1 file changed");
    expect(runCommand).toHaveBeenCalledWith("git diff --check", task.worktree);
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringMatching(/is done and tested\. Say \/land to merge it in\.$/));
    expect(existsSync(join(repo, "feature.txt"))).toBe(false);

    const landed = await landCrewTask(task.id);
    expect(landed.status).toBe("landed");
    expect(readFileSync(join(repo, "feature.txt"), "utf8")).toBe("done\n");
    expect(existsSync(task.worktree)).toBe(false);
  });

  it("fails a crewmate that committed nothing or whose checks fail, and never lands it", async () => {
    await dispatchCrewTask({ repo, outcome: "Do nothing", launch: fakeCrewmate(false) });
    const [idle] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }) });
    expect(idle).toMatchObject({ status: "failed", failure: "no commits" });
    await expect(landCrewTask(idle.id)).rejects.toThrow("not ready to land");

    await dispatchCrewTask({ repo, outcome: "Break the tests", launch: fakeCrewmate() });
    const [broken] = await superviseCrew({ alive: () => false, runCommand: async (command) => ({ ok: command !== "git diff --check", output: "boom" }) });
    expect(broken.failure).toBe("verification failed: git diff --check");
  });

  it("leaves running crewmates alone, stops ones stuck for hours, and refuses to land on a moved checkout", async () => {
    const task = await dispatchCrewTask({ repo, outcome: "Long job", launch: fakeCrewmate(), now: new Date(Date.now() - 3 * 3_600_000) });
    const kill = vi.fn();
    const [stopped] = await superviseCrew({ alive: () => true, kill });
    expect(kill).toHaveBeenCalledWith(424242);
    expect(stopped.failure).toContain("stopped after 2 hours");

    const ready = await dispatchCrewTask({ repo, outcome: "Another", launch: fakeCrewmate() });
    await superviseCrew({ alive: (pid) => pid !== 424242 || false, runCommand: async () => ({ ok: true, output: "" }) });
    git(repo, "checkout", "-qb", "elsewhere");
    await expect(landCrewTask(ready.id)).rejects.toThrow("switch back to main");
    git(repo, "checkout", "-q", "main");
    const discarded = await discardCrewTask(ready.id);
    expect(discarded.status).toBe("discarded");
    expect(git(repo, "branch", "--list", ready.branch)).toBe("");
    expect(listTasks().map((item) => item.status).sort()).toEqual(["discarded", "failed"]);
    expect(readTask(task.id)?.status).toBe("failed");
  });

  it("refuses to launch a real crewmate under tests", async () => {
    await expect(dispatchCrewTask({ repo, outcome: "Would be real" })).rejects.toThrow("refusing to launch a real OpenCode crewmate under tests");
  });

  it("denies publishing and destructive commands to unattended crewmates", () => {
    expect(CREW_OPENCODE_CONFIG.permission.bash["git push*"]).toBe("deny");
    expect(CREW_OPENCODE_CONFIG.permission.bash["rm -rf *"]).toBe("deny");
    expect(crewBrief("x", ["npm test"], "flyd/x")).toContain("run and pass: npm test");
    expect(lastSummary(join(home, "missing.jsonl"))).toBe("");
  });
});

describe("crew review against done_when", () => {
  const doneWhen = ["feature.txt says done", "a test covers the feature"];
  const passing = async () => ({ ok: true, output: "" });

  it("puts done_when in the brief and marks ready when the reviewer finds every point met", async () => {
    const launch = fakeCrewmate();
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch });
    expect(launch.mock.calls[0][1]).toContain("1. feature.txt says done");
    const review = vi.fn(async (_prompt: string) => "MET 1: feature.txt contains done\nMET 2: test added");
    const notify = vi.fn(async () => {});
    const [done] = await superviseCrew({ alive: () => false, runCommand: passing, review, notify });
    expect(review.mock.calls[0][0]).toContain("+done");
    expect(review.mock.calls[0][0]).toContain("find what would make it unacceptable");
    expect(done).toMatchObject({ status: "ready", review: [{ met: true }, { met: true }] });
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringMatching(/done and tested/));
  });

  it("sends unmet points back to the crewmate once in the same worktree, then reports what is still short", async () => {
    const task = await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate() });
    const relaunch = vi.fn((_task: unknown, _brief: string) => 515151);
    const review = vi.fn(async () => "MET 1: yes\nUNMET 2: no test in the diff");
    const notify = vi.fn(async () => {});
    const [again] = await superviseCrew({ alive: () => false, runCommand: passing, review, launch: relaunch, notify });
    expect(again).toMatchObject({ status: "running", attempts: 2, pid: 515151 });
    expect(relaunch.mock.calls[0][1]).toContain("a test covers the feature: no test in the diff");
    expect(notify).not.toHaveBeenCalled();

    const [done] = await superviseCrew({ alive: () => false, runCommand: passing, review, launch: relaunch, notify });
    expect(relaunch).toHaveBeenCalledTimes(MAX_CREW_ATTEMPTS - 1);
    expect(done).toMatchObject({ id: task.id, status: "ready" });
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringContaining("still short on: a test covers the feature (no test in the diff). Your call whether to /land it."));
  });

  it("doesn't rebuild when the review itself breaks", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate() });
    const relaunch = vi.fn(() => 1);
    const [done] = await superviseCrew({ alive: () => false, runCommand: passing, review: async () => { throw new Error("down"); }, launch: relaunch });
    expect(relaunch).not.toHaveBeenCalled();
    expect(done.status).toBe("ready");
    expect(done.review?.[0].note).toBe("the review couldn't run");
  });

  it("gives the repair round its own clock", async () => {
    const start = new Date(Date.now() - 3 * 3_600_000);
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate(), now: start });
    const [again] = await superviseCrew({ alive: () => false, runCommand: passing, review: async () => "MET 1: y\nUNMET 2: no test", launch: () => 616161 });
    expect(again.attemptStartedAt).toBeDefined();
    const kill = vi.fn();
    expect(await superviseCrew({ alive: () => true, kill })).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("finishes as ready when the repair relaunch fails, instead of hanging", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate() });
    const notify = vi.fn(async () => {});
    const [done] = await superviseCrew({
      alive: () => false, runCommand: passing, notify, review: async () => "MET 1: y\nUNMET 2: no test",
      launch: () => { throw new Error("opencode missing"); },
    });
    expect(done).toMatchObject({ status: "ready", attempts: 1 });
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringContaining("still short on: a test covers the feature (no test)"));
  });

  it("says so when it couldn't review, rather than calling the work short", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate() });
    const notify = vi.fn(async () => {});
    const [done] = await superviseCrew({ alive: () => false, runCommand: passing, notify, review: async () => "LGTM" });
    expect(done.review?.every((check) => check.unchecked)).toBe(true);
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringContaining("I couldn't check it against what you asked"));
  });

  it("holds a task without done_when to its outcome", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", launch: fakeCrewmate() });
    const review = vi.fn(async (_prompt: string) => "MET 1: added");
    const [done] = await superviseCrew({ alive: () => false, runCommand: passing, review });
    expect(review.mock.calls[0][0]).toContain("1. Add a feature file");
    expect(done.review).toEqual([{ criterion: "Add a feature file", met: true, note: "added" }]);
  });
});

describe("after landing", () => {
  it("runs what George approved at dispatch, in order, once he lands it", async () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { deploy: "vercel --prod" } }));
    git(repo, "add", "."); git(repo, "commit", "-qm", "add deploy script");
    const task = await dispatchCrewTask({ repo, outcome: "Add a feature file", afterLand: ["push", "deploy"], launch: fakeCrewmate() });
    expect(task.afterLand).toEqual(["push", "deploy"]);
    await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }) });
    const ran: string[] = [];
    const landed = await landCrewTask(task.id, undefined, async (command) => { ran.push(command); return { ok: true, output: "done" }; });
    expect(ran).toEqual(["git push origin main", "npm run deploy"]);
    expect(landed.afterLandResults?.map((result) => [result.step, result.ok])).toEqual([["push", true], ["deploy", true]]);
  });

  it("says so when the repo has no deploy command, and stops at the first failure", async () => {
    const task = await dispatchCrewTask({ repo, outcome: "Add a feature file", afterLand: ["deploy", "push"], launch: fakeCrewmate() });
    await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }) });
    const run = vi.fn(async () => ({ ok: true, output: "" }));
    const landed = await landCrewTask(task.id, undefined, run);
    expect(run).not.toHaveBeenCalled();
    expect(landed.afterLandResults).toEqual([{ step: "deploy", ok: false, detail: expect.stringContaining("declares no deploy command") }]);
  });
});
