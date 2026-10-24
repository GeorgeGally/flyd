import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { FLYD_DIR } from "../lib/config.js";
import type { GeorgeKind } from "../lib/reaches-george.js";
import { claudeApiKey, claudeHeaders, recordClaudeUsage } from "../lib/claude-spend.js";
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
  verification?: Array<{ command: string; ok: boolean; tail: string; preExisting?: boolean }>;
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
  /** Steps beyond the crew that George approved at dispatch, run when he lands it. */
  afterLand?: AfterLandStep[];
  afterLandResults?: Array<{ step: AfterLandStep; ok: boolean; detail: string }>;
  /** The OpenCode model the crewmate ran on ("provider/model"); unset means OpenCode's own default. */
  model?: string;
  /** How far into the log Claude spend has been counted. */
  spendOffset?: number;
  /** Set once a failed or discarded task's worktree is gone from disk (its branch is kept while it holds commits). */
  worktreeRemoved?: boolean;
}

/**
 * What the crew itself does and doesn't do. Flyd reads this before it
 * promises anything: work beyond it is approved by George at dispatch
 * (after_land) and carried out when he lands the task, never on its own.
 */
export const CREW_CAN = "build the change on its own branch, install dependencies, run the repo's tests, and commit";
export const CREW_CANNOT = "push, deploy, publish, merge into his branch, or touch anything outside its worktree";
export const AFTER_LAND_STEPS = ["push", "deploy"] as const;
export type AfterLandStep = (typeof AFTER_LAND_STEPS)[number];

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

export function crewBrief(outcome: string, verification: string[], branch: string, doneWhen: string[] = [], taste: string | null = null): string {
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
    ...(taste ? [taste, ""] : []),
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
  afterLand?: AfterLandStep[];
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
    ...(crewModel() ? { model: crewModel() } : {}),
    ...(doneWhen.length ? { doneWhen } : {}),
    ...(options.afterLand?.length ? { afterLand: options.afterLand } : {}),
  };
  // George's taste for this repo's project: what he has corrected before.
  const { resolveTasteProject, tastePromptText } = await import("../council/taste.js");
  const tasteProject = resolveTasteProject(repo);
  const brief = crewBrief(outcome, verification, branch, doneWhen, (() => { try { return tastePromptText({ projects: tasteProject ? [tasteProject] : [] }); } catch { return null; } })());
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
  const args = ["run", "--format", "json", "--title", `flyd:${task.id}`, "--auto"];
  const model = task.model ?? crewModel();
  if (model) args.push("--model", model);
  args.push(brief);
  // OpenCode's Anthropic provider reads ANTHROPIC_API_KEY; only this child gets Flyd's key under that name.
  const claudeKey = model?.startsWith("anthropic/") ? claudeApiKey() : undefined;
  const child = spawn(openCodePath(), args, {
    cwd: task.worktree,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, ...(claudeKey ? { ANTHROPIC_API_KEY: claudeKey } : {}), OPENCODE_CONFIG_CONTENT: JSON.stringify(crewOpenCodeConfig(Boolean(claudeKey))) },
  });
  child.unref();
  closeSync(out);
  return child.pid;
}

/** The crew's OpenCode config; on Flyd's Claude key it also names the key's workspace. */
export function crewOpenCodeConfig(claude: boolean): Record<string, unknown> {
  const headers = claude ? claudeHeaders() : {};
  return Object.keys(headers).length
    ? { ...CREW_OPENCODE_CONFIG, provider: { anthropic: { options: { headers } } } }
    : CREW_OPENCODE_CONFIG;
}

/** The crewmate's model: FLYD_CREW_MODEL when set, else OpenCode's own default. */
export function crewModel(): string | undefined {
  return process.env.FLYD_CREW_MODEL?.trim() || undefined;
}

/**
 * Count a Claude crewmate's new steps against the monthly spend, from the
 * token usage OpenCode logs on each step. Returns the new log offset.
 */
export function recordCrewSpend(task: CrewTask): number | undefined {
  if (!task.model?.startsWith("anthropic/") || !existsSync(task.log)) return task.spendOffset;
  const log = readFileSync(task.log);
  const start = Math.min(task.spendOffset ?? 0, log.length);
  // Only whole lines: a step still being written is counted next time.
  const end = log.lastIndexOf(0x0a) + 1;
  if (end <= start) return start;
  const model = task.model.slice("anthropic/".length);
  for (const line of log.subarray(start, end).toString("utf8").split("\n")) {
    if (!line.includes("step_finish")) continue;
    try {
      const event = JSON.parse(line) as { type?: string; part?: { tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } } };
      const tokens = event.type === "step_finish" ? event.part?.tokens : undefined;
      if (!tokens) continue;
      recordClaudeUsage(model, {
        input_tokens: tokens.input,
        output_tokens: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
        cache_read_input_tokens: tokens.cache?.read,
        cache_creation_input_tokens: tokens.cache?.write,
      }, "crew");
    } catch { /* not an event */ }
  }
  return end;
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

