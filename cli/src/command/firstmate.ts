import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { firstmateHome, firstmateInboxScript } from "../lib/firstmate-home.js";
import { FLYD_DIR } from "../lib/config.js";
import { defaultProseJudge, parseDomainResult, proseOutcomeByWords, type ProseJudge, type ProseOutcome } from "./result.js";
import { commitDomainRun, listDomainRuns, mutateDomainRun, readDomainRun } from "./store.js";
import { cameBack, isSettled } from "./run-state.js";
import { dueReport, quietReport } from "./report.js";
import type { DomainMessage, DomainRequest, DomainRun, DomainRunStatus } from "./types.js";
import { decisionsLines } from "./types.js";

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

/**
 * The one low-level runner for firstmate's `bin/fm-inbox.sh`: no shell, the body on stdin.
 * A non-zero exit rejects with the script's stdout kept on the error, since a saved
 * note may exit non-zero when only its wake failed (see `firstmateStdout`).
 */
export const defaultFirstmateExec: FirstmateExec = defaultExec;

/** What the script printed, from its result or from the error a non-zero exit raised; "" when nothing. */
export function firstmateStdout(error: unknown): string {
  return error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
}

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
    // A script that refuses before reading its input closes the pipe; its exit status says why.
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input);
  });
}

export interface FirstmateReadiness {
  available: boolean;
  canReceive: boolean | "unknown";
  liveHarness?: boolean;
  reason?: string;
}

/** What George reads on a note handed over while FirstMate is not running: it is queued, and why. */
export const FIRSTMATE_WAITING = "waiting for FirstMate to be running";

/**
 * Whether FirstMate is running to take notes: not when its inbox says it cannot receive and no harness is live.
 * An unreadable readiness is not taken as down. Flyd never starts a session itself; one persistent FirstMate drains its inbox.
 */
export function firstmateRunning(readiness: FirstmateReadiness): boolean {
  return !(readiness.canReceive === false && !readiness.liveHarness);
}

/** What `fm-inbox.sh note --json` printed: the note's id, whether it is saved, and whether it replayed one already held. */
interface NoteReceipt {
  id?: string;
  saved?: boolean;
  acknowledged?: boolean;
  outcome?: string;
}

/** Flyd's own notes go under `flyd-…` request ids: idempotent, and never shown in George's window as his words. */
const FLYD_NOTE_ID = /^flyd-[A-Za-z0-9._:-]{1,120}$/;

/**
 * Flyd's own note to FirstMate that no run of George's carries (a worker check-in, a call to close, his answer to a
 * recorded decision whose run is no longer open, a note about a task the staff runs): still a DomainRun of its own.
 */
export interface FlydNote {
  /** `flyd-…`: the same id again is a replay, never a second note. */
  requestId: string;
  /** What Flyd tells the staff, in its own words. */
  body: string;
  /** What the note is for, in a few words. */
  outcome: string;
  /** George's own words the note carries, verbatim, when it carries any: they become the run's original message. */
  georgesWords?: string;
  doneWhen?: string[];
  /** The run this note follows up, when it is about one. */
  parentRequestId?: string;
  contextRefs?: string[];
}

const FLYD_NOTE_DONE_WHEN = [
  "the note is acted on within the authority you already have",
  "what you did, or why you could not, is replied to this note",
];

/** Flyd's own note, marked as Flyd's, with George's words (when it carries any), what done means and the return contract under it. Pure. */
export function flydNoteBody(request: DomainRequest, body: string): string {
  const words = request.originalMessage !== body ? ["", "GEORGE'S OWN WORDS — preserve this wording as authority:", request.originalMessage] : [];
  return [
    `FLYD NOTE (request ${request.id}; Flyd's own note, not George's wording)`,
    body,
    ...words,
    ...(request.parentRequestId ? ["", `Follow-up to prior Flyd domain run: ${request.parentRequestId}`] : []),
    "",
    "DONE WHEN:",
    ...request.doneWhen.map((point, index) => `${index + 1}. ${point}`),
    "",
    "RETURN CONTRACT: reply to this note (fm-inbox.sh reply) with what you did. Plain prose is fine: done (and what changed), needs George's decision (with your recommendation), failed (and why), or still under way (and what is next).",
  ].join("\n");
}

/**
 * The one client for FirstMate's inbox. Every note Flyd sends, and every readiness and receipt read, goes through
 * here; nothing else in Flyd runs `bin/fm-inbox.sh`.
 */
export class FirstmateDomainTransport {
  readonly home: string;
  readonly script: string;

