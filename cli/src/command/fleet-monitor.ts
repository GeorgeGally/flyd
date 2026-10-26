import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { reachesGeorge, type GeorgeKind } from "../lib/reaches-george.js";
import { FirstmateDomainTransport, type FirstmateExec, type FirstmateReceipts } from "./firstmate.js";
import { sendRunMessage } from "./messages.js";
import { commandDir, listDomainRuns } from "./store.js";
import type { DomainRun } from "./types.js";

// Flyd watches its coding staff (FirstMate) from Core, read-only: the staff's
// own readiness (`fm-inbox.sh ready`), its home summary (state/home-summary.json:
// workers, decisions waiting on George, the queue), each worker's status log,
// and Flyd's own handoffs. Stuck work is Flyd's to chase: a note to the staff,
// and another every few hours while one goes unanswered, never a word to
// George. At most one chase per run or worker is open at a time: none while
// the staff has not yet read a note about it (its last chase, or the request
// itself), and none when its inbox receipts cannot be read. He is told only when nobody is there to take the chase at all
// (lib/reaches-george.ts: a blocker Flyd has run out of moves on), once.
// Nothing here writes into the FirstMate home except notes through its inbox.

/** A handoff with no word back this long gets a note asking where it stands. */
export const STALE_HANDOFF_MS = 2 * 60 * 60_000;
/** A worker waiting on a decision this long gets a note to the staff. */
export const WORKER_WAIT_MS = 30 * 60_000;
/** While a handoff stays quiet or a worker stays waiting, Flyd asks the staff again this often. */
export const RENUDGE_MS = 6 * 60 * 60_000;
/** The staff unreachable this long, with work open, is told to George: long enough that a restart or a quiet night is not his news. */
export const UNREACHABLE_MS = 4 * 60 * 60_000;
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

export type StaffConcernKind = "handoff_stale" | "worker_waiting" | "worker_stopped" | "unreachable";