/** Words a model provider uses when it refuses the work itself: money, limits, keys, capacity. */
const PROVIDER_REFUSAL = /insufficient[_ ]?(?:credits?|balance|funds|quota)|credit balance (?:is )?too low|out of credits|no credits|usage[_ ]limit|rate[_ ]?limit(?:ed)?|too many requests|quota (?:exceeded|exhausted)|exceeded your (?:current )?quota|billing|payment required|\b40[12]\b|invalid[_ ]?(?:api[_ ]?)?key|authentication[_ ]?(?:error|failed)|unauthori[sz]ed|overloaded/i;

/** An error event's own message, wherever OpenCode put it. */
function errorMessage(event: Record<string, unknown>): string {
  const error = (event.error && typeof event.error === "object" ? event.error : event.part && typeof event.part === "object" ? event.part : {}) as Record<string, unknown>;
  const data = (error.data && typeof error.data === "object" ? error.data : {}) as Record<string, unknown>;
  const said = [data.message, error.message, error.name, event.message, typeof event.error === "string" ? event.error : undefined]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return said?.trim() ?? "";
}

/**
 * Why the crewmate's model provider refused the work, from its log: an error event OpenCode
 * wrote, or a provider's own words about credits, limits, keys or capacity on a plain line.
 * The crewmate's own prose is never read as one. Undefined when the log shows none.
 */
export function providerFailure(logPath: string): string | undefined {
  if (!existsSync(logPath)) return undefined;
  let found: string | undefined;
  for (const raw of readFileSync(logPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("{")) {
      let event: Record<string, unknown>;
      try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const type = typeof event.type === "string" ? event.type : "";
      const part = (event.part && typeof event.part === "object" ? event.part : {}) as Record<string, unknown>;
      const isError = /error/i.test(type) || /error/i.test(typeof part.type === "string" ? part.type : "") || (event.error !== undefined && event.error !== null);
      if (!isError) continue;
      const message = errorMessage(event) || type;
      // A session error event is the run itself failing; any other error counts only in a provider's own words.
      if (message && (type === "error" || PROVIDER_REFUSAL.test(message))) found = message;
      continue;
    }
    if (PROVIDER_REFUSAL.test(line)) found = line;
  }
  return found ? found.replace(/\s+/g, " ").slice(0, 200) : undefined;
}

/**
 * Removes a finished task's git worktree, keeping its branch while it holds commits
 * (George may still want them) unless `deleteBranch`. Without `force`, a worktree with
 * uncommitted changes is left where it is. True when the worktree is gone.
 */
export async function cleanupCrewWorktree(task: Pick<CrewTask, "repo" | "worktree" | "branch">, options: { force?: boolean; deleteBranch?: boolean } = {}): Promise<boolean> {
  await git(task.repo, ["worktree", "remove", ...(options.force ? ["--force"] : []), task.worktree]).catch(() => undefined);
  await git(task.repo, ["worktree", "prune"]).catch(() => undefined);
  const gone = !existsSync(task.worktree);
  if (gone && options.deleteBranch) await git(task.repo, ["branch", "-D", task.branch]).catch(() => undefined);
  return gone;
}

