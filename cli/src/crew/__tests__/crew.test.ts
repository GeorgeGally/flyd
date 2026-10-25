import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CREW_OPENCODE_CONFIG, MAX_CREW_ATTEMPTS, MAX_NO_PROGRESS_ITERATIONS, blockedBy, checkCommand, cleanupCrewWorktree, completeBaseline, runCheckCommand, crewBrief, crewBackupModels, discardCrewTask, nextBackupModel, dispatchCrewTask, failureSignatures, landCrewTask, lastSummary, onlyPreExistingFailures, listTasks, plainOutcome, providerFailure, readTask, superviseCrew, pruneCrewTasks, saveTask } from "../crew.js";

let home: string;
let repo: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-crew-"));
  process.env.FLYD_CREW_DIR = join(home, "crew");
  process.env.FLYD_CREW_WORKTREES = join(home, "worktrees");
  // Refusals fail outright unless a test asks for the switch to a backup model.
  process.env.FLYD_CREW_BACKUP_MODELS = "none";
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
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringMatching(/is done and tested\. Say \/land to merge it in\.$/), "deliverable");
    expect(existsSync(join(repo, "feature.txt"))).toBe(false);

    const landed = await landCrewTask(task.id);
    expect(landed.status).toBe("landed");
    expect(readFileSync(join(repo, "feature.txt"), "utf8")).toBe("done\n");
    expect(existsSync(task.worktree)).toBe(false);
  });

  it("fails a crewmate that committed nothing or whose checks fail, and never lands it", async () => {
    await dispatchCrewTask({ repo, outcome: "Do nothing", launch: fakeCrewmate(false) });
    const notify = vi.fn(async () => undefined);
    const [idle] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }), notify });
    expect(idle).toMatchObject({ status: "failed", reason: "no_progress", failure: "no progress: no files changed" });
    expect(notify).toHaveBeenCalledWith("Flyd", "Do nothing is blocked: it finished without changing any files. Tell me whether to try another way or drop it.", "blocker");
    await expect(landCrewTask(idle.id)).rejects.toThrow("not ready to land");

    await dispatchCrewTask({ repo, outcome: "Break the tests", launch: fakeCrewmate() });
    const [broken] = await superviseCrew({ alive: () => false, runCommand: async (command) => ({ ok: command !== "git diff --check", output: "boom" }), notify });
    expect(broken.failure).toBe("verification failed: git diff --check");
    expect(notify).toHaveBeenLastCalledWith("Flyd", "Break the tests is blocked: its tests failed. Tell me whether to try another way or drop it.", "blocker");
  });

  it("says the provider ran out of credit when that, not a test, is what the run recorded", async () => {
    const launch = vi.fn((task: { log: string }) => {
      writeFileSync(task.log, `${JSON.stringify({ type: "error", timestamp: 1, error: { type: "provider.quota", message: "This request requires more credits, or fewer max_tokens. You requested up to 256000 tokens, but can only afford 49.", status: 402 } })}\n`);
      return 424242;
    });
    await dispatchCrewTask({ repo, outcome: "Checkpoint and requeue the background jobs", launch });
    const notify = vi.fn(async (_title: string, _message: string, _kind?: string) => undefined);
    const [failed] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }), notify });
    expect(failed).toMatchObject({ status: "failed", verification: [] });
    expect(failed.failure).toMatch(/^provider error: This request requires more credits/);
    const reason = blockedBy(failed);
    expect(reason).toMatch(/provider/i);
    expect(reason).not.toMatch(/tests failed/i);
    expect(reason).not.toMatch(/\bcrew(?:mates?)?\b/i);
    const said = notify.mock.calls[0]?.[1];
    expect(said).toBe(`${plainOutcome(failed)} is blocked: ${reason}. Tell me whether to try another way or drop it.`);
    expect(said).not.toMatch(/tests failed|\bcrew(?:mates?)?\b/i);
  });

  it("leads with the provider's cause when partial work hit the credit wall and then failed its tests", async () => {
    const launch = vi.fn((task: { worktree: string; log: string }) => {
      writeFileSync(join(task.worktree, "partial.txt"), "half done\n");
      git(task.worktree, "add", ".");
      git(task.worktree, "commit", "-qm", "wip: partial");
      writeFileSync(task.log, [
        JSON.stringify({ type: "text", part: { type: "text", text: "Started on the checkpointing." } }),
        JSON.stringify({ type: "error", timestamp: 2, error: { type: "provider.quota", message: "This request requires more credits, or fewer max_tokens. You requested up to 256000 tokens, but can only afford 49.", status: 402 } }),
      ].join("\n") + "\n");
      return 424242;
    });
    await dispatchCrewTask({ repo, outcome: "Checkpoint and requeue the background jobs", launch });
    const notify = vi.fn(async (_title: string, _message: string, _kind?: string) => undefined);
    const [failed] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: false, output: "2 failing" }), notify });
    expect(failed).toMatchObject({ status: "failed", commits: 1 });
    expect(failed.verification?.some((step) => !step.ok)).toBe(true);
    const reason = blockedBy(failed);
    expect(reason.startsWith("the model provider was out of credit")).toBe(true);
    expect(reason.indexOf("provider")).toBeLessThan(reason.indexOf("tests"));
    expect(notify.mock.calls[0]?.[1]).toBe(`${plainOutcome(failed)} is blocked: ${reason}. Tell me whether to try another way or drop it.`);
  });

  it("does not blame the provider for an error the run recovered from", async () => {
    const launch = vi.fn((task: { log: string }) => {
      writeFileSync(task.log, [
        JSON.stringify({ type: "error", timestamp: 1, error: { type: "provider.quota", message: "Rate limited", status: 429 } }),
        JSON.stringify({ type: "text", part: { type: "text", text: "Retried and looked around; nothing to change." } }),
      ].join("\n") + "\n");
      return 424242;
    });
    await dispatchCrewTask({ repo, outcome: "Look for a change", launch });
    const [failed] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }) });
    expect(failed.failure).toBe("no progress: no files changed");
    expect(blockedBy(failed)).toBe("it finished without changing any files");
  });

  it("passes a check whose only failures were already failing on the base commit, and still fails a new one", async () => {
    const old = " FAIL  src/db.integration.test.ts > PostgresRunStore > parks\n";
    const added = " FAIL  src/feature.test.ts > feature > works\n";
    // On the base commit the suite is already red; the branch adds feature.txt.
    const suite = (cwd: string, extra: string) => existsSync(join(cwd, "feature.txt")) ? old + extra : old;
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "suite");
    const added_task = await dispatchCrewTask({ repo, outcome: "Add a feature file", launch: fakeCrewmate() });
    // Installed dependencies are untracked files; they must not block the baseline run.
    writeFileSync(join(added_task.worktree, "node_modules"), "linked deps\n");
    const [clean] = await superviseCrew({ alive: () => false, runCommand: async (command, cwd) => command === "git diff --check" ? { ok: true, output: "" } : { ok: false, output: suite(cwd, "") } });
    expect(clean.status).toBe("ready");
    expect(clean.verification?.some((step) => step.preExisting)).toBe(true);
    expect(git(clean.worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe(clean.branch);

    await dispatchCrewTask({ repo, outcome: "Break a test", launch: fakeCrewmate() });
    const [broken] = await superviseCrew({ alive: () => false, runCommand: async (command, cwd) => command === "git diff --check" ? { ok: true, output: "" } : { ok: false, output: suite(cwd, added) } });
    expect(broken.status).toBe("failed");
    expect(broken.failure).toMatch(/^verification failed: /);
  });

  it("never deletes a branch with commits because its worktree went missing, and re-checks it from a restored worktree", async () => {
    const task = await dispatchCrewTask({ repo, outcome: "Add a feature file", launch: fakeCrewmate() });
    git(repo, "worktree", "remove", "--force", task.worktree);
    const [checked] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }) });
    expect(checked).toMatchObject({ status: "ready", commits: 1 });
    expect(existsSync(join(task.worktree, "feature.txt"))).toBe(true);

    const second = await dispatchCrewTask({ repo, outcome: "Break it", launch: fakeCrewmate() });
    git(repo, "worktree", "remove", "--force", second.worktree);
    const [broken] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: false, output: "boom" }) });
    expect(broken.status).toBe("failed");
    expect(git(repo, "branch", "--list", second.branch)).not.toBe("");
  });

  it("runs checks under Core's own node, ahead of whatever the login shell would find", () => {
    const line = checkCommand("npm test", "/opt/node 22/bin");
    expect(line).toBe('export PATH="/opt/node 22/bin":"$PATH"; npm test');
    expect(execFileSync("/bin/bash", ["-c", checkCommand("command -v node")], { encoding: "utf8" }).trim()).toBe(process.execPath);
  });

  it("a timed-out check takes its whole process tree with it", async () => {
    const marker = join(home, "child.pid");
    const result = await runCheckCommand(`(sleep 30 & echo $! > ${marker}; wait)`, home, 500);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("timed out");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const child = Number(readFileSync(marker, "utf8"));
    expect(() => process.kill(child, 0)).toThrow();
  });

  it("runs one supervise pass at a time and skips while another live process holds it", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", launch: fakeCrewmate() });
    const lock = join(process.env.FLYD_CREW_DIR!, "supervise.lock");
    const sleeper = spawn("sleep", ["30"]);
    writeFileSync(lock, String(sleeper.pid));
    expect(await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }) })).toEqual([]);
    sleeper.kill();
    await new Promise((resolve) => sleeper.on("exit", resolve));
    const [done] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }) });
    expect(done.status).toBe("ready");
    expect(existsSync(lock)).toBe(false);
  });

  it("caches only a baseline that finished on a calm machine", () => {
    expect(completeBaseline(" FAIL  src/a.test.ts > A\n Test Files  1 failed | 9 passed (10)")).toBe(true);
    expect(completeBaseline(" RUN  v4.1.10 /x\nCommand failed: npm test")).toBe(false);
    expect(completeBaseline(" RUN  v4.1.10 /x\n\n\ncheck timed out after 15 min")).toBe(false);
    expect(completeBaseline(" Test Files  9 failed\n" + "Error: Test timed out in 5000ms.\n".repeat(6))).toBe(false);
  });

  it("reads vitest and tsc failures as stable signatures and never treats unreadable output as clean", () => {
    expect([...failureSignatures("\u001b[31m FAIL \u001b[39m src/a.test.ts > A > b\nsrc/x.ts(12,5): error TS2554: Expected 1 arguments.")])
      .toEqual(["FAIL src/a.test.ts > A > b", "src/x.ts TS2554 Expected 1 arguments."]);
    expect(onlyPreExistingFailures("src/x.ts(40,1): error TS2554: Expected 1 arguments.", "src/x.ts(12,5): error TS2554: Expected 1 arguments.")).toBe(true);
    expect(onlyPreExistingFailures("Segmentation fault", "Segmentation fault")).toBe(false);
  });

  it("moves a refused crewmate onto the next backup model in the same worktree, and only George's last resort fails", async () => {
    process.env.FLYD_CREW_BACKUP_MODELS = "cursor/auto";
    const refuse = (launched: { log: string }) => {
      writeFileSync(launched.log, `${JSON.stringify({ type: "error", error: { name: "APIError", data: { message: "Insufficient credits", statusCode: 402 } } })}\n`, { flag: "a" });
      return 424242;
    };
    const task = await dispatchCrewTask({ repo, outcome: "Add a feature file", launch: vi.fn(refuse) });
    const launch = vi.fn((_task: { model?: string; log: string }, _brief: string) => refuse(_task));
    const notify = vi.fn(async () => undefined);
    const [moved] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }), notify, launch });
    expect(moved).toMatchObject({ status: "running", model: "cursor/auto", triedModels: [task.model], pid: 424242 });
    expect(launch.mock.calls[0][1]).toContain("cut off by its model provider");
    expect(existsSync(task.worktree)).toBe(true);
    expect(notify).not.toHaveBeenCalled();

    // Cursor refuses too: nothing left to try, so George hears it's blocked.
    const [failed] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }), notify, launch });
    expect(failed).toMatchObject({ status: "failed", model: "cursor/auto", failure: "provider error: Insufficient credits" });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("reads the backup list, with Cursor as the default and none turning it off", () => {
    expect(crewBackupModels()).toEqual([]);
    delete process.env.FLYD_CREW_BACKUP_MODELS;
    expect(crewBackupModels()).toEqual(["cursor/auto"]);
    expect(nextBackupModel({ model: "cursor/auto" } as never)).toBeUndefined();
    process.env.FLYD_CREW_BACKUP_MODELS = "opencode-go/kimi-k3, cursor/auto";
    expect(nextBackupModel({ model: "opencode-go/gpt-6-luna" } as never)).toBe("opencode-go/kimi-k3");
    expect(nextBackupModel({ model: "cursor/auto", triedModels: ["opencode-go/gpt-6-luna", "opencode-go/kimi-k3"] } as never)).toBeUndefined();
  });

  it("reads a Cursor log: its last words and a refused result", () => {
    const log = join(home, "cursor.log");
    writeFileSync(log, [
      JSON.stringify({ type: "system", subtype: "init", model: "Auto" }),
      JSON.stringify({ type: "tool_call", subtype: "completed", call_id: "1" }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Added the feature file and ran the tests." }] } }),
      "",
    ].join("\n"));
    expect(lastSummary(log)).toBe("Added the feature file and ran the tests.");
    expect(providerFailure(log)).toBeUndefined();
    writeFileSync(log, `${JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "You've hit your usage limit" })}\n`, { flag: "a" });
    expect(providerFailure(log)).toBe("You've hit your usage limit");
  });

  it("records a provider refusal as the failure, says it plainly to George, and clears the empty worktree", async () => {
    const task = await dispatchCrewTask({
      repo,
      outcome: "Add a feature file",
      launch: vi.fn((launched: { log: string }) => {
        writeFileSync(launched.log, [
          JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
          JSON.stringify({ type: "error", error: { name: "APIError", data: { message: "Insufficient credits. Add more at openrouter.ai/settings/credits", statusCode: 402 } } }),
          "",
        ].join("\n"));
        return 424242;
      }),
    });
    const notify = vi.fn(async () => undefined);
    const [failed] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }), notify });
    expect(failed).toMatchObject({ status: "failed", failure: "provider error: Insufficient credits. Add more at openrouter.ai/settings/credits", worktreeRemoved: true });
    expect(notify).toHaveBeenCalledWith("Flyd", "Add a feature file is blocked: the model provider was out of credit for the tokens it asked for; top up and retry. Tell me whether to try another way or drop it.", "blocker");
    expect(existsSync(task.worktree)).toBe(false);
    expect(git(repo, "branch", "--list", task.branch)).toBe("");
    expect(git(repo, "worktree", "list")).not.toContain(task.worktree);
  });

  it("reads provider refusals from error events and plain lines, never from the crewmate's own prose", () => {
    const log = join(home, "provider.log");
    writeFileSync(log, `${JSON.stringify({ type: "text", part: { type: "text", text: "I hit a rate limit earlier but retried." } })}\n`);
    expect(providerFailure(log)).toBeUndefined();
    writeFileSync(log, "Error: 429 Too Many Requests: usage limit reached for this month\n");
    expect(providerFailure(log)).toBe("Error: 429 Too Many Requests: usage limit reached for this month");
    writeFileSync(log, `${JSON.stringify({ type: "error", error: { message: "invalid x-api-key" } })}\n`);
    expect(providerFailure(log)).toBe("invalid x-api-key");
    expect(providerFailure(join(home, "missing.log"))).toBeUndefined();
  });

  it("clears a failed task's worktree but keeps its branch while it holds commits, and keeps uncommitted work", async () => {
    const broken = await dispatchCrewTask({ repo, outcome: "Break the tests", launch: fakeCrewmate() });
    const [failed] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: false, output: "boom" }) });
    expect(failed).toMatchObject({ status: "failed", worktreeRemoved: true });
    expect(existsSync(broken.worktree)).toBe(false);
    expect(git(repo, "branch", "--list", broken.branch)).toContain(broken.branch);

    const dirty = await dispatchCrewTask({ repo, outcome: "Leave a mess", launch: vi.fn((task: { worktree: string; log: string }) => {
      writeFileSync(join(task.worktree, "half.txt"), "half\n");
      writeFileSync(task.log, "");
      return 424242;
    }) });
    const [messy] = await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }) });
    expect(messy).toMatchObject({ status: "failed", failure: "no commits (uncommitted changes left in the worktree)" });
    expect(messy.worktreeRemoved).toBeUndefined();
    expect(existsSync(join(dirty.worktree, "half.txt"))).toBe(true);
    // Discarding is George's call: then it goes, branch and all.
    expect(await cleanupCrewWorktree(dirty, { force: true, deleteBranch: true })).toBe(true);
    expect(git(repo, "branch", "--list", dirty.branch)).toBe("");
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

  it("tidies old failed and discarded tasks on the supervise tick, keeping a branch that holds work", async () => {
    const runCommand = async () => ({ ok: true, output: "" });
    // Failed with nothing committed: worktree and branch both go.
    const empty = await dispatchCrewTask({ repo, outcome: "Do nothing", launch: fakeCrewmate(false) });
    await superviseCrew({ alive: () => false, runCommand });
    // Failed with a commit of its own: worktree goes, branch stays.
    const broken = await dispatchCrewTask({ repo, outcome: "Break the tests", launch: fakeCrewmate() });
    await superviseCrew({ alive: () => false, runCommand: async (command) => ({ ok: command !== "git diff --check", output: "boom" }) });
    // Failed with uncommitted changes left behind: nothing is touched.
    const dirty = await dispatchCrewTask({ repo, outcome: "Leave a mess", launch: fakeCrewmate(false) });
    writeFileSync(join(dirty.worktree, "wip.txt"), "half done\n");
    await superviseCrew({ alive: () => false, runCommand });
    // A recent failure is left for George to look at.
    const recent = await dispatchCrewTask({ repo, outcome: "Fresh failure", launch: fakeCrewmate(false) });
    await superviseCrew({ alive: () => false, runCommand });
    saveTask({ ...readTask(recent.id)!, finishedAt: new Date(Date.now() + 9 * 86_400_000).toISOString() });
    expect([empty, broken, dirty, recent].map((task) => readTask(task.id)?.status)).toEqual(["failed", "failed", "failed", "failed"]);
    // A clean failed worktree goes at once (its branch kept while it holds commits); the rest wait for the tidy.
    expect([empty, broken].some((task) => existsSync(task.worktree))).toBe(false);
    expect(git(repo, "branch", "--list", broken.branch)).not.toBe("");
    expect(existsSync(dirty.worktree)).toBe(true);

    await superviseCrew({ alive: () => false, runCommand, now: () => new Date(Date.now() + 10 * 86_400_000) });

    expect(existsSync(empty.worktree)).toBe(false);
    expect(git(repo, "branch", "--list", empty.branch)).toBe("");
    expect(readTask(empty.id)?.prunedAt).toBeTruthy();
    expect(existsSync(broken.worktree)).toBe(false);
    expect(git(repo, "branch", "--list", broken.branch)).toContain(broken.branch);
    expect(readTask(broken.id)?.prunedAt).toBeTruthy();
    expect(existsSync(join(dirty.worktree, "wip.txt"))).toBe(true);
    expect(readTask(dirty.id)?.prunedAt).toBeUndefined();
    expect(readTask(recent.id)?.prunedAt).toBeUndefined();
    expect(readTask(recent.id)?.status).toBe("failed");
  });

  it("prunes a discarded task's leftovers, branch and all, once it is old enough", async () => {
    const task = await dispatchCrewTask({ repo, outcome: "Add a feature file", launch: fakeCrewmate() });
    await superviseCrew({ alive: () => false, runCommand: async () => ({ ok: true, output: "" }) });
    // A discard whose cleanup never happened (say the repo was busy) leaves both behind.
    saveTask({ ...readTask(task.id)!, status: "discarded", finishedAt: new Date().toISOString() });
    expect(await pruneCrewTasks({ days: 7 })).toEqual([]);
    const [pruned] = await pruneCrewTasks({ days: 7, now: new Date(Date.now() + 8 * 86_400_000) });
    expect(pruned).toMatchObject({ worktreeRemoved: true, branchDeleted: true });
    expect(existsSync(task.worktree)).toBe(false);
    expect(git(repo, "branch", "--list", task.branch)).toBe("");
    expect(await pruneCrewTasks({ days: 0, now: new Date(Date.now() + 9 * 86_400_000) })).toEqual([]);
  });

  it("fails a no-op agent after a bounded number of iterations and persists its last message", async () => {
    const lastMessage = "I inspected the task, but have not changed any files.";
    const task = await dispatchCrewTask({
      repo,
      outcome: "Make a change",
      launch: vi.fn((launched: { log: string }) => {
        writeFileSync(launched.log, `${JSON.stringify({ type: "text", part: { type: "text", text: lastMessage } })}\n`);
        return 424242;
      }),
    });
    const kill = vi.fn();
    let result;
    for (let iteration = 0; iteration < MAX_NO_PROGRESS_ITERATIONS; iteration += 1) {
      writeFileSync(task.log, `${JSON.stringify({ type: "step_finish" })}\n`, { flag: "a" });
      [result] = await superviseCrew({ alive: () => true, kill });
      if (result?.status === "failed") break;
    }

    expect(result).toMatchObject({
      status: "failed",
      reason: "no_progress",
      noProgressIterations: MAX_NO_PROGRESS_ITERATIONS,
      trace: lastMessage,
    });
    expect(kill).toHaveBeenCalledWith(424242);
    expect(readTask(task.id)).toMatchObject({ reason: "no_progress", trace: lastMessage });
    expect(readFileSync(task.log, "utf8")).toContain(lastMessage);
    expect(Date.parse(result!.finishedAt!) - Date.parse(task.createdAt)).toBeLessThan(2 * 60 * 60 * 1000);
    expect(blockedBy(result!)).toContain("made no file changes");
  });

  it("refuses to launch a real crewmate under tests", async () => {
    await expect(dispatchCrewTask({ repo, outcome: "Would be real" })).rejects.toThrow("refusing to launch a real OpenCode crewmate under tests");
  });

  it("denies publishing and destructive commands to unattended crewmates", () => {
    expect(CREW_OPENCODE_CONFIG.permission.bash["git push*"]).toBe("deny");
    expect(CREW_OPENCODE_CONFIG.permission.bash["rm -rf *"]).toBe("deny");
    expect(crewBrief("x", ["npm test"], "flyd/x")).toContain("run and pass: npm test");
    // George's learned taste rides in the brief, ahead of the rules.
    const taste = "George's taste (learned from his own corrections…):\n\nEverywhere:\n- No shadows on icon boxes.";
    const brief = crewBrief("x", ["npm test"], "flyd/x", [], taste);
    expect(brief.indexOf("No shadows on icon boxes.")).toBeGreaterThan(-1);
    expect(brief.indexOf("No shadows on icon boxes.")).toBeLessThan(brief.indexOf("Rules:"));
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
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringMatching(/done and tested/), "deliverable");
  });

  it("lands a self-improvement fix on its own once every point is met, and tells George afterwards", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, source: "self-improvement", launch: fakeCrewmate() });
    const review = vi.fn(async (_prompt: string) => "MET 1: feature.txt contains done\nMET 2: test added");
    const notify = vi.fn(async () => {});
    const [done] = await superviseCrew({ alive: () => false, runCommand: passing, review, notify });
    expect(done.status).toBe("landed");
    expect(existsSync(join(repo, "feature.txt"))).toBe(true);
    expect(notify).toHaveBeenCalledWith("Flyd", "Add a feature file is merged into main: its tests pass and it does everything you asked.", "deliverable");
  });

  it("leaves a self-improvement fix for George when a point is unmet, and work from chat always", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate() });
    const review = vi.fn(async (_prompt: string) => "MET 1: feature.txt contains done\nMET 2: test added");
    const [fromChat] = await superviseCrew({ alive: () => false, runCommand: passing, review });
    expect(fromChat.status).toBe("ready");
    expect(existsSync(join(repo, "feature.txt"))).toBe(false);
  });

  it("says why when a self-improvement fix could not land itself", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, source: "self-improvement", launch: fakeCrewmate() });
    writeFileSync(join(repo, "README.md"), "edited by George\n");
    const review = vi.fn(async (_prompt: string) => "MET 1: feature.txt contains done\nMET 2: test added");
    const notify = vi.fn(async () => {});
    const [done] = await superviseCrew({ alive: () => false, runCommand: passing, review, notify });
    expect(done.status).toBe("ready");
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringMatching(/couldn't merge it myself: .*uncommitted changes.*Say \/land once that's sorted\.$/), "deliverable");
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
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringContaining("still short on: a test covers the feature (no test in the diff). Your call whether to /land it."), "deliverable");
  });

  it("doesn't rebuild when the review itself breaks", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate() });
    const relaunch = vi.fn(() => 1);
    const [done] = await superviseCrew({ alive: () => false, runCommand: passing, review: async () => { throw new Error("down"); }, launch: relaunch });
    expect(relaunch).not.toHaveBeenCalled();
    expect(done.status).toBe("ready");
    expect(done.review?.[0].note).toBe("the review couldn't run");
  });

  it("reviews again on a later pass when the review couldn't run, and tells George the verdict", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate() });
    await superviseCrew({ alive: () => false, runCommand: passing, review: async () => { throw new Error("401 bad key"); } });
    const notify = vi.fn(async () => {});
    const [judged] = await superviseCrew({ alive: () => false, runCommand: passing, notify, review: async () => "MET 1: yes\nMET 2: yes" });
    expect(judged).toMatchObject({ status: "ready", reviewRetries: 1, review: [{ met: true }, { met: true }] });
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringMatching(/done and tested/), "deliverable");
  });

  it("stops retrying a review that keeps failing", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate() });
    const review = vi.fn(async (): Promise<string> => { throw new Error("down"); });
    for (let pass = 0; pass < 6; pass += 1) await superviseCrew({ alive: () => false, runCommand: passing, review });
    expect(review).toHaveBeenCalledTimes(4);
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
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringContaining("still short on: a test covers the feature (no test)"), "deliverable");
  });

  it("says so when it couldn't review, rather than calling the work short", async () => {
    await dispatchCrewTask({ repo, outcome: "Add a feature file", doneWhen, launch: fakeCrewmate() });
    const notify = vi.fn(async () => {});
    const [done] = await superviseCrew({ alive: () => false, runCommand: passing, notify, review: async () => "LGTM" });
    expect(done.review?.every((check) => check.unchecked)).toBe(true);
    expect(notify).toHaveBeenCalledWith("Flyd", expect.stringContaining("I couldn't check it against what you asked"), "deliverable");
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

describe("what stopped a failed task", () => {
  it("says each failure in plain words, never the raw error", () => {
    expect(blockedBy({ reason: "no_progress", noProgressIterations: 0, failure: "no progress: no files changed" })).toBe("it finished without changing any files");
    expect(blockedBy({ reason: "no_progress", noProgressIterations: 3, failure: "no progress after 3 iterations" })).toBe("it made no file changes for 3 consecutive iterations");
    expect(blockedBy({ failure: "no commits" })).toBe("nothing was committed");
    expect(blockedBy({ failure: "no commits (uncommitted changes left in the worktree)" })).toBe("changes were made but never committed");
    expect(blockedBy({ failure: "stopped after 2 hours without finishing" })).toBe("it ran for two hours without finishing");
    expect(blockedBy({ failure: "provider error: insufficient credits" })).toBe("the model provider was out of credit for the tokens it asked for; top up and retry");
    expect(blockedBy({ failure: "provider error: 429 usage limit reached" })).toBe("the model provider refused the run; retry it once it's reachable");
    expect(blockedBy({ failure: "provider error: invalid x-api-key" })).toBe("the model provider refused the run; retry it once it's reachable");
    expect(blockedBy({ failure: "Command failed: ENOENT /tmp/x.sh" })).toBe("it couldn't be finished");
    expect(blockedBy({})).toBe("it couldn't be finished");
  });

  it("only blames the tests when the run recorded a failing check", () => {
    expect(blockedBy({ failure: "verification failed: npm test", verification: [{ command: "npm test", ok: false, tail: "2 failing" }] })).toBe("its tests failed");
    expect(blockedBy({ failure: "verification failed: npm test", verification: [] })).toBe("it couldn't be finished");
    expect(blockedBy({ failure: "verification failed: npm test" })).toBe("it couldn't be finished");
  });

  it("names the provider's own cause when it, not a test, stopped the run", () => {
    const credit = "provider error: This request requires more credits, or fewer max_tokens. You requested up to 256000 tokens, but can only afford 49.";
    expect(blockedBy({ failure: credit, verification: [] })).toBe("the model provider was out of credit for the tokens it asked for; top up and retry");
    expect(blockedBy({ failure: "provider error: the upstream model returned 503", verification: [] })).toBe("the model provider refused the run; retry it once it's reachable");
  });
});
