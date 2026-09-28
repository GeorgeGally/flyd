import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { processIsAlive } from "./recovery.js";

// Work Flyd takes on while the conversation carries on: generating, drafting,
// researching, building. Each job is an unattended agent turn with a long
// budget; its result comes back into the chat the moment it finishes (and to
// the inbox and a notification), in Flyd's own voice.
//
// A job starts from a contract: what done looks like, stated before any work.
// The builder never grades itself. A separate read-only turn checks the result
// against each done_when and looks for what would make it unacceptable; unmet
// criteria go back to the builder once, and whatever is still unmet is said
// plainly in the result. Job state lives on disk, so a restart can't lose one.

export interface JobContract {
  task: string;
  doneWhen: string[];
  /** A file or folder the job must leave behind, checked on disk. */
  deliverable?: string;
}

export interface JobCheck { criterion: string; met: boolean; note: string }

export type JobStatus = "running" | "verifying" | "ok" | "short" | "failed" | "interrupted";

export interface JobRecord {
  id: string;
  contract: JobContract;
  status: JobStatus;
  pid: number;
  startedAt: string;
  updatedAt: string;
  attempts: number;
  checks: JobCheck[];
  result?: string;
}

export interface JobResult { id: string; task: string; status: "ok" | "failed"; result: string }

export const jobEvents = new EventEmitter();
const running = new Map<string, string>();

/** One repair round after the first check; more is paying to repeat a failure. */
export const MAX_JOB_ATTEMPTS = 2;

export function runningJobs(): string[] {
  return [...running.values()];
}

export function jobsDir(): string {
  return process.env.FLYD_JOBS_DIR?.trim() || join(FLYD_DIR, "jobs");
}

