import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CREW_OPENCODE_CONFIG, crewBrief, discardCrewTask, dispatchCrewTask, landCrewTask, lastSummary, listTasks, readTask, superviseCrew } from "../crew.js";

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
    expect(notify).toHaveBeenCalledWith("Flyd crew ✓", expect.stringContaining(`/land ${task.id}`));
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

  it("denies publishing and destructive commands to unattended crewmates", () => {
    expect(CREW_OPENCODE_CONFIG.permission.bash["git push*"]).toBe("deny");
    expect(CREW_OPENCODE_CONFIG.permission.bash["rm -rf *"]).toBe("deny");
    expect(crewBrief("x", ["npm test"], "flyd/x")).toContain("run and pass: npm test");
    expect(lastSummary(join(home, "missing.jsonl"))).toBe("");
  });
});
