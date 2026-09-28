import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { FLYD_DIR } from "../lib/config.js";
import { normalizeCriteria, parseVerdicts, shortfall, unmetChecks, VERDICT_FORMAT, type AcceptanceCheck } from "../runtime/acceptance.js";
import { verificationCommandsForRepository } from "../runtime/verification-commands.js";

// Flyd as first mate. George states the outcome once; Flyd briefs an
// OpenCode crewmate, gives it a clean git worktree, supervises it to
// completion, verifies the result with the repository's own checks, and
// reports back. Nothing lands on George's branch without his word.
//
// Scripts own the mechanics (worktrees, processes, verification, merges);
// the crewmate owns the judgment inside its worktree. State is plain JSON
// on disk, so a restart is a non-event.

const execFileAsync = promisify(execFile);

export type CrewStatus = "running" | "verifying" | "ready" | "failed" | "landed" | "discarded";

export interface CrewTask {
  id: string;
  repo: string;
  outcome: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  worktree: string;
  status: CrewStatus;
  pid?: number;
  log: string;
  createdAt: string;
  finishedAt?: string;
  verification?: Array<{ command: string; ok: boolean; tail: string }>;
  diffStat?: string;
  commits?: number;
  summary?: string;
  failure?: string;
  source?: "chat" | "self-improvement" | "cli";
  notified?: boolean;
  /** What done means, stated at dispatch. Empty: the outcome itself is the one point. */
  doneWhen?: string[];
  /** The independent review of the diff against doneWhen, after the checks pass. */
  review?: AcceptanceCheck[];
  /** Crewmate runs so far: the first build plus any repair round. */
  attempts?: number;
  /** When the current crewmate run began; the runtime cap is per run. */
  attemptStartedAt?: string;
}

export function crewDir(): string {
  return process.env.FLYD_CREW_DIR?.trim() || join(FLYD_DIR, "crew");
}

function worktreeRoot(): string {
  return process.env.FLYD_CREW_WORKTREES?.trim() || join(homedir(), ".flyd", "worktrees");
}

function taskPath(id: string, dir = crewDir()): string {
  return join(dir, "tasks", `${id}.json`);
}