export interface StaffConcern {
  /** Stable while the same thing stays stuck; a fresh stall gets a new key. */
  key: string;
  kind: StaffConcernKind;
  since: string;
  /** George's words: no machinery names. */
  text: string;
  /** What is stuck, in a few words. */
  subject?: string;
  runId?: string;
  workerId?: string;
  /** The staff's own word for where a stopped worker stands: failed, or unknown. */
  workerState?: string;
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
/** Work that stopped without asking anyone: it failed, or the staff lost sight of it. */
const STOPPED = new Set(["failed", "unknown"]);
const OPEN_HANDOFF = new Set(["queued", "accepted", "working"]);

type ReceiptNote = NonNullable<FirstmateReceipts["pending"]>[number];

/** A note the staff has not yet read or acknowledged: chasing on top of it only adds to the pile. */
function stillUnread(note: ReceiptNote, pending: Set<string>): boolean {
  return pending.has(note.id) || note.acknowledged === false;
}

/**
 * Whether a chase about this run is still open: any of the run's own notes (the request, a
 * correction, or Flyd's last chase) sits unread in the staff's inbox. Pure.
 */
export function runChaseOpen(run: DomainRun, receipts: FirstmateReceipts): boolean {
  const pending = new Set((receipts.pending ?? []).map((note) => note.id));
  const noteIds = new Set([run.transport.externalId, ...(run.messages ?? []).map((message) => message.externalId)].filter(Boolean));
  const requestIds = new Set([run.transport.requestId, ...(run.messages ?? []).map((message) => message.id)]);
  return [...(receipts.pending ?? []), ...(receipts.handled ?? [])]
    .some((note) => (noteIds.has(note.id) || (note.request_id ? requestIds.has(note.request_id) : false)) && stillUnread(note, pending));
}

/** Whether Flyd's last check-in under this request id still sits unread. Pure. */
export function noteChaseOpen(requestId: string | undefined, receipts: FirstmateReceipts): boolean {
  if (!requestId) return false;
  const pending = new Set((receipts.pending ?? []).map((note) => note.id));
  return [...(receipts.pending ?? []), ...(receipts.handled ?? [])].some((note) => note.request_id === requestId && stillUnread(note, pending));
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
  /** Per worker: the request id of Flyd's last check-in note about it, so a second is never left on an unread first. */
  chases?: Record<string, string>;
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
      subject: clip(handoff.outcome),
      text: `I've heard nothing back on "${clip(handoff.outcome)}" for ${waited(quiet)}.`,
    });
  }
  for (const worker of snapshot.workers) {
    if (!worker.since || !(DECIDING.has(worker.state) || STOPPED.has(worker.state))) continue;
    const waiting = now - Date.parse(worker.since);
    if (!(waiting > WORKER_WAIT_MS)) continue;
    if (DECIDING.has(worker.state)) {
      concerns.push({
        key: `worker:${worker.id}:${worker.since}`,
        kind: "worker_waiting",
        since: worker.since,
        workerId: worker.id,
        subject: clip(worker.name),
        text: `"${clip(worker.name)}" has been stuck waiting for ${waited(waiting)}.`,
      });
      continue;
    }
    concerns.push({
      key: `stopped:${worker.id}:${worker.since}`,
      kind: "worker_stopped",
      since: worker.since,
      workerId: worker.id,
      workerState: worker.state,
      subject: clip(worker.name),
      text: worker.state === "failed" ? `"${clip(worker.name)}" failed ${waited(waiting)} ago.` : `There has been no word on "${clip(worker.name)}" for ${waited(waiting)}.`,
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

/** What a stuck thing is to George: nobody there to take the chase is a blocker; the rest is staff silence, Flyd's to chase. */
export function concernKind(concern: Pick<StaffConcern, "kind">): GeorgeKind {
  return concern.kind === "unreachable" ? "blocker" : "silence";
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

type Notify = (title: string, message: string, kind?: GeorgeKind) => Promise<void>;

export interface StaffMonitorOptions {
  home?: string;
  script?: string;
  exec?: FirstmateExec;
  /** The one client for the staff's inbox; built from home/script/exec when not given. */
  transport?: FirstmateDomainTransport;
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
  /** The one client for the staff's inbox: every read and note goes through it. */
  private readonly transport: FirstmateDomainTransport;
  private readonly now: () => number;
  private running = false;

  constructor(private readonly options: StaffMonitorOptions = {}) {
    this.transport = options.transport ?? new FirstmateDomainTransport({
      ...(options.home ? { home: options.home } : {}),
      ...(options.script ? { script: options.script } : {}),
      ...(options.exec ? { exec: options.exec } : {}),
      ...(options.dir ? { dir: options.dir } : {}),
    });
    this.home = this.transport.home;
    this.now = options.now ?? Date.now;
  }

  available(): boolean {
    return this.transport.available();
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

  private async readiness(): Promise<StaffReadiness> {
    try {
      return parseReadiness(await this.transport.readyReport());
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
    // Flyd's own notes (check-ins, closes) are chases about something else, never handoffs to chase in turn.
    const runs = listDomainRuns(this.dir()).filter((run) => run.transport.kind === "firstmate" && run.request.source !== "flyd" && (OPEN_HANDOFF.has(run.status) || run.status === "needs_decision"));
    const handoffs = runs.map((run): StaffHandoff => {
      const heard = state.heard[run.id];
      const lastHeard = heard && heard.progress === progressOf(run) ? heard.since : run.updatedAt;
      return { id: run.id, outcome: run.request.intendedOutcome, status: run.status, lastHeard };
    });
    const session = readiness.lock === "held" && readiness.pid ? sessionOfPid(readiness.pid, this.options.sessionsDir) : undefined;
    return { at, available: true, readiness, ...(session ? { session } : {}), workers, waitingOnHim, queued: Number.isFinite(queued) ? queued : 0, handoffs };
  }

  /** One pass: read, record, chase what is stuck, and tell George only what nobody is there to chase. */
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
      const nobodyThere = concerns.some((concern) => concern.kind === "unreachable");
      // Read once per pass, and only when there is something to chase.
      let receipts: FirstmateReceipts | null | undefined;
      const inbox = async (): Promise<FirstmateReceipts | null> => (receipts === undefined ? (receipts = await this.receipts()) : receipts);
      for (const concern of concerns) await this.act(concern, state, nobodyThere, now, inbox);
      const stuckWorkers = new Set(concerns.flatMap((concern) => (concern.workerId ? [concern.workerId] : [])));
      if (state.chases) state.chases = Object.fromEntries(Object.entries(state.chases).filter(([worker]) => stuckWorkers.has(worker)));
      // Forget what is no longer stuck, so the records stay small.
      const live = new Set(concerns.map((concern) => concern.key));
      state.nudged = Object.fromEntries(Object.entries(state.nudged).filter(([key]) => live.has(key)));
      // Only an outage is ever told; anything recorded under an older rule is not.
      const byKey = new Map(concerns.map((concern) => [concern.key, concern]));
      state.told = Object.fromEntries(Object.entries(state.told).filter(([key]) => byKey.get(key)?.kind === "unreachable"));
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

  /** The staff's inbox receipts, or null when they cannot be read (then nothing is chased: no chase on a pile Flyd cannot see). */
  private async receipts(): Promise<FirstmateReceipts | null> {
    try {
      return await this.transport.receipts();
    } catch {
      return null;
    }
  }

  private async act(concern: StaffConcern, state: MonitorState, nobodyThere: boolean, now: number, inbox: () => Promise<FirstmateReceipts | null>): Promise<void> {
    if (state.told[concern.key]) return;
    const nudgedAt = state.nudged[concern.key];
    const gated = reachesGeorge({ kind: concernKind(concern), text: concern.text }, "notification");
    if (gated.reach) {
      const notify = this.options.notify ?? (await import("../runtime/agenda.js")).notifyMac;
      await notify("Flyd", gated.line, gated.kind).catch(() => undefined);
      state.told[concern.key] = new Date(now).toISOString();
      return;
    }
    // Staff silence is chased, quietly: one note, and another every few hours while it goes unanswered.
    // With nobody there to take a note, the outage itself is what reaches him. A note the inbox
    // would not take is tried again on the next pass.
    if (nobodyThere || (nudgedAt && now - Date.parse(nudgedAt) < RENUDGE_MS)) return;
    // One open chase at a time: nothing more while a note about it still sits unread.
    const receipts = await inbox();
    if (!receipts) return;
    if (concern.runId) {
      const run = listDomainRuns(this.dir()).find((item) => item.id === concern.runId);
      if (run && runChaseOpen(run, receipts)) return;
    }
    if (concern.workerId && noteChaseOpen(state.chases?.[concern.workerId], receipts)) return;
    const sent = await this.nudge(concern, nudgedAt);
    if (!sent) return;
    state.nudged[concern.key] = new Date(now).toISOString();
    if (concern.workerId && typeof sent === "string") state.chases = { ...(state.chases ?? {}), [concern.workerId]: sent };
  }

  /** A note to the staff about one stuck thing, saying when Flyd last asked; truthy once the inbox has it (a worker check-in: its request id). */
  private async nudge(concern: StaffConcern, askedBefore?: string): Promise<boolean | string> {
    const again = askedBefore ? ` Flyd asked at ${askedBefore} and has had no answer.` : "";
    if (concern.runId) {
      const run = listDomainRuns(this.dir()).find((item) => item.id === concern.runId);
      if (!run) return false;
      const body = [
        `Flyd has had no word on this handoff since ${concern.since}.${again}`,
        "Reply with where it stands. Plain prose is fine: done (and what changed), needs George's decision (and your recommendation), failed (and why), or still working (and what is next).",
      ].join(" ");
      // The chase is a message on the run itself: its parent is the run, and the run's reply settles it.
      const outcome = await (this.options.sendRun ?? sendRunMessage)({ run, kind: "question", body, from: "flyd", transport: this.transport }).catch(() => ({ delivered: false }));
      return outcome.delivered;
    }
    if (concern.workerId) {
      // Each chase is its own note: the same request id again would only replay the first.
      const id = `flyd-staff-check-${createHash("sha256").update(askedBefore ? `${concern.key}\0${askedBefore}` : concern.key).digest("hex").slice(0, 16)}`;
      const body = concern.kind === "worker_stopped"
        ? [
          `FLYD CHECK-IN: worker ${concern.workerId} stopped (${concern.workerState === "failed" ? "failed" : "no word"}) at ${concern.since}.${again}`,
          "Retry or repair it within the authority you already have; bring it to George through Flyd only as a real blocker, in plain words, with your recommendation.",
        ].join("\n")
        : [
          `FLYD CHECK-IN: worker ${concern.workerId} has been waiting on a decision since ${concern.since}.${again}`,
          "Settle it within the authority you already have, or bring it to George through Flyd with your recommendation if it is truly his.",
        ].join("\n");
      // A worker the staff runs has no run of Flyd's: the check-in goes as a run of its own, through the one transport.
      return this.transport.sendFlydNote({
        requestId: id,
        body,
        outcome: concern.kind === "worker_stopped" ? `Get stopped work moving again: ${concern.subject ?? concern.workerId}` : `Settle the decision a worker waits on: ${concern.subject ?? concern.workerId}`,
        doneWhen: [
          concern.kind === "worker_stopped" ? "the worker is retried or repaired, or what blocks it is brought to George as a real blocker" : "the decision is settled, or brought to George with a recommendation when it is truly his",
          "what you did is replied to this note",
        ],
        contextRefs: [`worker:${concern.workerId}`],
      }).then(() => id, () => false);
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
  private readonly transport: FirstmateDomainTransport;

  constructor(private readonly options: { home?: string; script?: string; exec?: FirstmateExec; transport?: FirstmateDomainTransport; sessionsDir?: string; ttlMs?: number; now?: () => number } = {}) {
    this.transport = options.transport ?? new FirstmateDomainTransport({
      ...(options.home ? { home: options.home } : {}),
      ...(options.script ? { script: options.script } : {}),
      ...(options.exec ? { exec: options.exec } : {}),
    });
  }

  async current(): Promise<string | undefined> {
    const now = (this.options.now ?? Date.now)();
    if (this.cached && now - this.cached.at < (this.options.ttlMs ?? LIVE_SESSION_TTL_MS)) return this.cached.session;
    this.pending ??= (async () => {
      try {
        if (!this.transport.available()) return undefined;
        const readiness = parseReadiness(await this.transport.readyReport());
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
