import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { firstmateHome } from "../lib/firstmate-home.js";
import type { FirstmateExec } from "./firstmate.js";
import { sendRunMessage } from "./messages.js";
import { commandDir, listDomainRuns } from "./store.js";
import type { DomainRun } from "./types.js";

// Flyd watches its coding staff (FirstMate) from Core, read-only: the staff's
// own readiness (`fm-inbox.sh ready`), its home summary (state/home-summary.json:
// workers, decisions waiting on George, the queue), each worker's status log,
// and Flyd's own handoffs. Stuck work gets a note to the staff first; George is
// told only when the nudge did not help, or when nobody is there to nudge.
// Nothing here writes into the FirstMate home except notes through its inbox.

/** A handoff with no word back this long gets a note asking where it stands. */
export const STALE_HANDOFF_MS = 2 * 60 * 60_000;
/** A worker waiting on a decision this long gets a note to the staff. */
export const WORKER_WAIT_MS = 30 * 60_000;
/** After a nudge, how long the staff has to answer before George is told. */
export const NUDGE_GRACE_MS = 60 * 60_000;
/** The staff unreachable this long, with work open, is told to George. */
export const UNREACHABLE_MS = 30 * 60_000;
/** How often Core reads the staff's state. */
export const STAFF_CHECK_MS = 60_000;

export interface StaffReadiness {
  lock: "held" | "free" | "unknown";
  pid?: number;
  liveHarness: boolean | "unknown";
  heartbeat: string;
  beaconAgeSeconds?: number;
  canReceive: boolean | "unknown";
}

export interface StaffWorker {
  id: string;
  name: string;
  state: string;
  doing?: string;
  /** When its status log last changed, ISO. */
  since?: string;
}

export interface StaffHandoff {
  id: string;
  outcome: string;
  status: DomainRun["status"];
  /** When Flyd last heard anything new on it, ISO. */
  lastHeard: string;
}

export interface StaffSnapshot {
  at: string;
  available: boolean;
  readiness: StaffReadiness;
  /** The staff's live session (its lock holder's Claude Code session), when known. */
  session?: string;
  workers: StaffWorker[];
  /** Decisions the staff holds for George. */
  waitingOnHim: Array<{ id: string; summary: string; ageDays?: number }>;
  queued: number;
  handoffs: StaffHandoff[];
}

export type StaffConcernKind = "handoff_stale" | "worker_waiting" | "unreachable";

export interface StaffConcern {
  /** Stable while the same thing stays stuck; a fresh stall gets a new key. */
  key: string;
  kind: StaffConcernKind;
  since: string;
  /** George's words: no machinery names. */
  text: string;
  runId?: string;
  workerId?: string;
  /** When Flyd sent the staff a note about it. */
  nudgedAt?: string;
  /** When George was told; until then only Flyd knows. */
  toldAt?: string;
}

export interface StaffView {
  snapshot: StaffSnapshot;
  concerns: StaffConcern[];
}

const DECIDING = new Set(["needs-decision", "needs_decision", "blocked"]);
const OPEN_HANDOFF = new Set(["queued", "accepted", "working"]);