export function saveTask(task: CrewTask, dir = crewDir()): void {
  const path = taskPath(task.id, dir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(task, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function readTask(id: string, dir = crewDir()): CrewTask | null {
  try { return JSON.parse(readFileSync(taskPath(id, dir), "utf8")) as CrewTask; } catch { return null; }
}

export function listTasks(dir = crewDir()): CrewTask[] {
  const tasksDir = join(dir, "tasks");
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir).filter((name) => name.endsWith(".json"))
    .flatMap((name) => { const task = readTask(name.replace(/\.json$/, ""), dir); return task ? [task] : []; })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function git(cwd: string, args: string[], timeout = 60_000): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "task";
}

/**
 * Permissions for an unattended crewmate: build and test freely inside its
 * worktree, never publish, destroy, or escalate. (Enforced by OpenCode.)
 */
export const CREW_OPENCODE_CONFIG = {
  permission: {
    edit: "allow",
    webfetch: "allow",
    bash: {
      "*": "allow",
      "git push*": "deny",
      "git remote*": "deny",
      "git reset --hard*": "deny",
      "git clean*": "deny",
      "git checkout main*": "deny",
      "git switch main*": "deny",
      "rm -rf *": "deny",
      "sudo *": "deny",
      "gh pr merge*": "deny",
      "npm publish*": "deny",
    },
  },
};

/** One repair round after the first review; more is paying to repeat a failure. */
export const MAX_CREW_ATTEMPTS = 2;

export function acceptanceCriteria(task: Pick<CrewTask, "outcome" | "doneWhen">): string[] {
  return task.doneWhen?.length ? task.doneWhen : [task.outcome];
}

export function crewBrief(outcome: string, verification: string[], branch: string, doneWhen: string[] = []): string {
  return [
    "You are a crewmate working for Flyd, George's personal agent. Deliver this outcome, unattended:",
    "",
    outcome,
    "",
    ...(doneWhen.length ? [
      "Done when (an independent reviewer will check each point against your diff):",
      ...doneWhen.map((criterion, index) => `${index + 1}. ${criterion}`),
      "",
    ] : []),
    "Rules:",
    `- You are on branch ${branch} in a dedicated git worktree. Work only here. Never push, never touch other branches.`,
    "- Read the repository's AGENTS.md / CLAUDE.md / README first and follow its conventions.",
    "- This is a fresh worktree: dependencies are not installed. Install them (e.g. npm ci) before running checks.",
    "- Make the smallest complete change that delivers the outcome. Add or update tests for behaviour you change.",
    `- Before finishing, run and pass: ${verification.join(" && ") || "the project's own tests"}.`,
    "- Commit your work on this branch with a clear conventional commit message. Uncommitted work is lost.",
    "- If you cannot finish, commit what is safe and explain exactly what blocks you.",
    "- End with a short plain-English summary: what changed, how you verified it, anything George must decide.",
  ].join("\n");
}

export interface DispatchOptions {
  repo: string;
  outcome: string;
  doneWhen?: string[];
  source?: CrewTask["source"];
  now?: Date;
  dir?: string;
  /** Test seam: start the crewmate process. */
  launch?: (task: CrewTask, brief: string) => number | undefined;
}

export async function dispatchCrewTask(options: DispatchOptions): Promise<CrewTask> {
  const now = options.now ?? new Date();
  const dir = options.dir ?? crewDir();
  const repo = await git(options.repo, ["rev-parse", "--show-toplevel"]).catch(() => {
    throw new Error(`${options.repo} is not a git repository`);
  });
  const outcome = options.outcome.replace(/\s+/g, " ").trim();
  if (!outcome) throw new Error("A crew task needs an outcome");
  const doneWhen = normalizeCriteria(options.doneWhen ?? []);
  const baseBranch = await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const baseCommit = await git(repo, ["rev-parse", "HEAD"]);
  const id = `${now.getTime().toString(36)}-${slug(outcome).slice(0, 20)}`;
  const branch = `flyd/${slug(outcome)}-${now.getTime().toString(36).slice(-4)}`;
  const worktree = join(worktreeRoot(), `${basename(repo)}-${id}`);
  mkdirSync(dirname(worktree), { recursive: true, mode: 0o700 });
  await git(repo, ["worktree", "add", "-b", branch, worktree, baseCommit]);

  const verification = await verificationCommandsForRepository(worktree).catch(() => []);
  const log = join(dir, "logs", `${id}.jsonl`);
  mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
  const task: CrewTask = {
    id, repo, outcome, branch, baseBranch, baseCommit, worktree, status: "running", log,
    createdAt: now.toISOString(), source: options.source ?? "chat", attempts: 1,
    ...(doneWhen.length ? { doneWhen } : {}),
  };
  const brief = crewBrief(outcome, verification, branch, doneWhen);
  const pid = (options.launch ?? launchOpenCode)(task, brief);
  saveTask({ ...task, ...(pid ? { pid } : {}) }, dir);
  return readTask(id, dir)!;
}

export function openCodePath(): string {
  const configured = process.env.FLYD_OPENCODE_PATH?.trim();
  if (configured) return configured;
  const home = join(homedir(), ".opencode", "bin", "opencode");
  return existsSync(home) ? home : "opencode";
}

/** Start `opencode run` detached in the worktree; its JSON events stream to the task log. */
export function launchOpenCode(task: CrewTask, brief: string): number | undefined {
  // A test once dispatched a real crewmate against Flyd itself. Never again.
  if (process.env.VITEST && process.env.FLYD_CREW_ALLOW_LAUNCH !== "1") {
    throw new Error("refusing to launch a real OpenCode crewmate under tests");
  }
  const out = openSync(task.log, "a");
  const args = ["run", "--format", "json", "--dir", task.worktree, "--title", `flyd:${task.id}`, "--auto"];
  const model = process.env.FLYD_CREW_MODEL?.trim();
  if (model) args.push("--model", model);
  args.push(brief);
  const child = spawn(openCodePath(), args, {
    cwd: task.worktree,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(CREW_OPENCODE_CONFIG) },
  });
  child.unref();
  closeSync(out);
  return child.pid;
}

export function processAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The crewmate's final words from its OpenCode JSON event log. */
export function lastSummary(logPath: string): string {
  if (!existsSync(logPath)) return "";
  const texts: string[] = [];
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as { type?: string; part?: { type?: string; text?: string }; text?: string };
      const text = event.part?.type === "text" ? event.part.text : event.type === "text" ? event.text : undefined;
      if (text?.trim()) texts.push(text.trim());
    } catch { /* not an event */ }
  }
  return (texts.at(-1) ?? "").slice(0, 1_500);
}