function saveJob(job: JobRecord, dir = jobsDir()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${job.id}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(job, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function listJobs(dir = jobsDir()): JobRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try { return [JSON.parse(readFileSync(join(dir, name), "utf8")) as JobRecord]; } catch { return []; }
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function contractLines(contract: JobContract): string[] {
  return [
    "Done when:",
    ...contract.doneWhen.map((criterion, index) => `${index + 1}. ${criterion}`),
    ...(contract.deliverable ? [`Leave the result at: ${contract.deliverable}`] : []),
  ];
}

export function jobMessage(contract: JobContract): string {
  return [
    `Background job you took on for George: ${contract.task}`,
    ...contractLines(contract),
    "Do it fully now, until every point above holds. Run what needs running (bash accepts timeout_seconds up to 1800 for long steps) and look at what came out.",
    "He isn't watching: anything that needs his approval, describe instead of doing.",
    "Report back in a few plain sentences: what you made, how good it is and why, and where to find it. Only claim what you actually saw.",
  ].join("\n");
}

export function repairMessage(contract: JobContract, report: string, unmet: JobCheck[]): string {
  return [
    `Background job you took on for George: ${contract.task}`,
    ...contractLines(contract),
    `Your last report:\n"""${report}"""`,
    "An independent check found these points not met:",
    ...unmet.map((check) => `- ${check.criterion}: ${check.note}`),
    "Fix what you can now. Then report back in a few plain sentences, as before. If a point can't be met, say so and why.",
  ].join("\n");
}

export function verifyMessage(contract: JobContract, report: string): string {
  return [
    "You are checking work someone else did for George. Your job is to find what would make it unacceptable, not to confirm it looks good.",
    `The job: ${contract.task}`,
    ...contractLines(contract),
    `The worker's report (a claim, not proof):\n"""${report}"""`,
    "Check each point against what is actually on disk or observable with your tools. Don't trust the report; look.",
    "Reply with exactly one line per point, in order, and nothing else:",
    "MET <n>: <what you saw that proves it>",
    "UNMET <n>: <what is missing or wrong>",
  ].join("\n");
}

/** Lines the checker didn't answer count as unmet: silence is not evidence. */
export function parseChecks(contract: JobContract, reply: string): JobCheck[] {
  const verdicts = new Map<number, { met: boolean; note: string }>();
  for (const line of reply.split("\n")) {
    const match = line.trim().match(/^[*_\s-]*(MET|UNMET)\s*(\d+)[*_]*\s*[:.)-]\s*(.*)$/i);
    if (!match) continue;
    const index = Number(match[2]) - 1;
    if (!verdicts.has(index)) verdicts.set(index, { met: match[1].toUpperCase() === "MET", note: match[3].trim() });
  }
  return contract.doneWhen.map((criterion, index) => ({
    criterion,
    ...(verdicts.get(index) ?? { met: false, note: "the check couldn't confirm it" }),
  }));
}

function expandHome(path: string): string {
  return path.startsWith("~") ? `${homedir()}${path.slice(1)}` : path;
}

/** Facts before judgment: a missing deliverable fails without asking a model. */
export function deterministicChecks(contract: JobContract, exists: (path: string) => boolean = existsSync): JobCheck[] {
  if (!contract.deliverable) return [];
  const met = exists(expandHome(contract.deliverable));
  return [{ criterion: `result is at ${contract.deliverable}`, met, note: met ? "it's there" : "nothing there" }];
}

export function jobOutcome(report: string, checks: JobCheck[]): { status: "ok" | "short"; result: string } {
  const unmet = checks.filter((check) => !check.met);
  const body = report.trim() || "(no result)";
  if (!unmet.length) return { status: "ok", result: body };
  const shortfall = unmet.map((check) => `${check.criterion} (${check.note})`).join("; ");
  return { status: "short", result: `${body}\n\nI checked it against what you wanted and it's still short on: ${shortfall}.` };
}

export interface JobDependencies {
  run(message: string, id: string): Promise<string>;
  /** The independent check; returns the checker's raw reply. Omitted, only deterministic checks run. */
  verify?(message: string, id: string): Promise<string>;
  deliver?(result: JobResult): Promise<void>;
  exists?(path: string): boolean;
  dir?: string;
}

/** `repairable` is false when the check itself broke: another build round can't fix that. */
async function checkJob(contract: JobContract, report: string, id: string, deps: JobDependencies): Promise<{ checks: JobCheck[]; repairable: boolean }> {
  const facts = deterministicChecks(contract, deps.exists);
  if (facts.some((check) => !check.met) || !deps.verify) return { checks: facts, repairable: true };
  try {
    return { checks: [...facts, ...parseChecks(contract, await deps.verify(verifyMessage(contract, report), id))], repairable: true };
  } catch {
    const unchecked = contract.doneWhen.map((criterion) => ({ criterion, met: false, note: "I couldn't check this one" }));
    return { checks: [...facts, ...unchecked], repairable: false };
  }
}

async function runJob(job: JobRecord, deps: JobDependencies): Promise<{ status: "ok" | "short"; result: string }> {
  const save = (update: Partial<JobRecord>) => {
    Object.assign(job, update, { updatedAt: new Date().toISOString() });
    saveJob(job, deps.dir);
  };
  let report = await deps.run(jobMessage(job.contract), job.id);
  for (;;) {
    save({ status: "verifying", attempts: job.attempts + 1 });
    const { checks, repairable } = await checkJob(job.contract, report, job.id, deps);
    save({ checks });
    const unmet = checks.filter((check) => !check.met);
    if (!unmet.length || !repairable || job.attempts >= MAX_JOB_ATTEMPTS) return jobOutcome(report, checks);
    save({ status: "running" });
    report = await deps.run(repairMessage(job.contract, report, unmet), job.id);
  }
}

export function normalizeContract(input: { task?: unknown; done_when?: unknown; deliverable?: unknown }): JobContract | string {
  const task = String(input.task ?? "").replace(/\s+/g, " ").trim();
  if (!task) return "background_task needs a task";
  const doneWhen = (Array.isArray(input.done_when) ? input.done_when : [input.done_when])
    .map((item) => String(item ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!doneWhen.length) return "background_task needs done_when: the checkable points that mean the job is done";
  const deliverable = String(input.deliverable ?? "").trim();
  return { task, doneWhen, ...(deliverable ? { deliverable } : {}) };
}

/** Start a job and return at once; the result arrives on jobEvents("done"). */
export const MAX_RUNNING_JOBS = 3;

export function startBackgroundJob(contract: JobContract, deps: JobDependencies): string {
  // A job can start jobs; the cap keeps that from running away.
  if (running.size >= MAX_RUNNING_JOBS) throw new Error(`already running ${running.size} background jobs; finish or wait for one first`);
  const id = randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const job: JobRecord = { id, contract, status: "running", pid: process.pid, startedAt: now, updatedAt: now, attempts: 0, checks: [] };
  saveJob(job, deps.dir);
  running.set(id, contract.task);
  void runJob(job, deps)
    .catch((error: unknown) => ({ status: "failed" as const, result: `Couldn't finish: ${error instanceof Error ? error.message : String(error)}` }))
    .then(async (outcome) => {
      running.delete(id);
      Object.assign(job, { status: outcome.status, result: outcome.result, updatedAt: new Date().toISOString() });
      try { saveJob(job, deps.dir); } catch { /* the result still reaches George */ }
      const done: JobResult = { id, task: contract.task, status: outcome.status === "failed" ? "failed" : "ok", result: outcome.result };
      await deps.deliver?.(done).catch(() => undefined);
      jobEvents.emit("done", done);
    });
  return id;
}

/**
 * Jobs whose process died mid-run (Core or chat restarted) are marked
 * interrupted and reported, never silently lost. They are not re-run: the work
 * may have had effects, so George decides.
 */
export function recoverInterruptedJobs(deps: Pick<JobDependencies, "deliver" | "dir"> & { isAlive?: (pid: number) => boolean } = {}): JobResult[] {
  const isAlive = deps.isAlive ?? processIsAlive;
  const recovered: JobResult[] = [];
  for (const job of listJobs(deps.dir)) {
    if (job.status !== "running" && job.status !== "verifying") continue;
    if (job.pid === process.pid || isAlive(job.pid)) continue;
    const result = "This got cut off when I restarted, before I could finish and check it. Say if you want me to start it again.";
    saveJob({ ...job, status: "interrupted", result, updatedAt: new Date().toISOString() }, deps.dir);
    const done: JobResult = { id: job.id, task: job.contract.task, status: "failed", result };
    void deps.deliver?.(done).catch(() => undefined);
    recovered.push(done);
  }
  return recovered;
}

async function unattendedTurn(message: string, sessionId: string, readOnly: boolean): Promise<string> {
  const [{ respondToConversation }, { retrieveAgentMemory, loadAgentSituation }, { refreshRepoRegistry }] = await Promise.all([
    import("./conversation-responder.js"), import("../commands/code.js"), import("./repo-registry.js"),
  ]);
  const situation = await loadAgentSituation().catch(() => null);
  const crossRepo = await refreshRepoRegistry(situation?.projectRoot).catch(() => []);
  const memory = await retrieveAgentMemory(message).catch(() => ({ verdict: "insufficient" as const, matches: [] }));
  return respondToConversation(
    { sessionId, turnNumber: 1, message, history: [], memory, situation, crossRepo, onToken: () => {} },
    // The checker must not act, and its verdict lines must reach us unrewritten.
    readOnly ? { readOnly: true, rewrite: async () => "" } : {},
  );
}

/** The real builder: an unattended Flyd turn with the job budget. */
export async function runJobTurn(message: string, id: string): Promise<string> {
  return unattendedTurn(message, `job-${id}`, false);
}

/** The real checker: a separate, read-only turn that never saw the builder's reasoning. */
export async function verifyJobTurn(message: string, id: string): Promise<string> {
  return unattendedTurn(message, `job-${id}-check`, true);
}

/** Inbox + notification, so a result is never lost if the chat has closed. */
export async function deliverJob(result: JobResult): Promise<void> {
  const agenda = await import("./agenda.js");
  agenda.recordInbox({ itemId: `job-${result.id}`, task: result.task, status: result.status, result: result.result });
  await agenda.notifyMac("Flyd", `${result.task.slice(0, 60)}: ${result.result.slice(0, 180)}`);
}