export interface SuperviseDependencies {
  now?: () => Date;
  dir?: string;
  notify?: (title: string, message: string, kind?: GeorgeKind) => Promise<void>;
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

/**
 * Checks run under the Node that runs Core. A login shell otherwise finds
 * whatever node sits first on the profile's PATH (an old /usr/local/bin one
 * here), and vitest dies on import before a single test runs.
 */
export function checkCommand(command: string, nodeBin = dirname(process.execPath)): string {
  return `export PATH=${JSON.stringify(nodeBin)}:"$PATH"; ${command}`;
}

const CHECK_TIMEOUT_MS = 15 * 60_000;
const CHECK_OUTPUT_MAX = 16 * 1024 * 1024;

/**
 * Run one check in its own process group. On timeout the whole group goes
 * (bash, npm, vitest and its workers); killing only bash orphaned the test
 * runners, which piled up until every later check timed out.
 */
export function runCheckCommand(command: string, cwd: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-lc", checkCommand(command)], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (chunk: Buffer) => { if (output.length < CHECK_OUTPUT_MAX) output += chunk.toString(); };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    let timedOut = false;
    const killGroup = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch { /* already gone */ } };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve({ ok: false, output: `${output}${error.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      killGroup("SIGKILL"); // stragglers that outlived bash
      resolve({ ok: code === 0 && !timedOut, output: timedOut ? `${output}\ncheck timed out after ${Math.round(timeoutMs / 60_000)} min` : output });
    });
  });
}

const defaultRunCommand = (command: string, cwd: string) => runCheckCommand(command, cwd);

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The failures a check reports, as stable signatures: vitest's FAIL lines and
 * tsc errors without their line/column (an edit above shifts them). An empty
 * set means the output could not be read, never "nothing failed".
 */
export function failureSignatures(output: string): Set<string> {
  const found = new Set<string>();
  for (const raw of output.replace(ANSI, "").split("\n")) {
    const line = raw.trim();
    const failed = /^FAIL\s+(.+?)(?:\s+\[[^\]]*\])?$/.exec(line);
    if (failed) { found.add(`FAIL ${failed[1]}`); continue; }
    const tsc = /^(\S+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line);
    if (tsc) found.add(`${tsc[1]} ${tsc[2]} ${tsc[3]}`);
  }
  return found;
}

/** A baseline worth caching: the runner printed its summary and few tests timed out. */
export function completeBaseline(output: string): boolean {
  const plain = output.replace(ANSI, "");
  if (/check timed out/.test(plain)) return false;
  const finished = /^\s*Test Files\s+/m.test(plain) || /error TS\d+|Found \d+ errors?/.test(plain);
  const timeouts = (plain.match(/Test timed out|Timeout/g) ?? []).length;
  return finished && timeouts < 5;
}

/** True when every failure in `after` was already failing on the base commit. */
export function onlyPreExistingFailures(after: string, base: string): boolean {
  const now = failureSignatures(after);
  if (!now.size) return false;
  const before = failureSignatures(base);
  return [...now].every((signature) => before.has(signature));
}

/**
 * Run a failing check again on the task's unmodified base commit, in the same
 * worktree (its installed dependencies stay), then return to the branch.
 * Cached per base commit and command: the suite is slow and the base never changes.
 */
async function baselineOutput(task: CrewTask, command: string, run: (command: string, cwd: string) => Promise<{ ok: boolean; output: string }>, dir: string): Promise<string | null> {
  const cacheDir = join(dir, "baselines");
  const key = `${task.baseCommit}-${Buffer.from(command).toString("base64url")}`.slice(0, 200);
  const cached = join(cacheDir, `${key}.txt`);
  if (existsSync(cached)) return readFileSync(cached, "utf8");
  // Only tracked changes block the checkout; untracked files (installed or
  // linked dependencies) ride along untouched.
  if ((await git(task.worktree, ["status", "--porcelain", "--untracked-files=no"]).catch(() => "x")).trim()) return null;
  try {
    await git(task.worktree, ["checkout", "--quiet", "--detach", task.baseCommit]);
    const result = await run(command, task.worktree);
    // Keep only a baseline that ran to completion on a calm machine: a run cut
    // off mid-way (a restart) or swamped by timeouts (load) would be compared
    // against forever.
    if (completeBaseline(result.output)) {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cached, result.output);
    }
    return result.output;
  } catch {
    return null;
  } finally {
    await git(task.worktree, ["checkout", "--quiet", task.branch]).catch(() => undefined);
  }
}

/**
 * Re-create a removed worktree from its branch so its checks can run again.
 * Dependencies are linked from the repository rather than reinstalled.
 */
async function restoreWorktree(task: CrewTask): Promise<void> {
  try {
    await git(task.repo, ["worktree", "prune"]);
    await git(task.repo, ["worktree", "add", task.worktree, task.branch]);
    for (const sub of ["", "cli"]) {
      const from = join(task.repo, sub, "node_modules");
      const to = join(task.worktree, sub, "node_modules");
      if (existsSync(from) && existsSync(dirname(to)) && !existsSync(to)) symlinkSync(from, to);
    }
  } catch (error) {
    console.warn("[crew] could not restore worktree:", error instanceof Error ? error.message : error);
  }
}

/** Advance every running crewmate: finished ones are verified and reported; stuck ones are stopped. */
/**
 * One supervise pass at a time, across processes: Core's tick and a launchd
 * `agenda run-due` both supervise, and a pass outlives the 5-minute tick, so
 * overlapping passes ran the same suites side by side. A later caller skips.
 */
export async function superviseCrew(deps: SuperviseDependencies = {}): Promise<CrewTask[]> {
  const dir = deps.dir ?? crewDir();
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "supervise.lock");
  const take = (): boolean => {
    try { writeFileSync(lock, String(process.pid), { flag: "wx" }); return true; } catch { return false; }
  };
  if (!take()) {
    const holder = Number(readFileSync(lock, "utf8").trim());
    if (holder && holder !== process.pid && processAlive(holder)) return [];
    try { rmSync(lock); } catch { /* raced */ }
    if (!take()) return [];
  }
  try {
    return await superviseCrewPass(deps, dir);
  } finally {
    try { rmSync(lock); } catch { /* already gone */ }
  }
}

async function superviseCrewPass(deps: SuperviseDependencies, dir: string): Promise<CrewTask[]> {
  const now = (deps.now ?? (() => new Date()))();
  const alive = deps.alive ?? processAlive;
  const run = deps.runCommand ?? defaultRunCommand;
  const changed: CrewTask[] = [];
  for (const listed of listTasks(dir).filter((item) => item.status === "running")) {
    const spendOffset = recordCrewSpend(listed);
    const task = spendOffset === listed.spendOffset ? listed : { ...listed, spendOffset };
    if (task !== listed) saveTask(task, dir);
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
    // Count the branch's commits from the repository, never from the worktree:
    // a missing worktree must not read as "nothing was committed", or the
    // cleanup below deletes a branch that holds real work.
    let commits = 0;
    let diffStat = "";
    let counted = false;
    try {
      commits = Number(await git(task.repo, ["rev-list", "--count", `${task.baseCommit}..${task.branch}`])) || 0;
      diffStat = await git(task.repo, ["diff", "--shortstat", `${task.baseCommit}..${task.branch}`]);
      counted = true;
    } catch { /* branch gone */ }
    if (commits > 0 && !existsSync(task.worktree)) await restoreWorktree(task);
    const dirty = await git(task.worktree, ["status", "--porcelain"]).catch(() => "");
    const verification: CrewTask["verification"] = [];
    if (commits > 0) {
      for (const command of await verificationCommandsForRepository(task.worktree).catch(() => [])) {
        const result = await run(command, task.worktree);
        const tail = result.output.trim().split("\n").slice(-8).join("\n").slice(-800);
        // A suite that was already red on the base commit must not fail every
        // task: pass the check when the crewmate added no failure of its own.
        if (!result.ok) {
          const base = await baselineOutput(task, command, run, dir);
          if (base !== null && onlyPreExistingFailures(result.output, base)) {
            verification.push({ command, ok: true, preExisting: true, tail });
            continue;
          }
        }
        verification.push({ command, ok: result.ok, tail });
        if (!result.ok) break;
      }
    }
    const verified = commits > 0 && verification.every((step) => step.ok);
    // A crewmate whose provider refused the work (no credits, a usage limit, a bad key) did not fail at the work: say so.
    const refused = verified ? undefined : providerFailure(task.log);
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
          ? refused
            ? `provider error: ${refused}`
            : `no commits${dirty ? " (uncommitted changes left in the worktree)" : ""}`
          : `verification failed: ${verification.find((step) => !step.ok)?.command ?? "unknown"}`,
      }),
    };
    // A failed task's worktree goes; its branch stays while it holds commits, and uncommitted work is never thrown away.
    const cleaned = !verified && await cleanupCrewWorktree(done, { deleteBranch: counted && commits === 0 });
    const recorded: CrewTask = cleaned ? { ...done, worktreeRemoved: true } : done;
    saveTask(recorded, dir);
    changed.push(recorded);
  }
  for (const task of changed.filter((item) => item.status !== "running" && !item.notified && deps.notify)) {
    const judged = (task.review ?? []).filter((check) => !check.unchecked);
    const short = unmetChecks(judged).length ? shortfall(judged) : "";
    const unreviewed = judged.length < (task.review ?? []).length;
    const message = task.status !== "ready"
      ? `${plainOutcome(task)} is blocked: ${blockedBy(task)}. Tell me whether to try another way or drop it.`
      : short
        ? `${plainOutcome(task)} passes its tests but is still short on: ${short}. Your call whether to /land it.`
        : unreviewed
          ? `${plainOutcome(task)} passes its tests, but I couldn't check it against what you asked. Have a look before you /land it.`
          : `${plainOutcome(task)} is done and tested. Say /land to merge it in.`;
    await deps.notify!("Flyd", message, task.status !== "ready" ? "blocker" : "deliverable").catch(() => undefined);
    saveTask({ ...task, notified: true }, dir);
  }
  return changed;
}

/**
 * Land a verified task on the branch it started from. Fast-forward when
 * possible, a merge commit otherwise; refuses a dirty or moved checkout
 * rather than guessing.
 */
export async function landCrewTask(id: string, dir = crewDir(), run: (command: string, cwd: string) => Promise<{ ok: boolean; output: string }> = defaultRunCommand): Promise<CrewTask> {
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
  const afterLandResults = await runAfterLand(task, run);
  const landed: CrewTask = { ...task, status: "landed", finishedAt: new Date().toISOString(), ...(afterLandResults.length ? { afterLandResults } : {}) };
  saveTask(landed, dir);
  return landed;
}

/** The repo's own deploy command, if it declares one. */
export function deployCommand(repo: string): string | null {
  try {
    const scripts = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
    if (scripts.deploy) return "npm run deploy";
  } catch { /* no package.json */ }
  try {
    if (/^deploy\s*:/m.test(readFileSync(join(repo, "Makefile"), "utf8"))) return "make deploy";
  } catch { /* no Makefile */ }
  return null;
}

/** Carry out the steps George approved when he dispatched the task, in order; stop at the first failure. */
async function runAfterLand(task: CrewTask, run: (command: string, cwd: string) => Promise<{ ok: boolean; output: string }>): Promise<NonNullable<CrewTask["afterLandResults"]>> {
  const results: NonNullable<CrewTask["afterLandResults"]> = [];
  for (const step of task.afterLand ?? []) {
    const command = step === "push" ? `git push origin ${task.baseBranch}` : deployCommand(task.repo);
    if (!command) {
      results.push({ step, ok: false, detail: "this repo declares no deploy command (package.json \"deploy\" script or a Makefile deploy target)" });
      break;
    }
    const result = await run(command, task.repo);
    results.push({ step, ok: result.ok, detail: `${command}: ${result.output.trim().split("\n").slice(-3).join(" ").slice(0, 300)}` });
    if (!result.ok) break;
  }
  return results;
}

/** Discard a task's worktree and branch (George's call; the branch is gone after this). */
export async function discardCrewTask(id: string, dir = crewDir()): Promise<CrewTask> {
  const task = readTask(id, dir);
  if (!task) throw new Error(`No crew task ${id}`);
  if (task.status === "running" && processAlive(task.pid)) {
    try { process.kill(-task.pid!, "SIGTERM"); } catch { /* gone */ }
  }
  const removed = await cleanupCrewWorktree(task, { force: true, deleteBranch: true });
  const discarded = { ...task, status: "discarded" as const, ...(removed ? { worktreeRemoved: true } : {}) };
  saveTask(discarded, dir);
  return discarded;
}

/** What stopped a failed task, in plain words; the raw failure stays in the task record. */
export function blockedBy(task: Pick<CrewTask, "failure">): string {
  const failure = task.failure ?? "";
  if (failure.startsWith("no commits")) return /uncommitted/.test(failure) ? "changes were made but never committed" : "nothing was committed";
  if (failure.startsWith("verification failed")) return "its tests failed";
  if (failure.startsWith("stopped after")) return "it ran for two hours without finishing";
  if (failure.startsWith("provider error")) {
    const said = failure.slice("provider error:".length).trim();
    const plain = /credit|balance|funds|billing|payment|\b402\b/i.test(said) ? "the model provider is out of credits"
      : /usage[_ ]limit|rate[_ ]?limit|too many requests|quota/i.test(said) ? "the model provider's usage limit was hit"
        : /key|auth|unauthori[sz]ed|\b401\b/i.test(said) ? "the model provider rejected its key"
          : /overloaded/i.test(said) ? "the model provider was overloaded"
            : "the model provider refused the work";
    return `${plain}, so no work was done`;
  }
  return "it couldn't be finished";
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
  const after = task.afterLandResults?.length
    ? ` · ${task.afterLandResults.map((result) => `${result.step} ${result.ok ? "done" : "FAILED"}`).join(", ")}`
    : task.afterLand?.length ? ` · then ${task.afterLand.join(", ")} on /land` : "";
  return `[${task.id}] ${task.status}${task.diffStat ? ` · ${task.diffStat}` : ""}${verification}${review}${after} — ${task.outcome.slice(0, 90)}${task.failure ? ` (${task.failure})` : ""}`;
}