async function defaultExec(script: string, args: string[], options: { env: NodeJS.ProcessEnv; input?: string; timeout: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(script, args, { env: options.env, timeout: options.timeout, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      // A saved note may exit non-zero when only its wake failed; the receipt on stdout still counts.
      if (error && !String(stdout).trim()) reject(error);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function parseReadiness(raw: unknown): StaffReadiness {
  const ready = record(raw);
  const lock = record(ready.lock);
  const consumer = record(ready.wake_consumer);
  const pid = Number(lock.pid);
  const age = Number(consumer.beacon_age_seconds);
  return {
    lock: lock.state === "held" ? "held" : lock.state === "free" || lock.state === "stale" ? "free" : "unknown",
    ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}),
    liveHarness: lock.live_harness === true ? true : lock.live_harness === false ? false : "unknown",
    heartbeat: text(consumer.state) || "unknown",
    ...(consumer.beacon_age_seconds !== undefined && Number.isFinite(age) ? { beaconAgeSeconds: age } : {}),
    canReceive: ready.can_receive === true ? true : ready.can_receive === false ? false : "unknown",
  };
}

/** A status line's own `[at=<epoch>]` stamp, else none. */
function stampOf(line: string): string | undefined {
  const epoch = Number(line.match(/\[at=(\d{9,11})\]/)?.[1]);
  return Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : undefined;
}

/** The staff's own word for what a worker is doing, without its machinery ("harness busy", run ids); else none. */
function plainDoing(value: string): string | undefined {
  const doing = value.replace(/\s*·\s*run:\s*\S+/gi, "").trim();
  return doing && !/\b(harness|hook|pane|tmux|herdr)\b/i.test(doing) ? doing : undefined;
}

function workerSince(home: string, id: string): string | undefined {
  if (!/^[\w.-]+$/.test(id) || id.startsWith(".")) return undefined;
  const path = join(home, "state", `${id}.status`);
  try {
    const last = readFileSync(path, "utf8").trim().split("\n").at(-1) ?? "";
    return stampOf(last) ?? statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/** The Claude Code session a process runs, from ~/.claude/sessions/<pid>.json. */
export function sessionOfPid(pid: number, sessionsDir = join(homedir(), ".claude", "sessions")): string | undefined {
  const id = text(record(readJson(join(sessionsDir, `${pid}.json`))).sessionId);
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) ? id : undefined;
}

/** Signature of a run's progress: a nudge changes neither part, a reply or status change does. */
function progressOf(run: DomainRun): string {
  return `${run.status}|${run.transport.replyCursor ?? ""}`;
}

interface MonitorState {
  /** Per run: its progress signature and when Flyd first saw it. */
  heard: Record<string, { progress: string; since: string }>;
  /** Concern key → when the staff was nudged about it. */
  nudged: Record<string, string>;
  /** Concern keys George has been told about. */
  told: Record<string, string>;
  /** When the staff was first seen unreachable in the current outage. */
  unreachableSince?: string;
}

const EMPTY_STATE = (): MonitorState => ({ heard: {}, nudged: {}, told: {} });

function waited(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

function clip(value: string, max = 90): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** What is stuck, in George's words. Pure: the monitor decides what to do about each one. */
export function assessStaff(snapshot: StaffSnapshot, unreachableSince: string | undefined, now: number): StaffConcern[] {
  const concerns: StaffConcern[] = [];
  for (const handoff of snapshot.handoffs) {
    const quiet = now - Date.parse(handoff.lastHeard);
    if (!OPEN_HANDOFF.has(handoff.status) || !(quiet > STALE_HANDOFF_MS)) continue;
    concerns.push({
      key: `handoff:${handoff.id}:${handoff.lastHeard}`,
      kind: "handoff_stale",
      since: handoff.lastHeard,
      runId: handoff.id,
      text: `I've heard nothing back on "${clip(handoff.outcome)}" for ${waited(quiet)}.`,
    });
  }
  for (const worker of snapshot.workers) {
    if (!DECIDING.has(worker.state) || !worker.since) continue;
    const waiting = now - Date.parse(worker.since);
    if (!(waiting > WORKER_WAIT_MS)) continue;
    concerns.push({
      key: `worker:${worker.id}:${worker.since}`,
      kind: "worker_waiting",
      since: worker.since,
      workerId: worker.id,
      text: `"${clip(worker.name)}" has been stuck waiting for ${waited(waiting)}.`,
    });
  }
  const openWork = snapshot.handoffs.some((handoff) => OPEN_HANDOFF.has(handoff.status)) || snapshot.workers.length > 0;
  if (unreachableSince && openWork && now - Date.parse(unreachableSince) > UNREACHABLE_MS) {
    concerns.push({
      key: `unreachable:${unreachableSince}`,
      kind: "unreachable",
      since: unreachableSince,
      text: `Nobody has been looking after your coding work for ${waited(now - Date.parse(unreachableSince))}.`,
    });
  }
  return concerns;
}

/** One line per thing, for chat: what is under way, what is stuck, what waits on George. */
export function describeStaff(view: StaffView, now = Date.now()): string {
  const { snapshot, concerns } = view;
  if (!snapshot.available) return "The coding staff isn't installed on this Mac.";
  const lines: string[] = [];
  const { lock, liveHarness, canReceive } = snapshot.readiness;
  const reachable = lock === "free" || liveHarness === false
    ? "nobody is looking after the coding work right now"
    : lock === "unknown"
      ? "status unclear"
      : canReceive === false
        ? "not taking new work right now"
        : "on duty";
  lines.push(`Coding staff: ${reachable}.`);
  const working = snapshot.workers.filter((worker) => !DECIDING.has(worker.state));
  const waiting = snapshot.workers.filter((worker) => DECIDING.has(worker.state));
  if (working.length) lines.push(`Under way (${working.length}):`, ...working.slice(0, 12).map((worker) => `- ${clip(worker.name, 110)}${worker.doing ? ` — ${clip(worker.doing, 60)}` : ""}`));
  if (waiting.length) lines.push(`Waiting on a decision (${waiting.length}):`, ...waiting.slice(0, 12).map((worker) => `- ${clip(worker.name, 110)}${worker.since ? ` (${waited(now - Date.parse(worker.since))})` : ""}`));
  const open = snapshot.handoffs.filter((handoff) => OPEN_HANDOFF.has(handoff.status) || handoff.status === "needs_decision");
  if (open.length) lines.push(`Handed over by Flyd (${open.length}):`, ...open.slice(0, 12).map((handoff) => `- ${clip(handoff.outcome, 110)} — ${handoff.status.replace(/_/g, " ")}, last word ${waited(now - Date.parse(handoff.lastHeard))} ago`));
  if (snapshot.waitingOnHim.length) lines.push(`Held for George (${snapshot.waitingOnHim.length}):`, ...snapshot.waitingOnHim.slice(0, 8).map((item) => `- ${clip(item.summary, 110)}`));
  if (snapshot.queued) lines.push(`Queued next: ${snapshot.queued}.`);
  if (concerns.length) lines.push("Stuck:", ...concerns.map((concern) => `- ${concern.text}${concern.toldAt ? " George has been told." : concern.nudgedAt ? " Flyd has asked the staff where it stands." : ""}`));
  if (lines.length === 1) lines.push("Nothing under way.");
  return lines.join("\n");
}

export function staffFile(dir = commandDir()): string {
  return join(dir, "staff.json");
}

/** The staff view Core wrote last, if it is recent enough to trust. */
export function readStaffView(options: { file?: string; now?: number; maxAgeMs?: number } = {}): StaffView | null {
  const view = readJson(options.file ?? staffFile()) as StaffView | undefined;
  if (!view?.snapshot?.at) return null;
  const age = (options.now ?? Date.now()) - Date.parse(view.snapshot.at);
  return age <= (options.maxAgeMs ?? 5 * STAFF_CHECK_MS) ? view : null;
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

type Notify = (title: string, message: string) => Promise<void>;

export interface StaffMonitorOptions {
  home?: string;
  script?: string;
  exec?: FirstmateExec;
  sessionsDir?: string;
  /** Where Flyd's command records live (default commandDir()). */
  dir?: string;
  now?: () => number;
  notify?: Notify;
  sendRun?: typeof sendRunMessage;
}

/** Reads the staff's live state and acts on what is stuck: nudge the staff first, then tell George. */
export class StaffMonitor {
  private readonly home: string;
  private readonly script: string;
  private readonly exec: FirstmateExec;
  private readonly now: () => number;
  private running = false;

  constructor(private readonly options: StaffMonitorOptions = {}) {
    this.home = options.home ?? firstmateHome();
    this.script = options.script ?? join(this.home, "bin", "fm-inbox.sh");
    this.exec = options.exec ?? defaultExec;
    this.now = options.now ?? Date.now;
  }

  available(): boolean {
    return existsSync(this.script) || this.exec !== defaultExec;
  }

  private dir(): string {
    return this.options.dir ?? commandDir();
  }

  private stateFile(): string {
    return join(this.dir(), "staff-monitor.json");
  }

  private loadState(): MonitorState {
    const state = readJson(this.stateFile()) as Partial<MonitorState> | undefined;
    return { ...EMPTY_STATE(), ...(state ?? {}) };
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, FM_HOME: this.home };
  }

  private async readiness(): Promise<StaffReadiness> {
    try {
      const { stdout } = await this.exec(this.script, ["ready"], { env: this.env(), timeout: 5_000 });
      return parseReadiness(JSON.parse(stdout));
    } catch {
      return parseReadiness({});
    }
  }

  /** The staff's state as it is now; never throws. */
  async read(state: MonitorState = this.loadState()): Promise<StaffSnapshot> {
    const at = new Date(this.now()).toISOString();
    if (!this.available()) {
      return { at, available: false, readiness: parseReadiness({}), workers: [], waitingOnHim: [], queued: 0, handoffs: [] };
    }
    const readiness = await this.readiness();
    const summary = record(readJson(join(this.home, "state", "home-summary.json")));
    const workers = (Array.isArray(summary.active_children) ? summary.active_children : []).flatMap((item): StaffWorker[] => {
      const child = record(item);
      const id = text(child.id);
      if (!id) return [];
      const since = workerSince(this.home, id);
      const doing = plainDoing(text(child.doing));
      return [{ id, name: text(child.name) || id, state: text(child.state) || "working", ...(doing ? { doing } : {}), ...(since ? { since } : {}) }];
    });
    const waitingOnHim = (Array.isArray(summary.decisions_open) ? summary.decisions_open : []).flatMap((item) => {
      const decision = record(item);
      const id = text(decision.id);
      const age = Number(decision.hold_age_days);
      return id ? [{ id, summary: text(decision.summary) || id, ...(Number.isFinite(age) ? { ageDays: age } : {}) }] : [];
    });
    const queued = Number(record(summary.counts).queued);
    const runs = listDomainRuns(this.dir()).filter((run) => run.transport.kind === "firstmate" && (OPEN_HANDOFF.has(run.status) || run.status === "needs_decision"));
    const handoffs = runs.map((run): StaffHandoff => {
      const heard = state.heard[run.id];
      const lastHeard = heard && heard.progress === progressOf(run) ? heard.since : run.updatedAt;
      return { id: run.id, outcome: run.request.intendedOutcome, status: run.status, lastHeard };
    });
    const session = readiness.lock === "held" && readiness.pid ? sessionOfPid(readiness.pid, this.options.sessionsDir) : undefined;
    return { at, available: true, readiness, ...(session ? { session } : {}), workers, waitingOnHim, queued: Number.isFinite(queued) ? queued : 0, handoffs };
  }

  /** One pass: read, record, nudge what is newly stuck, and tell George what a nudge did not fix. */
  async tick(): Promise<StaffView | null> {
    if (this.running || !this.available()) return null;
    this.running = true;
    try {
      const state = this.loadState();
      const snapshot = await this.read(state);
      const now = this.now();
      const runs = new Map(listDomainRuns(this.dir()).map((run) => [run.id, run]));
      state.heard = Object.fromEntries(snapshot.handoffs.flatMap((handoff) => {
        const run = runs.get(handoff.id);
        return run ? [[handoff.id, { progress: progressOf(run), since: handoff.lastHeard }]] : [];
      }));
      const unreachable = snapshot.readiness.lock === "free" || snapshot.readiness.liveHarness === false;
      state.unreachableSince = unreachable ? state.unreachableSince ?? snapshot.at : undefined;
      const concerns = assessStaff(snapshot, state.unreachableSince, now);
      for (const concern of concerns) await this.act(concern, state, unreachable, now);
      // Forget what is no longer stuck, so the records stay small.
      const live = new Set(concerns.map((concern) => concern.key));
      state.nudged = Object.fromEntries(Object.entries(state.nudged).filter(([key]) => live.has(key)));
      state.told = Object.fromEntries(Object.entries(state.told).filter(([key]) => live.has(key)));
      const view: StaffView = {
        snapshot,
        concerns: concerns.map((concern) => ({
          ...concern,
          ...(state.nudged[concern.key] ? { nudgedAt: state.nudged[concern.key] } : {}),
          ...(state.told[concern.key] ? { toldAt: state.told[concern.key] } : {}),
        })),
      };
      writeJsonAtomic(this.stateFile(), state);
      writeJsonAtomic(staffFile(this.dir()), view);
      return view;
    } finally {
      this.running = false;
    }
  }

  private async act(concern: StaffConcern, state: MonitorState, unreachable: boolean, now: number): Promise<void> {
    if (state.told[concern.key]) return;
    // Nobody to nudge: George hears it straight away. Otherwise the staff gets one note first.
    // A note the inbox would not take is no nudge: George hears it then too.
    if (concern.kind !== "unreachable" && !unreachable && !state.nudged[concern.key]) {
      if (await this.nudge(concern)) {
        state.nudged[concern.key] = new Date(now).toISOString();
        return;
      }
    }
    const nudgedAt = state.nudged[concern.key];
    if (nudgedAt && now - Date.parse(nudgedAt) < NUDGE_GRACE_MS) return;
    const notify = this.options.notify ?? (await import("../runtime/agenda.js")).notifyMac;
    await notify("Flyd", concern.text).catch(() => undefined);
    state.told[concern.key] = new Date(now).toISOString();
  }

  /** A note to the staff about one stuck thing; true once the inbox has it. */
  private async nudge(concern: StaffConcern): Promise<boolean> {
    if (concern.runId) {
      const run = listDomainRuns(this.dir()).find((item) => item.id === concern.runId);
      if (!run) return false;
      const body = [
        `Flyd has had no word on this handoff since ${concern.since}.`,
        "Reply with where it stands. Plain prose is fine: done (and what changed), needs George's decision (and your recommendation), failed (and why), or still working (and what is next).",
      ].join(" ");
      const outcome = await (this.options.sendRun ?? sendRunMessage)({ run, kind: "question", body, from: "flyd" }).catch(() => ({ delivered: false }));
      return outcome.delivered;
    }
    if (concern.workerId) {
      const id = `flyd-staff-check-${createHash("sha256").update(concern.key).digest("hex").slice(0, 16)}`;
      const body = [
        `FLYD CHECK-IN: worker ${concern.workerId} has been waiting on a decision since ${concern.since}.`,
        "Settle it within the authority you already have, or bring it to George through Flyd with your recommendation if it is truly his. Reply to this note (fm-inbox.sh reply) with what you did; plain prose is fine.",
      ].join("\n");
      try {
        const { stdout } = await this.exec(this.script, ["note", "--request-id", id, "--json", "-"], { env: this.env(), input: body, timeout: 20_000 });
        return (JSON.parse(stdout) as { saved?: boolean }).saved === true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Core's staff watch: one read a minute. Never under vitest unless a test drives a monitor itself. */
export function startStaffMonitor(options: StaffMonitorOptions & { intervalMs?: number; onError?: (error: unknown) => void } = {}): () => void {
  stopStaffMonitor();
  if (process.env.FLYD_STAFF_MONITOR === "0") return stopStaffMonitor;
  const monitor = new StaffMonitor(options);
  const tick = () => void monitor.tick().catch((error) => options.onError?.(error));
  timer = setInterval(tick, options.intervalMs ?? STAFF_CHECK_MS);
  timer.unref?.();
  tick();
  return stopStaffMonitor;
}

export function stopStaffMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Longer than any view poll asking for it, so a poll almost always reuses one lock read. */
const LIVE_SESSION_TTL_MS = 30_000;

/**
 * Which Claude Code session holds the staff's lock: its pid, then that pid's
 * session record. Read through `fm-inbox.sh ready`, at most once per TTL.
 */
export class LiveStaffSession {
  private cached?: { at: number; session: string | undefined };
  private pending?: Promise<string | undefined>;
  private readonly script: string;
  private readonly exec: FirstmateExec;
  private readonly home: string;

  constructor(private readonly options: { home?: string; script?: string; exec?: FirstmateExec; sessionsDir?: string; ttlMs?: number; now?: () => number } = {}) {
    this.home = options.home ?? firstmateHome();
    this.script = options.script ?? join(this.home, "bin", "fm-inbox.sh");
    this.exec = options.exec ?? defaultExec;
  }

  async current(): Promise<string | undefined> {
    const now = (this.options.now ?? Date.now)();
    if (this.cached && now - this.cached.at < (this.options.ttlMs ?? LIVE_SESSION_TTL_MS)) return this.cached.session;
    this.pending ??= (async () => {
      try {
        if (!existsSync(this.script) && this.exec === defaultExec) return undefined;
        const { stdout } = await this.exec(this.script, ["ready"], { env: { ...process.env, FM_HOME: this.home }, timeout: 5_000 });
        const readiness = parseReadiness(JSON.parse(stdout));
        return readiness.lock === "held" && readiness.pid ? sessionOfPid(readiness.pid, this.options.sessionsDir) : undefined;
      } catch {
        return undefined;
      }
    })().then((session) => {
      this.cached = { at: (this.options.now ?? Date.now)(), session };
      this.pending = undefined;
      return session;
    });
    return this.pending;
  }
}