export interface SuperviseDependencies {
  now?: () => Date;
  dir?: string;
  notify?: (title: string, message: string) => Promise<void>;
  /** Test seams. */
  alive?: (pid: number | undefined) => boolean;
  runCommand?: (command: string, cwd: string) => Promise<{ ok: boolean; output: string }>;
  kill?: (pid: number) => void;
  /** The independent reviewer's raw reply, or null to skip review. Defaults to a model call outside tests. */
  review?: (prompt: string) => Promise<string | null>;
  /** Restart the crewmate in its worktree for a repair round. */
  launch?: (task: CrewTask, brief: string) => number | undefined;
}

export function reviewPrompt(task: CrewTask, diff: string): string {
  return [
    "You are reviewing work a coding agent did for George. Its tests already pass; that proves little about whether it did what was asked.",
    "Your job is to find what would make it unacceptable, not to confirm it looks good.",
    `The outcome asked for: ${task.outcome}`,
    "Done when:",
    ...acceptanceCriteria(task).map((criterion, index) => `${index + 1}. ${criterion}`),
    `The agent's own summary (a claim, not proof):\n"""${task.summary ?? ""}"""`,
    `The diff:\n\`\`\`diff\n${diff}\n\`\`\``,
    "Judge each point from the diff alone: an easier version of the outcome, a stub, a test that asserts nothing, or a point the diff never touches is UNMET.",
    ...VERDICT_FORMAT,
  ].join("\n");
}

export function crewRepairBrief(task: CrewTask, unmet: AcceptanceCheck[], verification: string[]): string {
  return [
    "You are a crewmate working for Flyd, George's personal agent, continuing unattended work on this outcome:",
    "",
    task.outcome,
    "",
    "An independent reviewer read your diff and found these points not met:",
    ...unmet.map((check) => `- ${check.criterion}: ${check.note}`),
    "",
    "Rules:",
    `- You are on branch ${task.branch} in a dedicated git worktree, with your earlier commits. Work only here. Never push, never touch other branches.`,
    "- Fix the points above with the smallest complete change. If one can't be met, say exactly why.",
    `- Before finishing, run and pass: ${verification.join(" && ") || "the project's own tests"}.`,
    "- Commit your work on this branch. Uncommitted work is lost.",
    "- End with a short plain-English summary: what changed, how you verified it, anything George must decide.",
  ].join("\n");
}

const MAX_REVIEW_DIFF = 80_000;
const REVIEW_TIMEOUT_MS = Number(process.env.FLYD_CREW_REVIEW_TIMEOUT_MS) || 5 * 60_000;
/** Generated and vendored files say nothing about whether the outcome was delivered. */
const REVIEW_EXCLUDES = [":(exclude)**/package-lock.json", ":(exclude)**/yarn.lock", ":(exclude)**/pnpm-lock.yaml", ":(exclude)**/dist/**", ":(exclude)**/*.min.js"];