  constructor(options: { home?: string; script?: string; exec?: FirstmateExec; dir?: string } = {}) {
    this.home = options.home ?? firstmateHome();
    this.script = options.script ?? firstmateInboxScript(this.home);
    this.exec = options.exec ?? defaultFirstmateExec;
    this.dir = options.dir;
  }

  private readonly exec: FirstmateExec;
  /** Where the runs it opens are kept (default commandDir()). */
  private readonly dir?: string;

  available(): boolean {
    return existsSync(this.script) || this.exec !== defaultFirstmateExec;
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, FM_HOME: this.home };
  }

  /** `fm-inbox.sh ready` as the script printed it; throws when it cannot be read. */
  async readyReport(): Promise<unknown> {
    const { stdout } = await this.exec(this.script, ["ready"], { env: this.env(), timeout: 5_000 });
    return JSON.parse(stdout) as unknown;
  }

  async ready(): Promise<FirstmateReadiness> {
    if (!this.available()) return { available: false, canReceive: false, reason: "FirstMate inbox is not installed" };
    try {
      const parsed = await this.readyReport() as { can_receive?: boolean | "unknown"; lock?: { live_harness?: boolean }; wake_consumer?: { reason?: string } };
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

  /**
   * Hands one request to FirstMate as a durable inbox note under the request's id and records its DomainRun.
   * `body` replaces the default note text (the view's desk note keeps George's words, attachments and
   * Flyd's brief in its own shape, with the return contract under them); `onSavedDespite` hears the
   * error of a note that was saved though the script then failed (its wake).
   */
  async submit(request: DomainRequest, owner = "FirstMate", options: { body?: string; onSavedDespite?: (detail: string) => void } = {}): Promise<DomainRun> {
    return (await this.handOff(request, owner, options)).run;
  }

  /**
   * The one `fm-inbox.sh note` call: the body on stdin under its request id. A note saved though its wake
   * then failed still counts (`onSavedDespite` hears why).
   */
  private async note(requestId: string, body: string, onSavedDespite?: (detail: string) => void): Promise<NoteReceipt> {
    let stdout = "";
    try {
      ({ stdout } = await this.exec(this.script, ["note", "--request-id", requestId, "--json", "-"], {
        env: this.env(),
        input: body,
        timeout: 20_000,
      }));
    } catch (error) {
      // A saved request may return a non-zero exit when only the wake failed.
      stdout = firstmateStdout(error);
      if (!stdout.trim()) throw error;
      onSavedDespite?.((error instanceof Error ? error.message : String(error)).trim().split("\n").pop() ?? "");
    }
    return JSON.parse(stdout) as NoteReceipt;
  }

  /**
   * Flyd's own note that no run of George's carries, as a DomainRun of its own (see FlydNote): its words,
   * done_when and the return contract on the note. The same request id again is a replay, never a second note.
   */
  async sendFlydNote(note: FlydNote): Promise<{ run: DomainRun; replayed: boolean }> {
    if (!FLYD_NOTE_ID.test(note.requestId)) throw new Error("Flyd's own notes need a flyd- request id");
    const body = note.body.trim();
    if (!body) throw new Error("Empty note");
    const request: DomainRequest = {
      id: note.requestId,
      domain: "coding",
      originalMessage: note.georgesWords?.trim() || body,
      intendedOutcome: note.outcome.trim() || body.split("\n")[0]!.slice(0, 200),
      doneWhen: note.doneWhen?.length ? note.doneWhen : FLYD_NOTE_DONE_WHEN,
      createdAt: new Date().toISOString(),
      source: "flyd",
      ...(note.parentRequestId ? { parentRequestId: note.parentRequestId } : {}),
      ...(note.contextRefs?.length ? { contextRefs: note.contextRefs } : {}),
    };
    return this.handOff(request, "FirstMate", { body: flydNoteBody(request, body) });
  }

  /** As `submit`, also saying whether the request was handed over before (its run is on record, or the inbox replayed it). */
  private async handOff(request: DomainRequest, owner: string, options: { body?: string; onSavedDespite?: (detail: string) => void }): Promise<{ run: DomainRun; replayed: boolean }> {
    if (request.domain !== "coding") throw new Error("FirstMate currently owns only the coding domain");
    const existing = readDomainRun(request.id, this.dir);
    if (existing?.transport.kind === "firstmate" && existing.transport.externalId) return { run: existing, replayed: true };
    const readiness = await this.ready();
    if (!readiness.available) throw new Error(readiness.reason ?? "FirstMate is unavailable");
    const receipt = await this.note(request.id, options.body ?? firstmateRequestBody(request), options.onSavedDespite);
    if (!receipt.id || receipt.saved !== true) throw new Error("FirstMate did not durably accept the request");
    const replayed = receipt.outcome === "replay";

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
    // Saved is delivered: the note waits in FirstMate's durable inbox, in order, for the running FirstMate to drain.
    // While it is not running the run says so; Flyd never launches a session or helper for a note.
    if (!receipt.acknowledged && !firstmateRunning(readiness)) run.waiting = FIRSTMATE_WAITING;
    // A run left on record without its inbox receipt keeps whatever was added to it since; it gains the receipt.
    const saved = mutateDomainRun(run.id, (current) => {
      if (!current) return run;
      const { waiting: _waiting, ...rest } = current;
      return { ...rest, ...run };
    }, this.dir);
    return { run: saved ?? run, replayed };
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
    const receipt = await this.note(message.id, body);
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

  /**
   * `fm-inbox.sh announce`: the wake for a note already saved but not announced, so the running FirstMate picks it
   * up. Never a second note; one FirstMate has already acknowledged gets no wake.
   */
  async announce(noteId: string): Promise<void> {
    await this.exec(this.script, ["announce", "--json", noteId], { env: this.env(), timeout: 20_000 });
  }
}

const UNREAD_TOO_LONG_MS = 3 * 60_000;
const unreadSignals = new Set<string>();

/** Appends one JSONL line to `~/.flyd/self-review/firstmate-session.jsonl` (`FLYD_SELF_REVIEW_DIR` overrides the directory): a note left unread too long while FirstMate is running `{ at, kind: "unread_note", home, notes }`. The council self-review reads it in cli/src/council/reply-review.ts. */
function recordSessionAttempt(entry: Record<string, unknown>): void {
  try {
    const path = join(process.env.FLYD_SELF_REVIEW_DIR?.trim() || join(FLYD_DIR, "self-review"), "firstmate-session.jsonl");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    return;
  }
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
  /** Whether its wake is on FirstMate's queue; null when the note predates that record. */
  announced?: boolean | null;
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
    ...(request.decisions ? ["", "DECISIONS:", ...decisionsLines(request.decisions)] : []),
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
  return commitDomainRun(sent.run, { ...sent.run, statusAskedAt: now.toISOString() });
}

/** Pending notes oldest first: the order FirstMate's inbox takes them in. */
function inboxOrder(notes: FirstmateNote[]): FirstmateNote[] {
  return [...notes].sort((a, b) => (Date.parse(a.at ?? "") || 0) - (Date.parse(b.at ?? "") || 0) || a.id.localeCompare(b.id));
}

/**
 * Delivers the notes queued while FirstMate was not running to the running FirstMate, in order: each one saved but
 * not announced gets its wake. A note already announced waits on FirstMate's own queue; nothing is sent twice.
 */
async function deliverQueuedNotes(pending: FirstmateNote[], transport: FirstmateDomainTransport): Promise<void> {
  for (const note of inboxOrder(pending)) {
    if (note.acknowledged || note.announced !== false) continue;
    // One that cannot be announced now is tried again on the next sync; the ones after it still go, in order.
    await transport.announce(note.id).catch(() => undefined);
  }
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
  let receipts: FirstmateReceipts;
  try {
    receipts = await transport.receipts();
  } catch {
    return [];
  }
  const nowMs = (options.now ?? (() => new Date()))().getTime();
  const pending = receipts.pending ?? [];
  // Whether FirstMate is running decides only what the queued notes say and when they are delivered: Flyd never starts it.
  const readiness = pending.length ? await transport.ready() : undefined;
  const running = !readiness || firstmateRunning(readiness);
  if (readiness && running) {
    await deliverQueuedNotes(pending, transport);
    // A note FirstMate, running, has left unread too long is recorded once for the self-review.
    const newlyUnread = pending.filter((note) => note.at && nowMs - Date.parse(note.at) > UNREAD_TOO_LONG_MS && !unreadSignals.has(`${transport.home}:${note.id}`));
    for (const note of newlyUnread) unreadSignals.add(`${transport.home}:${note.id}`);
    if (newlyUnread.length) recordSessionAttempt({ kind: "unread_note", home: transport.home, notes: newlyUnread.map((note) => note.id) });
  } else if (!pending.length) {
    for (const key of unreadSignals) if (key.startsWith(`${transport.home}:`)) unreadSignals.delete(key);
  }
  const runs = listDomainRuns().filter((run) => run.transport.kind === "firstmate" && !isSettled(run.status));
  if (!runs.length) return [];
  const judge = options.judge ?? await defaultProseJudge();
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
      // FirstMate's reply is the report, verbatim: structured fields are used when it carries them, and otherwise
      // the whole reply is the report (parseDomainResult). No shape is required and nothing is asked again.
      const parsed = parseDomainResult(reply.body!);
      // Only a structured reply's own status or Flyd's model may settle a run;
      // prose words no model could read stay "unclear" rather than being guessed.
      const outcome: ProseOutcome = parsed.status ?? (parsed.result.format === "raw" ? await proseOutcome(reply.body!, run, judge) : "completed");
      // A reply written before this run existed answered an earlier send of the same note
      // (the inbox replayed it): its question was already put, or overtaken. It is history,
      // never a fresh decision for George.
      const predates = Boolean(reply.at) && Date.parse(reply.at!) < Date.parse(run.createdAt);
      const status: DomainRunStatus = outcome === "unclear" ? "working" : predates && outcome === "needs_decision" ? "cancelled" : outcome;
      const { notified, failure, incompleteReason: _previous, statusAskedAt, ...rest } = next;
      const news = !predates && (status !== run.status || JSON.stringify(parsed.result) !== JSON.stringify(run.result));
      const settledAt = reply.at ?? (options.now ?? (() => new Date()))().toISOString();
      next = {
        ...rest,
        status,
        result: parsed.result,
        updatedAt: settledAt,
        transport: { ...next.transport, replyCursor: reply.cursor },
        // A new outcome is announced again; the same one is not, nor an old reply replayed.
        ...(predates ? { notified: true } : notified !== undefined && !news ? { notified } : {}),
        // The outcome's report, in the same commit as the outcome: a restart can never lose it (command/report.ts).
        // A reply after work was sent back to its boss is reviewed afresh even when it says the same (as is one on a run
        // recorded before the report record that was never announced).
        ...(cameBack(status) && (predates || news || (run.report ? run.report.sentBack : !notified))
          ? { report: predates ? quietReport(status, settledAt) : dueReport(status, settledAt) } : {}),
        ...(status === "failed" ? { failure: parsed.result.brief } : failure !== undefined && !news ? { failure } : {}),
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
      const settledAt = (options.now ?? (() => new Date()))().toISOString();
      next = {
        ...next, status, ...(stale && status === "completed" ? { notified: true } : {}), ...(status === "failed" ? { failure: run.result.brief } : {}),
        ...(cameBack(status) ? { report: stale && status === "completed" ? quietReport(status, settledAt) : dueReport(status, settledAt) } : {}),
      };
      statusUnclear = outcome === "unclear";
    } else if (run.status === "working" && run.result?.format === "raw") {
      // A reply taken before its "status: …" lines could be read: read it again.
      const parsed = parseDomainResult(run.result.raw.at(-1) ?? run.result.detailedReport);
      if (parsed.status && parsed.status !== "working") {
        const { incompleteReason: _previous, statusAskedAt: _asked, ...rest } = next;
        const stale = nowMs - Date.parse(run.updatedAt) > LEGACY_ANNOUNCE_WITHIN_MS;
        next = {
          ...rest,
          status: parsed.status,
          result: parsed.result,
          ...(stale && parsed.status === "completed" ? { notified: true } : {}),
          ...(parsed.status === "failed" ? { failure: parsed.result.brief } : {}),
          ...(cameBack(parsed.status) ? { report: (stale && parsed.status === "completed" ? quietReport : dueReport)(parsed.status, (options.now ?? (() => new Date()))().toISOString()) } : {}),
        };
      }
    }
    // A note still queued says why while FirstMate is not running, and stops saying it once FirstMate is.
    const waiting = next.status === "queued" && !running ? FIRSTMATE_WAITING : undefined;
    if (next.waiting !== waiting) {
      const { waiting: _waiting, ...rest } = next;
      next = waiting ? { ...rest, waiting } : rest;
    }
    if (JSON.stringify(next) === JSON.stringify(run)) continue;
    // Only what this sync changed is applied, so a message `flyd view` sent meanwhile survives.
    next = commitDomainRun(run, next);
    // Flyd's own notes (check-ins, closes) settle from their reply, but are never chased for a clearer one.
    if (statusUnclear && !next.statusAskedAt && next.request.source !== "flyd") next = await askForAClearStatus(next, unclearFrom, transport, (options.now ?? (() => new Date()))());
    changed.push(next);
    await options.onChanged?.(next);
  }
  return changed;
}
