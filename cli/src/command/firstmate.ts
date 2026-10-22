import { execFile, spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { firstmateHome } from "../lib/firstmate-home.js";
import { FLYD_DIR } from "../lib/config.js";
import { codexPathCandidates } from "../runtime/codex-adapter.js";
import { openCodePathCandidates } from "../runtime/opencode-adapter.js";
import { defaultProseJudge, parseDomainResult, proseOutcomeByWords, validateDomainHandoff, type ProseJudge, type ProseOutcome } from "./result.js";
import { commandDir, listDomainRuns, readDomainRun, saveDomainRun } from "./store.js";
import type { DomainMessage, DomainRequest, DomainRun, DomainRunStatus } from "./types.js";

const execFileAsync = promisify(execFile);

export interface FirstmateExecResult {
  stdout: string;
  stderr: string;
}

export type FirstmateExec = (script: string, args: string[], options: {
  env: NodeJS.ProcessEnv;
  input?: string;
  timeout: number;
}) => Promise<FirstmateExecResult>;

async function defaultExec(script: string, args: string[], options: {
  env: NodeJS.ProcessEnv;
  input?: string;
  timeout: number;
}): Promise<FirstmateExecResult> {
  if (options.input === undefined) {
    const result = await execFileAsync(script, args, {
      env: options.env,
      timeout: options.timeout,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  }
  return new Promise((resolve, reject) => {
    const child = execFile(script, args, {
      env: options.env,
      timeout: options.timeout,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (error) {
        const enriched = new Error(stderr.trim() || error.message) as Error & { stdout?: string };
        enriched.stdout = stdout;
        reject(enriched);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.end(options.input);
  });
}

export interface FirstmateReadiness {
  available: boolean;
  canReceive: boolean | "unknown";
  liveHarness?: boolean;
  reason?: string;
}

export class FirstmateDomainTransport {
  readonly home: string;
  readonly script: string;

  constructor(options: { home?: string; script?: string; exec?: FirstmateExec } = {}) {
    this.home = options.home ?? firstmateHome();
    this.script = options.script ?? join(this.home, "bin", "fm-inbox.sh");
    this.exec = options.exec ?? defaultExec;
  }

  private readonly exec: FirstmateExec;

  available(): boolean {
    return existsSync(this.script) || this.exec !== defaultExec;
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, FM_HOME: this.home };
  }

  async ready(): Promise<FirstmateReadiness> {
    if (!this.available()) return { available: false, canReceive: false, reason: "FirstMate inbox is not installed" };
    try {
      const { stdout } = await this.exec(this.script, ["ready"], { env: this.env(), timeout: 5_000 });
      const parsed = JSON.parse(stdout) as { can_receive?: boolean | "unknown"; lock?: { live_harness?: boolean }; wake_consumer?: { reason?: string } };
      return {
        available: true,
        canReceive: parsed.can_receive === true ? true : parsed.can_receive === false ? false : "unknown",
        liveHarness: parsed.lock?.live_harness === true,
        ...(parsed.wake_consumer?.reason ? { reason: parsed.wake_consumer.reason } : {}),
      };
    } catch (error) {
      return { available: true, canReceive: "unknown", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async submit(request: DomainRequest, owner = "FirstMate"): Promise<DomainRun> {
    if (request.domain !== "coding") throw new Error("FirstMate currently owns only the coding domain");
    const readiness = await this.ready();
    if (!readiness.available) throw new Error(readiness.reason ?? "FirstMate is unavailable");
    const body = firstmateRequestBody(request);
    let stdout = "";
    try {
      ({ stdout } = await this.exec(this.script, ["note", "--request-id", request.id, "--json", "-"], {
        env: this.env(),
        input: body,
        timeout: 20_000,
      }));
    } catch (error) {
      // A saved request may return a non-zero exit when only the wake failed.
      stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
      if (!stdout.trim()) throw error;
    }
    const receipt = JSON.parse(stdout) as {
      id?: string;
      saved?: boolean;
      acknowledged?: boolean;
      outcome?: string;
    };
    if (!receipt.id || receipt.saved !== true) throw new Error("FirstMate did not durably accept the request");

    const now = new Date().toISOString();
    const run: DomainRun = {
      id: request.id,
      request,
      owner,
      status: receipt.acknowledged ? "accepted" : "queued",
      createdAt: request.createdAt,
      updatedAt: now,
      transport: { kind: "firstmate", requestId: request.id, externalId: receipt.id },
    };
    saveDomainRun(run);
    if (!receipt.acknowledged) {
      const session = await this.startSession(readiness, (failure) => suspendFirstmateRun(run, failure));
      if (session.failure) return suspendFirstmateRun(run, session.failure);
    }
    return run;
  }

  async sendMessage(run: DomainRun, message: DomainMessage): Promise<{ externalId: string }> {
    if (!this.available()) throw new Error("FirstMate inbox is not installed");
    const body = [
      `FLYD ${message.kind.toUpperCase()} FOR ACTIVE DOMAIN RUN ${run.id}`,
      message.from === "flyd"
        ? "This is Flyd's own note, not George's wording. Flyd speaks with George's delegated authority under his standing rules: act on its routine calls (commit, sync, push or merge of green work, the obvious follow-up build, wording and formatting) as his word. Anything destructive or irreversible, costly, security-sensitive, going live, or a genuine taste or strategy call still needs George's own word."
        : "This is George's wording. Treat it as new authority for the active coding outcome and route it to the work that needs it. Do not paraphrase away constraints.",
      "",
      message.body,
      "",
      `Original outcome: ${run.request.intendedOutcome}`,
      "",
      "Reply to this note (fm-inbox.sh reply) with the run's new state under the original request's return contract: status (completed|needs_decision|failed), brief, and the rest. Flyd reads the newest reply as the run's outcome.",
    ].join("\n");
    let stdout = "";
    try {
      ({ stdout } = await this.exec(this.script, ["note", "--request-id", message.id, "--json", "-"], {
        env: this.env(), input: body, timeout: 20_000,
      }));
    } catch (error) {
      stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
      if (!stdout.trim()) throw error;
    }
    const receipt = JSON.parse(stdout) as { id?: string; saved?: boolean };
    if (!receipt.id || receipt.saved !== true) throw new Error("FirstMate did not durably accept the domain message");
    return { externalId: receipt.id };
  }

  async receipts(): Promise<FirstmateReceipts> {
    const { stdout } = await this.exec(this.script, ["receipts", "--all-pending", "--all-handled", "--all-replies"], {
      env: this.env(),
      timeout: 10_000,
    });
    return JSON.parse(stdout) as FirstmateReceipts;
  }

  startSession(readiness?: FirstmateReadiness, onFailure?: (failure: string) => void): Promise<{ started: boolean; failure?: string }> {
    return startFirstmateSession({ home: this.home, script: this.script, exec: this.exec, readiness, onFailure });
  }
}

type SessionRuntime = "claude" | "codex" | "opencode";

const SESSION_PROMPT = "Run bin/fm-session-start.sh exactly once in this home. Then handle the unread inbox notes, verify the requested work, and publish each stable outcome or genuine decision with bin/fm-inbox.sh reply. Do not send messages to George; Flyd relays replies.";
const SESSION_LAUNCH_FAILURE = "I couldn't start the work right now. I'll keep it safe and try again when I can.";
const LAUNCH_RETRY_BASE_MS = 2 * 60_000;
const LAUNCH_RETRY_MAX_MS = 30 * 60_000;
const SESSION_OUTPUT_LIMIT = 8 * 1024;
const LAUNCH_COOLDOWN_MS = 5 * 60_000;
const UNREAD_TOO_LONG_MS = 3 * 60_000;
const SESSION_IDLE_MS = 15 * 60_000;
const launchingHomes = new Set<string>();
const launchCooldownUntil = new Map<string, number>();
const unreadSignals = new Set<string>();
const HELPER_START_TOLERANCE_MS = 5_000;

/** A helper session Flyd launched, kept in `<command dir>/firstmate-helpers.json` so a restarted Core or another Flyd process can still recognise it; its output goes to `log`, whose last write is its last sign of work. */
interface FirstmateHelper {
  pid: number;
  startedAt: string;
  home: string;
  log: string;
}

function helpersPath(): string {
  return join(commandDir(), "firstmate-helpers.json");
}

function readHelpers(): FirstmateHelper[] {
  try {
    const parsed = JSON.parse(readFileSync(helpersPath(), "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is FirstmateHelper => Number.isInteger(item?.pid) && typeof item?.startedAt === "string" && typeof item?.home === "string" && typeof item?.log === "string") : [];
  } catch {
    return [];
  }
}

function writeHelpers(helpers: FirstmateHelper[]): void {
  try {
    const path = helpersPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(helpers, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } catch {
    return;
  }
}

function forgetHelpers(gone: (helper: FirstmateHelper) => boolean): void {
  const helpers = readHelpers();
  const kept = helpers.filter((helper) => !gone(helper));
  if (kept.length === helpers.length) return;
  writeHelpers(kept);
  for (const helper of helpers) if (!kept.includes(helper)) removeLog(helper.log);
}

function removeLog(log: string): void {
  try {
    unlinkSync(log);
  } catch {
    return;
  }
}

/** When the process now holding `pid` started, from `ps`; null when there is no such process. */
async function processStartedAt(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000, env: { ...process.env, LC_ALL: "C" } });
    const started = Date.parse(String(stdout).trim());
    return Number.isFinite(started) ? started : null;
  } catch {
    return null;
  }
}

/** Line 1 of firstmate's state/.lock is the pid of the session holding the fleet lock. */
function lockHolderPid(home: string): number | null {
  try {
    const pid = Number(readFileSync(join(home, "state", ".lock"), "utf8").split("\n")[0]?.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Recorded helpers whose very process is still running; a record whose process ended, or whose pid now belongs to another process, is dropped with its log. */
async function liveHelpers(): Promise<FirstmateHelper[]> {
  const helpers = readHelpers();
  const ended = new Set<FirstmateHelper>();
  for (const helper of helpers) {
    const started = await processStartedAt(helper.pid);
    if (started === null || Math.abs(started - Date.parse(helper.startedAt)) > HELPER_START_TOLERANCE_MS) ended.add(helper);
  }
  if (ended.size) forgetHelpers((helper) => [...ended].some((item) => item.pid === helper.pid && item.startedAt === helper.startedAt && item.home === helper.home));
  return helpers.filter((helper) => !ended.has(helper));
}

/** Flyd's own helper, the very process it launched, when it still holds the lock but has written nothing for too long; a helper Flyd did not launch is never one. */
function idleHelper(helpers: FirstmateHelper[], home: string, nowMs: number): FirstmateHelper | undefined {
  const holder = lockHolderPid(home);
  const helper = holder === null ? undefined : helpers.find((item) => item.home === home && item.pid === holder);
  if (!helper) return undefined;
  let lastWrite: number;
  try {
    lastWrite = statSync(helper.log).mtimeMs;
  } catch {
    return undefined;
  }
  return nowMs - lastWrite > SESSION_IDLE_MS ? helper : undefined;
}

function sessionRuntimes(env = process.env): SessionRuntime[] {
  const configured = env.FLYD_FIRSTMATE_RUNTIMES?.split(",").map((item) => item.trim()).filter(Boolean);
  const values = configured?.length ? configured : ["claude", "codex", "opencode"];
  return values.filter((value): value is SessionRuntime => value === "claude" || value === "codex" || value === "opencode");
}

function sessionExecutable(runtime: SessionRuntime): string {
  const candidates = runtime === "codex" ? codexPathCandidates()
    : runtime === "opencode" ? openCodePathCandidates()
    : [];
  return candidates.find((candidate) => existsSync(candidate)) ?? runtime;
}

function sessionArgs(runtime: SessionRuntime): string[] {
  // Nobody is there to approve a prompt: without a mode, every firstmate script is refused and his notes go unanswered.
  // "auto" runs routine commands and still blocks risky ones, as codex's --full-auto does. George chose this on 2026-10-18.
  if (runtime === "claude") return ["-p", "--permission-mode", "auto", "--output-format", "stream-json", "--verbose", SESSION_PROMPT];
  if (runtime === "codex") return ["exec", "--full-auto", SESSION_PROMPT];
  return ["run", SESSION_PROMPT];
}

const PAID_API_ENV_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"];
function sessionChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  for (const name of PAID_API_ENV_VARS) delete childEnv[name];
  return childEnv;
}

/** Appends one JSONL line to `~/.flyd/self-review/firstmate-session.jsonl` (`FLYD_SELF_REVIEW_DIR` overrides the directory): a launch attempt `{ at, runtime, outcome: "started" | "usage_limited" | "failed", detail? }` or a note left unread too long `{ at, kind: "unread_note", home, notes }`. The council self-review reads the non-"started" lines in cli/src/council/reply-review.ts. */
function recordSessionAttempt(entry: Record<string, unknown>): void {
  try {
    const path = join(process.env.FLYD_SELF_REVIEW_DIR?.trim() || join(FLYD_DIR, "self-review"), "firstmate-session.jsonl");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    return;
  }
}

export async function startFirstmateSession(options: {
  home: string;
  script: string;
  exec: FirstmateExec;
  readiness?: FirstmateReadiness;
  env?: NodeJS.ProcessEnv;
  recordAttempt?: (entry: Record<string, unknown>) => void;
  onFailure?: (failure: string) => void;
}): Promise<{ started: boolean; failure?: string }> {
  const record = options.recordAttempt ?? recordSessionAttempt;
  const ready = options.readiness ?? await (async () => {
    const { stdout } = await options.exec(options.script, ["ready"], { env: { ...process.env, FM_HOME: options.home }, timeout: 5_000 });
    const parsed = JSON.parse(stdout) as { can_receive?: boolean; lock?: { live_harness?: boolean } };
    return { available: true, canReceive: parsed.can_receive === true, liveHarness: parsed.lock?.live_harness === true };
  })().catch(() => ({ available: true, canReceive: "unknown" as const }));
  if (ready.canReceive !== false || ready.liveHarness) return { started: false };
  const runtimes = sessionRuntimes(options.env);
  if (options.exec === defaultExec) {
    if (launchingHomes.has(options.home)) return { started: false };
    launchingHomes.add(options.home);
    return launchDetachedFirstmateSession(options.home, runtimes, record, options.onFailure, () => launchingHomes.delete(options.home));
  }
  for (const runtime of runtimes) {
    try {
      const result = await options.exec(runtime, sessionArgs(runtime), { env: sessionChildEnv({ ...process.env, ...options.env }), timeout: 30_000 });
      const output = `${result.stdout}\n${result.stderr}`;
      if (/usage limit|rate limit|quota exceeded|overloaded/i.test(output)) {
        record({ runtime, outcome: "usage_limited", detail: output.slice(-500) });
        continue;
      }
      record({ runtime, outcome: "started" });
      return { started: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      record({ runtime, outcome: /usage limit|rate limit|quota/i.test(detail) ? "usage_limited" : "failed", detail: detail.slice(0, 500) });
    }
  }
  return { started: false, failure: SESSION_LAUNCH_FAILURE };
}

function launchDetachedFirstmateSession(home: string, runtimes: SessionRuntime[], record: (entry: Record<string, unknown>) => void, onFailure: ((failure: string) => void) | undefined, release: () => void): Promise<{ started: boolean; failure?: string }> {
  return new Promise((resolve) => {
    let handedOff = false;
    const attempt = (index: number): void => {
      const runtime = runtimes[index];
      if (!runtime) {
        release();
        if (handedOff) onFailure?.(SESSION_LAUNCH_FAILURE);
        else resolve({ started: false, failure: SESSION_LAUNCH_FAILURE });
        return;
      }
      let settled = false;
      const log = join(commandDir(), "firstmate-helpers", `${process.pid}-${Date.now()}-${runtime}.log`);
      let child: ReturnType<typeof spawn>;
      try {
        mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
        const fd = openSync(log, "a", 0o600);
        try {
          child = spawn(sessionExecutable(runtime), sessionArgs(runtime), { cwd: home, env: sessionChildEnv({ ...process.env, FM_HOME: home }), detached: true, stdio: ["ignore", fd, fd] });
        } finally {
          closeSync(fd);
        }
      } catch (error) {
        record({ runtime, outcome: "failed", detail: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
        attempt(index + 1);
        return;
      }
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        removeLog(log);
        record({ runtime, outcome: "failed", detail: error.message.slice(0, 500) });
        attempt(index + 1);
      });
      child.once("spawn", () => {
        handedOff = true;
        if (child.pid) {
          forgetHelpers((helper) => helper.home === home);
          writeHelpers([...readHelpers(), { pid: child.pid, startedAt: new Date().toISOString(), home, log }]);
        }
        child.unref();
        record({ runtime, outcome: "started" });
        resolve({ started: true });
      });
      child.once("close", (code) => {
        const output = existsSync(log) ? readFileSync(log, "utf8").slice(-SESSION_OUTPUT_LIMIT) : "";
        if (child.pid) forgetHelpers((helper) => helper.home === home && helper.pid === child.pid);
        removeLog(log);
        const limited = /usage limit|rate limit|quota exceeded|overloaded/i.test(output);
        if (limited || code !== 0) {
          record({ runtime, outcome: limited ? "usage_limited" : "failed", detail: output.slice(-500) });
          if (!settled) {
            settled = true;
            attempt(index + 1);
          }
        } else {
          release();
        }
      });
    };
    attempt(0);
  });
}

function suspendFirstmateRun(run: DomainRun, failure = SESSION_LAUNCH_FAILURE, nowMs = Date.now()): DomainRun {
  const current = readDomainRun(run.id) ?? run;
  if (["completed", "failed", "cancelled"].includes(current.status)) return current;
  const attempts = (current.launchRetry?.attempts ?? 0) + 1;
  const delay = Math.min(LAUNCH_RETRY_BASE_MS * 2 ** (attempts - 1), LAUNCH_RETRY_MAX_MS);
  const suspended: DomainRun = {
    ...current,
    failure,
    launchRetry: { attempts, nextAt: new Date(nowMs + delay).toISOString() },
    updatedAt: new Date(nowMs).toISOString(),
  };
  saveDomainRun(suspended);
  return suspended;
}

interface FirstmateReply {
  id: string;
  at?: string;
  body?: string;
  cursor?: string;
}

interface FirstmateNote {
  id: string;
  at?: string;
  request_id?: string | null;
  acknowledged?: boolean;
  reply?: FirstmateReply | null;
}

export interface FirstmateReceipts {
  pending?: FirstmateNote[];
  handled?: FirstmateNote[];
  replies?: FirstmateReply[];
  reply_cursor?: string;
}

export function firstmateRequestBody(request: DomainRequest): string {
  const project = request.project?.root
    ? `\nFlyd project hint: ${request.project?.name ? `${request.project.name} — ` : ""}${request.project.root}. Resolve the canonical FirstMate project yourself; this is context, not permission or a binding.`
    : "";
  return [
    "FLYD DOMAIN REQUEST",
    "Flyd is mediating this coding request for George. Own the coding outcome as the domain boss: route it to the right project/workers, supervise it, verify it, and escalate only real decisions.",
    "",
    "ORIGINAL REQUEST — preserve this wording as authority:",
    request.originalMessage,
    "",
    "FLYD INTERPRETATION:",
    request.intendedOutcome,
    ...(request.skill ? [`USE SKILL: ${request.skill.name}`, "Follow this skill's process for this request:", request.skill.body] : []),
    request.parentRequestId ? `Follow-up to prior Flyd domain run: ${request.parentRequestId}` : "",
    request.contextRefs?.length ? `Context refs: ${request.contextRefs.join(", ")}` : "",
    project,
    "",
    "DONE WHEN:",
    ...request.doneWhen.map((point, index) => `${index + 1}. ${point}`),
    "",
    "RETURN CONTRACT:",
    "When this request reaches a stable outcome or needs a real decision, publish a durable reply to this inbox note using fm-inbox.sh reply.",
    "Flyd decides routine calls with George's delegated authority: merging finished, reviewed, green work, syncing or pushing it, the obvious follow-up build, wording and formatting. Do those and report completed; do not hand them back as questions.",
    "If implementation is verified but a step that needs George's own word remains (publication, deployment or going live, anything destructive, irreversible, costly or security-sensitive, or a genuine taste or strategy call), return status=needs_decision rather than completed.",
    "Return JSON when practical with: status (completed|needs_decision|failed), brief, recommendation {action,reasoning,confidence}, detailed_report, decisions_made, unresolved_questions, risks, evidence, artifacts, specialist_outputs, information_loss_risk.",
    "The detailed_report should retain material technical detail. Do not collapse specialist findings into only a short summary. Evidence/artifact pointers should survive so Flyd can inspect or ask follow-ups.",
  ].filter(Boolean).join("\n");
}

/** fm-inbox.sh reply cursors are zero-padded counters; a reply without one sorts first. */
function cursorOrder(cursor: string | undefined): number {
  const value = Number(cursor);
  return Number.isFinite(value) ? value : -1;
}

/** A run left "incomplete" before prose replies counted is announced when read again only if it is this recent. */
const LEGACY_ANNOUNCE_WITHIN_MS = 24 * 60 * 60_000;

async function proseOutcome(body: string, run: DomainRun, judge?: ProseJudge): Promise<ProseOutcome> {
  return (await judge?.(body, run.request.intendedOutcome).catch(() => null)) ?? proseOutcomeByWords(body);
}

/** Flyd's note to the staff when a reply could not be read as an outcome: it asks for one line it can always read. */
const UNREAD_REPLY_CHECK_IN = 'Flyd could not tell from your last reply how this work ended. Reply with one JSON line: {"status": "completed|needs_decision|failed|working", "brief": "what changed, your recommendation, why it failed, or what is next"}';

/** One open check-in per run, delivered through the same transport the run uses; the run as saved after it. */
async function askForAClearStatus(run: DomainRun, cursor: string | undefined, transport: FirstmateDomainTransport, now: Date): Promise<DomainRun> {
  const { sendRunMessage } = await import("./messages.js");
  const sent = await sendRunMessage({
    run,
    kind: "question",
    body: cursor ? `${UNREAD_REPLY_CHECK_IN} (reply ${cursor})` : UNREAD_REPLY_CHECK_IN,
    from: "flyd",
    transport,
  }).catch(() => ({ delivered: false, run: undefined }));
  if (!sent.delivered || !sent.run) return sent.run ?? run;
  const asked: DomainRun = { ...sent.run, statusAskedAt: now.toISOString() };
  saveDomainRun(asked);
  return asked;
}

export async function syncFirstmateDomainRuns(options: {
  transport?: FirstmateDomainTransport;
  now?: () => Date;
  onChanged?: (run: DomainRun) => Promise<void> | void;
  /** Reads a prose reply's outcome; without one Flyd's model reads it, and only words when no model can run. */
  judge?: ProseJudge;
} = {}): Promise<DomainRun[]> {
  const transport = options.transport ?? new FirstmateDomainTransport();
  if (!transport.available()) return [];
  const helpers = await liveHelpers();
  const runs = listDomainRuns().filter((run) => run.transport.kind === "firstmate" && !["completed", "failed", "cancelled"].includes(run.status));
  if (!runs.length) return [];
  const judge = options.judge ?? await defaultProseJudge();

  let receipts: FirstmateReceipts;
  try {
    receipts = await transport.receipts();
  } catch {
    return [];
  }
  const nowMs = (options.now ?? (() => new Date()))().getTime();
  const oldPending = (receipts.pending ?? []).filter((note) => note.at && nowMs - Date.parse(note.at) > UNREAD_TOO_LONG_MS);
  if (oldPending.length) {
    const newlyUnread = oldPending.filter((note) => !unreadSignals.has(`${transport.home}:${note.id}`));
    for (const note of newlyUnread) unreadSignals.add(`${transport.home}:${note.id}`);
    if (newlyUnread.length) recordSessionAttempt({ kind: "unread_note", home: transport.home, notes: newlyUnread.map((note) => note.id) });
  } else {
    for (const key of unreadSignals) if (key.startsWith(`${transport.home}:`)) unreadSignals.delete(key);
  }
  const oldUnread = oldPending.length > 0;
  if (oldUnread) {
    const readiness = await transport.ready();
    const idle = readiness.liveHarness ? idleHelper(helpers, transport.home, nowMs) : undefined;
    if (idle) {
      forgetHelpers((helper) => helper.home === idle.home && helper.pid === idle.pid);
      try {
        process.kill(idle.pid, "SIGTERM");
      } catch {
        return [];
      }
      return [];
    }
    if (readiness.canReceive === false && !readiness.liveHarness) {
      const pending = receipts.pending ?? [];
      const waitingRun = runs.find((run) => pending.some((note) => note.id === run.transport.externalId || note.request_id === run.transport.requestId));
      const due = !waitingRun?.launchRetry || Date.parse(waitingRun.launchRetry.nextAt) <= nowMs;
      const cooling = (launchCooldownUntil.get(transport.home) ?? 0) > nowMs;
      if (due && !cooling) {
        launchCooldownUntil.set(transport.home, nowMs + LAUNCH_COOLDOWN_MS);
        const session = await transport.startSession(readiness, waitingRun ? (failure) => suspendFirstmateRun(waitingRun, failure) : undefined).catch(() => ({ started: false, failure: undefined }));
        if (session.started && waitingRun?.launchRetry) {
          saveDomainRun({ ...waitingRun, failure: undefined, updatedAt: new Date(nowMs).toISOString() });
        } else if (session.failure && waitingRun) {
          suspendFirstmateRun(waitingRun, session.failure);
        }
      }
    }
  }
  const notes = [...(receipts.pending ?? []), ...(receipts.handled ?? [])];
  const changed: DomainRun[] = [];
  for (const run of runs) {
    // fm-inbox.sh takes one reply per note, so FirstMate answers each of
    // George's later decisions or corrections on that message's own note.
    const noteIds = new Set([run.transport.externalId, ...(run.messages ?? []).map((message) => message.externalId)].filter(Boolean));
    const requestIds = new Set([run.transport.requestId, ...(run.messages ?? []).map((message) => message.id)]);
    const own = notes.filter((item) => noteIds.has(item.id) || (item.request_id ? requestIds.has(item.request_id) : false));
    if (!own.length) continue;
    const original = own.find((item) => item.request_id === run.transport.requestId || item.id === run.transport.externalId);
    let next: DomainRun = run;
    if (original?.acknowledged && run.status === "queued") {
      next = { ...next, status: "accepted", updatedAt: (options.now ?? (() => new Date()))().toISOString() };
    }
    // The newest reply is the run's current state; one already taken is never taken again.
    const reply = own
      .map((item) => item.reply)
      .filter((item): item is FirstmateReply => Boolean(item?.body?.trim()))
      .sort((a, b) => cursorOrder(a.cursor) - cursorOrder(b.cursor))
      .at(-1);
    // A reply Flyd cannot read as done, failed or a decision leaves the run open.
    let statusUnclear = false;
    let unclearFrom: string | undefined;
    if (reply && (!reply.cursor || !run.transport.replyCursor || cursorOrder(reply.cursor) > cursorOrder(run.transport.replyCursor))) {
      const parsed = parseDomainResult(reply.body!);
      // The staff often answers in prose: its words are the outcome. The layered
      // contract is still asked for, and a reply that misses it is kept whole
      // with the gap noted, never turned from finished work into "incomplete".
      const handoff = validateDomainHandoff(parsed.result);
      // Only a structured reply's own status or Flyd's model may settle a run;
      // prose words no model could read stay "unclear" rather than being guessed.
      const outcome: ProseOutcome = parsed.status ?? (parsed.result.format === "raw" ? await proseOutcome(reply.body!, run, judge) : "completed");
      const status: DomainRunStatus = outcome === "unclear" ? "working" : outcome;
      const { notified, failure, incompleteReason: _previous, launchRetry: _retry, statusAskedAt, ...rest } = next;
      const news = status !== run.status || JSON.stringify(parsed.result) !== JSON.stringify(run.result);
      next = {
        ...rest,
        status,
        result: parsed.result,
        updatedAt: reply.at ?? (options.now ?? (() => new Date()))().toISOString(),
        transport: { ...next.transport, replyCursor: reply.cursor },
        // A new outcome is announced again; the same one is not.
        ...(notified !== undefined && !news ? { notified } : {}),
        ...(status === "failed" ? { failure: parsed.result.brief } : failure !== undefined && !news ? { failure } : {}),
        ...(!handoff.ok ? { incompleteReason: handoff.reason } : {}),
        ...(statusAskedAt && outcome === "unclear" ? { statusAskedAt } : {}),
      };
      if (outcome === "unclear") {
        statusUnclear = true;
        unclearFrom = reply.cursor;
      }
    } else if (run.status === "incomplete" && run.result) {
      // Recorded before prose counted as an outcome: read again what it said.
      // One older than a day is history, kept but not announced now.
      const outcome: ProseOutcome = run.result.format === "raw"
        ? await proseOutcome(run.result.raw.at(-1) ?? run.result.detailedReport, run, judge)
        : "completed";
      const status: DomainRunStatus = outcome === "unclear" ? "working" : outcome;
      const stale = nowMs - Date.parse(run.updatedAt) > LEGACY_ANNOUNCE_WITHIN_MS;
      next = { ...next, status, ...(stale && status === "completed" ? { notified: true } : {}), ...(status === "failed" ? { failure: run.result.brief } : {}) };
      statusUnclear = outcome === "unclear";
    } else if (run.status === "working" && run.result?.format === "raw") {
      // A reply taken before its "status: …" lines could be read: read it again.
      const parsed = parseDomainResult(run.result.raw.at(-1) ?? run.result.detailedReport);
      if (parsed.status && parsed.status !== "working") {
        const handoff = validateDomainHandoff(parsed.result);
        const { incompleteReason: _previous, statusAskedAt: _asked, ...rest } = next;
        const stale = nowMs - Date.parse(run.updatedAt) > LEGACY_ANNOUNCE_WITHIN_MS;
        next = {
          ...rest,
          status: parsed.status,
          result: parsed.result,
          ...(stale && parsed.status === "completed" ? { notified: true } : {}),
          ...(parsed.status === "failed" ? { failure: parsed.result.brief } : {}),
          ...(!handoff.ok ? { incompleteReason: handoff.reason } : {}),
        };
      }
    }
    if (JSON.stringify(next) === JSON.stringify(run)) continue;
    saveDomainRun(next);
    if (statusUnclear && !next.statusAskedAt) next = await askForAClearStatus(next, unclearFrom, transport, (options.now ?? (() => new Date()))());
    changed.push(next);
    await options.onChanged?.(next);
  }
  return changed;
}