async function defaultReview(prompt: string): Promise<string | null> {
  if (process.env.VITEST || process.env.FLYD_CREW_REVIEW === "0") return null;
  const { query } = await import("../lib/llm.js");
  // A hung reviewer must not stall every supervise tick behind it.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`review timed out after ${REVIEW_TIMEOUT_MS}ms`)), REVIEW_TIMEOUT_MS);
    timer.unref();
  });
  try {
    return await Promise.race([query(prompt), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The diff the reviewer judges: a stat of everything, then the substantive files, clipped. */
async function reviewDiff(task: CrewTask): Promise<string> {
  const range = `${task.baseCommit}..HEAD`;
  const stat = await git(task.worktree, ["diff", "--stat", range]).catch(() => "");
  const diff = await git(task.worktree, ["diff", range, "--", ".", ...REVIEW_EXCLUDES]).catch(() => "");
  const clipped = diff.length > MAX_REVIEW_DIFF
    ? `${diff.slice(0, MAX_REVIEW_DIFF)}\n… (diff truncated here; files in the stat but not shown above are unseen, so don't judge a point UNMET only because its change isn't visible)`
    : diff;
  return `${stat}\n\n${clipped}`;
}

const MAX_RUNTIME_MS = 2 * 60 * 60 * 1000;

async function defaultRunCommand(command: string, cwd: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("/bin/bash", ["-lc", command], { cwd, timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message ?? ""}` };
  }
}

/** Advance every running crewmate: finished ones are verified and reported; stuck ones are stopped. */
export async function superviseCrew(deps: SuperviseDependencies = {}): Promise<CrewTask[]> {
  const now = (deps.now ?? (() => new Date()))();
  const dir = deps.dir ?? crewDir();
  const alive = deps.alive ?? processAlive;
  const run = deps.runCommand ?? defaultRunCommand;
  const changed: CrewTask[] = [];
  for (const task of listTasks(dir).filter((item) => item.status === "running")) {
    if (alive(task.pid)) {
      if (now.getTime() - Date.parse(task.attemptStartedAt ?? task.createdAt) > MAX_RUNTIME_MS) {
        try { (deps.kill ?? ((pid: number) => process.kill(-pid, "SIGTERM")))(task.pid!); } catch { /* already gone */ }
        const failed = { ...task, status: "failed" as const, failure: "stopped after 2 hours without finishing", finishedAt: now.toISOString() };
        saveTask(failed, dir);
        changed.push(failed);
      }
      continue;
    }
    saveTask({ ...task, status: "verifying" }, dir);
    const summary = lastSummary(task.log);
    let commits = 0;
    let diffStat = "";
    try {
      commits = Number(await git(task.worktree, ["rev-list", "--count", `${task.baseCommit}..HEAD`])) || 0;
      diffStat = await git(task.worktree, ["diff", "--shortstat", `${task.baseCommit}..HEAD`]);
    } catch { /* worktree gone */ }
    const dirty = await git(task.worktree, ["status", "--porcelain"]).catch(() => "");
    const verification: CrewTask["verification"] = [];
    if (commits > 0) {
      for (const command of await verificationCommandsForRepository(task.worktree).catch(() => [])) {
        const result = await run(command, task.worktree);
        verification.push({ command, ok: result.ok, tail: result.output.trim().split("\n").slice(-8).join("\n").slice(-800) });
        if (!result.ok) break;
      }
    }
    const verified = commits > 0 && verification.every((step) => step.ok);
    // Passing checks is necessary, not sufficient: an independent reviewer
    // holds the diff to what was asked, and unmet points go back to the
    // crewmate once before George hears about it.
    let review: AcceptanceCheck[] | undefined;
    if (verified) {
      const criteria = acceptanceCriteria(task);
      let repairable = true;
      try {
        const reply = await (deps.review ?? defaultReview)(reviewPrompt({ ...task, summary }, await reviewDiff(task)));
        if (reply !== null) review = parseVerdicts(criteria, reply);
      } catch (error) {
        console.warn("[crew] independent review failed:", error instanceof Error ? error.message : error);
        review = criteria.map((criterion) => ({ criterion, met: false, note: "the review couldn't run", unchecked: true }));
        repairable = false;
      }
      const unmet = unmetChecks(review ?? []);
      const attempts = task.attempts ?? 1;
      if (unmet.length && repairable && attempts < MAX_CREW_ATTEMPTS) {
        const commands = verification.map((step) => step.command);
        let pid: number | undefined;
        try {
          pid = (deps.launch ?? launchOpenCode)(task, crewRepairBrief(task, unmet, commands));
        } catch (error) {
          console.warn("[crew] repair relaunch failed:", error instanceof Error ? error.message : error);
        }
        if (pid) {
          // A fresh clock for the repair round; without a live pid there is nothing to wait for.
          const again: CrewTask = { ...task, status: "running", attempts: attempts + 1, review, commits, diffStat, verification, summary, pid, attemptStartedAt: now.toISOString() };
          saveTask(again, dir);
          changed.push(again);
          continue;
        }
      }
    }
    const done: CrewTask = {
      ...task,
      status: verified ? "ready" : "failed",
      finishedAt: now.toISOString(),
      commits, diffStat, verification, summary,
      ...(review ? { review } : {}),
      ...(verified ? {} : {
        failure: commits === 0
          ? `no commits${dirty ? " (uncommitted changes left in the worktree)" : ""}`
          : `verification failed: ${verification.find((step) => !step.ok)?.command ?? "unknown"}`,
      }),
    };
    saveTask(done, dir);
    changed.push(done);
  }
  for (const task of changed.filter((item) => item.status !== "running" && !item.notified && deps.notify)) {
    const judged = (task.review ?? []).filter((check) => !check.unchecked);
    const short = unmetChecks(judged).length ? shortfall(judged) : "";
    const unreviewed = judged.length < (task.review ?? []).length;
    const message = task.status !== "ready"
      ? `I couldn't finish ${plainOutcome(task)} (${task.failure}).`
      : short
        ? `${plainOutcome(task)} passes its tests but is still short on: ${short}. Your call whether to /land it.`
        : unreviewed
          ? `${plainOutcome(task)} passes its tests, but I couldn't check it against what you asked. Have a look before you /land it.`
          : `${plainOutcome(task)} is done and tested. Say /land to merge it in.`;
    await deps.notify!("Flyd", message).catch(() => undefined);
    saveTask({ ...task, notified: true }, dir);
  }
  return changed;
}

/**
 * Land a verified task on the branch it started from. Fast-forward when
 * possible, a merge commit otherwise; refuses a dirty or moved checkout
 * rather than guessing.
 */
export async function landCrewTask(id: string, dir = crewDir()): Promise<CrewTask> {
  const task = readTask(id, dir);
  if (!task) throw new Error(`No crew task ${id}`);
  if (task.status !== "ready") throw new Error(`Task ${id} is ${task.status}, not ready to land`);
  const current = await git(task.repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current !== task.baseBranch) throw new Error(`${task.repo} is on ${current}; switch back to ${task.baseBranch} to land`);
  if (await git(task.repo, ["status", "--porcelain", "--untracked-files=no"])) throw new Error(`${task.repo} has uncommitted changes; commit or stash them first`);
  try {
    await git(task.repo, ["merge", "--ff-only", task.branch]);
  } catch {
    await git(task.repo, ["merge", "--no-ff", "-m", `Merge ${task.branch}: ${task.outcome.slice(0, 60)}`, task.branch]);
  }
  await git(task.repo, ["worktree", "remove", task.worktree]).catch(() => undefined);
  const landed = { ...task, status: "landed" as const };
  saveTask(landed, dir);
  return landed;
}

/** Discard a task's worktree and branch (George's call; the branch is gone after this). */
export async function discardCrewTask(id: string, dir = crewDir()): Promise<CrewTask> {
  const task = readTask(id, dir);
  if (!task) throw new Error(`No crew task ${id}`);
  if (task.status === "running" && processAlive(task.pid)) {
    try { process.kill(-task.pid!, "SIGTERM"); } catch { /* gone */ }
  }
  await git(task.repo, ["worktree", "remove", "--force", task.worktree]).catch(() => undefined);
  await git(task.repo, ["branch", "-D", task.branch]).catch(() => undefined);
  const discarded = { ...task, status: "discarded" as const };
  saveTask(discarded, dir);
  return discarded;
}

/** The work in George's terms: its first sentence, without the self-improvement preamble. */
export function plainOutcome(task: CrewTask): string {
  const text = task.outcome.replace(/^Self-improvement for Flyd:\s*/i, "");
  const first = text.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "");
  return first.length > 90 ? `${first.slice(0, 89)}…` : first;
}

/** The review, one line per point: what George weighs before /land. */
export function reviewLines(task: CrewTask): string[] {
  return (task.review ?? []).map((check) => `${check.met ? "✓" : "✗"} ${check.criterion}: ${check.note}`);
}

export function describeTask(task: CrewTask): string {
  const verification = task.verification?.length ? ` · checks ${task.verification.every((step) => step.ok) ? "pass" : "FAIL"}` : "";
  const review = task.review?.length ? ` · review ${task.review.filter((check) => check.met).length}/${task.review.length}` : "";
  return `[${task.id}] ${task.status}${task.diffStat ? ` · ${task.diffStat}` : ""}${verification}${review} — ${task.outcome.slice(0, 90)}${task.failure ? ` (${task.failure})` : ""}`;
}
