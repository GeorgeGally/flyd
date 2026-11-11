import { createHash } from "node:crypto";
import { bossMessageKind, FENCE_HELD, HELD_FOR_ATTENTION, notesSentToBoss } from "../intelligence/executive/decision-step.js";
import { recordHeld } from "../council/reply-review.js";
import { syncFirstmateDomainRuns } from "./firstmate.js";
import { syncDesignMateRuns } from "./design-mate.js";
import { syncLibrarianDomainRuns } from "./librarian.js";
import { sendRunMessage } from "./messages.js";
import { noticeKind } from "./notice.js";
import type { GeorgeKind } from "../lib/reaches-george.js";
import { listDomainRuns, mutateDomainRun, readDomainRun, updateDomainRun } from "./store.js";
import { cameBack, isOpen } from "./run-state.js";
import type { DomainRun } from "./types.js";
import { cosEnabled, readObjective } from "./cos/objectives.js";
import { followsRun } from "./cos/plan.js";
import { deliver, reportFromRun } from "../runtime/delivery.js";
import { authorityForStaffRun, processFirstmateChange } from "../intelligence/executive/firstmate-decision.js";
import { standingPreferences } from "../intelligence/executive/standing-rules.js";
import type { ExecutiveDecisionRecord, ExecutiveInternalAction } from "../intelligence/executive/decision-step.js";
import { deliverOnce, deliverOwed, deliveryState, finishedKey, heldReports, holdReport, markTold, seedOnce, withdrawReport, type DeliveryOutcome, type DeliveryReport, type DeliveryState } from "../runtime/delivered.js";
import { MAX_REVIEW_TRIES, OPEN_REPORT_STATES, reportDue, sameReport } from "./report.js";
import type { RunReport } from "./types.js";
import { batch, callKind, readFocus, readSignals, released, sameProject, timing, type Focus, type Timing } from "../runtime/attention.js";
import { windowOpen } from "../conversation-view/window-presence.js";
import { deskWords } from "../conversation-view/firstmate-inbox.js";
import { plainNote } from "../conversation-view/rail.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let seeded = false;

/** Says a line to George; what became of it, when it can tell (runtime/delivered.ts), or nothing for "shown". */
type Notify = (title: string, message: string, kind?: GeorgeKind) => Promise<DeliveryOutcome | void>;

export type RunDecisionStep = (run: DomainRun, send: typeof sendRunMessage) => Promise<ExecutiveDecisionRecord>;

/** Delivers Flyd's note to a run's boss once; a note already delivered is not counted again, and failed work goes back to its boss. */
export async function deliverBossNote(
  run: DomainRun,
  action: ExecutiveInternalAction,
  send: typeof sendRunMessage = sendRunMessage,
): Promise<{ status: "verified" | "failed" | "unknown"; evidenceRefs: string[] }> {
  if (run.messages?.some((message) => message.body === action.text && message.deliveredAt)) return { status: "failed", evidenceRefs: [] };
  const kind = bossMessageKind(action.text);
  const outcome = await send({ run, kind, body: action.text, from: "flyd" }).catch(() => null);
  if (!outcome?.delivered) return { status: "failed", evidenceRefs: [] };
  const receipt = outcome.run?.messages?.find((message) => message.kind === kind && message.body === action.text && message.deliveredAt);
  const sent = outcome.run;
  if (receipt && sent && run.status === "failed") mutateDomainRun(run.id, (current) => ({ ...(current ?? sent), status: "working" }));
  return { status: receipt ? "verified" : "unknown", evidenceRefs: receipt ? [`domain-message:${receipt.id}`] : [] };
}

/** His own words for a run he asked for, or empty when its outcome was written by Flyd (a tool's brief, a follow-up, a stand-in). */
function hisWords(request: DomainRun["request"]): string {
  // The window's addressing lines ("About the artefact …", "Answer to pending decision …") are plumbing he never typed.
  const typed = plainNote(request.originalMessage);
  const first = typed.words.split("\n").find((line) => line.trim())?.trim() ?? "";
  if (request.source === "view") return deskWords(request) && (typed.words !== request.originalMessage ? first : deskWords(request));
  if (request.source === "chat" && request.originalMessage.trim() !== request.intendedOutcome.trim()) return first;
  return "";
}

export async function decideRun(
  run: DomainRun,
  send: typeof sendRunMessage,
  complete: (prompt: string) => Promise<string> = async (prompt) => (await import("../lib/llm.js")).quickQuery(prompt, { json: true }),
): Promise<ExecutiveDecisionRecord> {
  const result = run.result;
  const detail = [result?.brief, ...(result?.unresolvedQuestions ?? []), ...(result?.risks ?? [])].filter(Boolean).join("\n").slice(0, 2_000);
  const active = isOpen(run.status);
  const report = run.request.domain === "knowledge" && run.status === "completed" && Boolean(result?.detailedReport.trim());
  // His recorded words: the routine calls they settle are answered for him (FLYD_STANDING_RULES=0 off; never under test).
  const standing = process.env.FLYD_STANDING_RULES === "0" || process.env.VITEST ? undefined : standingPreferences();
  return processFirstmateChange({
    sourceId: run.transport.kind === "firstmate" ? "firstmate.change" : `domain.${run.request.domain}`,
    eventId: `domain-run:${run.id}:${run.status}`,
    taskId: run.id,
    kind: run.status === "needs_decision" ? "decision" : "reply",
    state: run.status,
    label: run.request.intendedOutcome,
    request: hisWords(run.request),
    detail: [detail, ...(result?.evidence ?? [])].join("\n"),
    evidenceRefs: [`domain-run:${run.id}`],
    authority: authorityForStaffRun({
      runId: run.id,
      firstmate: run.transport.kind === "firstmate" && run.request.domain === "coding",
      active,
      autonomy: (await import("../runtime/tool-policy.js")).autonomyLevel(),
      ...(standing !== undefined ? { standing } : {}),
    }),
    sentToBoss: notesSentToBoss(run.messages),
    ...(standing !== undefined ? { standing } : {}),
    ...(result?.unresolvedQuestions?.length || result?.risks?.length ? { unresolved: true } : {}),
    ...(report ? { requested: true, verification: { status: "verified" as const, evidenceRefs: [`domain-report:${run.id}`] } } : {}),
  }, {
    complete,
    jev: { ...(process.env.FLYD_JEV_MODEL ? { model: process.env.FLYD_JEV_MODEL } : {}) },
    executeInternalAction: async (action) => {
      if (action.target !== run.id || action.capability !== "firstmate.message" || !active) return { status: "failed", evidenceRefs: [] };
      return deliverBossNote(run, action, send);
    },
  });
}

/** The notification a decision makes: the run's report, delivered as its lead line (runtime/delivery.ts); none when held. */
function noticeForDecision(run: DomainRun, decision: ExecutiveDecisionRecord): string | null {
  if (!decision.show || !decision.notify) return null;
  // Finished work's checked line is the report's lead, its link kept whole (runtime/delivery.ts).
  return deliver(reportFromRun(run, decision), "notification").text;
}

/** The project a run is about, by name or folder. */
function projectOf(run: DomainRun): string | undefined {
  return run.request.project?.name || run.request.project?.root || undefined;
}

export type ReadAttention = () => Promise<Focus>;
const readAttention: ReadAttention = async () => readFocus(await readSignals());

/** When a run's report is told, from what George is focused on; told now when focus cannot be read. */
async function whenToTell(run: DomainRun, decision: ExecutiveDecisionRecord, attention: ReadAttention): Promise<{ timing: Timing; focus?: Focus }> {
  const focus = await attention().catch(() => undefined);
  if (!focus) return { timing: { when: "now" } };
  const project = projectOf(run);
  const report = reportFromRun(run, decision);
  const kind = (decision.disposition === "ask_george" && callKind([report.outcome, decision.summary].join("\n"))) || report.kind;
  // His call on the work he is on blocks it.
  const blocking = decision.disposition === "ask_george" && sameProject(project, focus.project);
  return { timing: timing({ ...(project ? { project } : {}), kind, blocking }, focus), focus };
}

/** Work he started from the window, with the window open on that conversation: his reply shows under his message there. */
function shownInWindow(run: DomainRun, windowIsOpen: (session: string) => boolean = (session) => windowOpen(session)): boolean {
  return run.request.source === "view" && run.request.session !== undefined && windowIsOpen(run.request.session);
}

/** Backstage: Flyd's own note to the staff, or its own fix. Its finished work is never George's to hear. */
function backstageRun(run: DomainRun): boolean {
  return run.request.source === "flyd" || run.request.source === "self-improvement";
}

/** Finished work never told: Flyd's own, or shown under his message in the conversation it was asked from. */
function quietRun(run: DomainRun, windowIsOpen: (session: string) => boolean = (session) => windowOpen(session)): boolean {
  return backstageRun(run) || shownInWindow(run, windowIsOpen);
}

/**
 * Reviews a run's due report and tells George only what the executive record says needs his attention, each report
 * once (runtime/delivered.ts). The report record (command/report.ts) says where it got to.
 */
export async function notifyRun(
  run: DomainRun,
  notify?: Notify,
  send: typeof sendRunMessage = sendRunMessage,
  decide: RunDecisionStep = decideRun,
  windowIsOpen: (session: string) => boolean = (session) => windowOpen(session),
  attention: ReadAttention = readAttention,
): Promise<void> {
  if (!run.result || !cameBack(run.status)) return;
  // A run with a report record is reviewed only while it is due; one written before the record by its legacy flag.
  if (run.report ? !reportDue(run) : run.notified) return;
  const from = run.report;
  // Work done for a Chief of Staff objective is the objective's to report (command/cos/tick.ts), never told on its own.
  if (run.request.objectiveId && cosEnabled()) {
    const objective = readObjective(run.request.objectiveId);
    if (objective && followsRun(objective, run.id)) {
      if (from) moveReport(run.id, from, { state: "quiet" });
      return;
    }
  }
  // His own message from the conversation window: with the window open on that conversation the reply shows under it
  // there, so a notice would say it twice; otherwise he hears it like any other result.
  // Flyd's own note to the staff, and its own fixes, are backstage: their replies settle them and are never his to hear.
  if (quietRun(run, windowIsOpen)) {
    // Recorded as handled, so nothing tells it later either.
    if (run.status === "completed") markTold([finishedKey(run.id, from?.since)]);
    mutateDomainRun(run.id, (current) => {
      const { told: _told, ...rest } = current ?? run;
      return { ...rest, notified: true };
    });
    if (from) moveReport(run.id, from, { state: "quiet" });
    return;
  }
  // Under review: a restart that cuts it off leaves it "reviewing", and the next tick reviews it again.
  const reviewing = from ? moveReport(run.id, from, { state: "reviewing" }) : null;
  if (from && !reviewing) return;
  const base = reviewing?.report ?? from;
  let decision: ExecutiveDecisionRecord;
  try {
    decision = await decide(run, send);
  } catch {
    // The durable result remains in the command store; a review that keeps failing is given up, not retried forever.
    if (base) {
      const tries = (base.tries ?? 0) + 1;
      moveReport(run.id, base, { state: tries >= MAX_REVIEW_TRIES ? "gave_up" : "due", tries });
    }
    return;
  }
  // Work sent back to its boss stays open: the boss's next reply is a new outcome, decided afresh.
  if (decision.action && decision.verification.status === "verified") {
    if (base) moveReport(run.id, base, { state: "quiet", sentBack: true, decisionId: decision.decisionId });
    return;
  }
  try {
    await tellRun(reviewing ?? run, decision, { ...(notify ? { notify } : {}), attention });
  } catch {
    // Left where it got to: a report "sending" is said again by the tick's sweep, one still "reviewing" reviewed again.
  }
}

/**
 * Moves a run's report on, only while it is still the report `from` names: a newer outcome's report (written by a
 * sync meanwhile) is never overwritten by an older one's. With no `from`, the run's current report is moved, and one
 * is made for its current outcome when it has none. Returns the run as saved, or null when nothing was written.
 */
function moveReport(id: string, from: RunReport | undefined, change: Partial<RunReport> & { state: RunReport["state"] }, now = new Date()): DomainRun | null {
  let wrote = false;
  const saved = mutateDomainRun(id, (current) => {
    if (!current) return null;
    const base = current.report ?? from ?? { state: "due" as const, status: current.status, since: current.updatedAt, at: current.updatedAt };
    if (from && current.report && !sameReport(current.report, from)) return null;
    wrote = true;
    return { ...current, report: { ...base, ...change, at: now.toISOString() } };
  });
  return wrote ? saved : null;
}

/** A delivery log state as the run's report state; a report the log never heard of is still being sent. */
function reportState(state: DeliveryState | undefined): RunReport["state"] {
  return state ?? "sending";
}

/**
 * Tells George a reviewed run's report, once: held for a natural break or said now (runtime/attention.ts), and the
 * run's report record says what became of it: shown only when he saw it. Shared by notifyRun and the Chief of
 * Staff's objective reports.
 */
export async function tellRun(
  run: DomainRun,
  decision: ExecutiveDecisionRecord,
  options: { notify?: Notify; attention?: ReadAttention; key?: string } = {},
): Promise<{ notice: string | null; owed: boolean; waiting: boolean }> {
  // Settled once George was told, or quietly when nothing is left for him or Flyd; otherwise Flyd holds it in view.
  const notice = noticeForDecision(run, decision);
  const unsettled = run.status !== "completed" || decision.disposition === "ask_george" || decision.show && decision.notify
    || decision.action !== undefined || decision.reason === FENCE_HELD || decision.reason === HELD_FOR_ATTENTION;
  // The report this telling belongs to: the run's own, or (a Chief of Staff report on a run without one) its current outcome's.
  const from = run.report;
  let owed = false;
  let waiting = false;
  if (notice) {
    const kind = decision.disposition === "ask_george" ? "decision" : noticeKind(run);
    // A run's finished work is one report per outcome, whatever its domain; anything else is one per decision. A restart never says either twice.
    const report: DeliveryReport = {
      key: options.key ?? (decision.delivery ? finishedKey(run.id, from?.since) : `run:${run.id}:${createHash("sha256").update(notice).digest("hex").slice(0, 16)}`),
      line: notice, kind, work: run.request.intendedOutcome, evidenceRefs: decision.evidenceRefs,
    };
    const told: Partial<RunReport> = { key: report.key, line: notice, kind, work: report.work!, evidenceRefs: report.evidenceRefs ?? [], decisionId: decision.decisionId };
    // When follows what he is focused on: held for a natural break, or now as the notice (its lead line and link).
    const { timing: when, focus } = await whenToTell(run, decision, options.attention ?? readAttention);
    if (when.when === "held") {
      holdReport(report, {
        until: when.until, ...(focus?.project ? { focus: focus.project } : {}),
        finished: kind === "deliverable", run: run.id, decisionId: decision.decisionId,
      });
      moveReport(run.id, from, { ...told, state: "held" });
      waiting = true;
    } else {
      // Recorded as being sent before it is said: a restart mid-send leaves it "sending", which the tick says again.
      moveReport(run.id, from, { ...told, state: "sending" });
      const delivered = await deliverOnce([report], { ...(options.notify ? { say: (title, message, said) => options.notify!(title, message, said) } : {}) });
      owed = delivered.owed.length > 0;
      moveReport(run.id, from, { ...told, state: reportState(delivered.states[report.key]) });
    }
  } else {
    if (unsettled) recordHeld({ surface: "notification", source: `domain:${run.id}`, text: run.request.intendedOutcome }, []);
    moveReport(run.id, from, { state: "quiet", decisionId: decision.decisionId });
  }
  // Legacy flags, written for one release: a report not delivered yet is never marked notified (the tick says it
  // again); one held for a break is told by the tick when his focus breaks (tellHeld).
  if (!owed) {
    mutateDomainRun(run.id, (current) => {
      const { told: _told, ...rest } = current ?? run;
      return { ...rest, notified: true, ...(notice && !waiting ? { told: { line: notice, decisionId: decision.decisionId } } : {}) };
    });
  }
  return { notice, owed, waiting };
}

/** Whether a report held for a break is still worth telling: its run has not moved on, and he has not answered it since. */
function stillRelevant(entry: { key: string; at: string; held: { run?: string } }, readRun: (id: string) => DomainRun | null): boolean {
  if (!entry.held.run) return true;
  const run = readRun(entry.held.run);
  if (!run) return false;
  // A newer outcome, or one already told another way, or the run's status changed under it.
  if (run.report ? run.report.key !== entry.key || run.report.state !== "held" || run.report.status !== run.status : !cameBack(run.status)) return false;
  // He answered it (a decision, a correction) after it was held.
  return !(run.messages ?? []).some((message) => message.from !== "flyd" && message.at > entry.at);
}

/**
 * Tells held reports whose wait is over, together as one delivery, and records what became of each run's report. A
 * held report whose run moved on, or whose call he already answered, is withdrawn instead: it never rings.
 */
export async function tellHeld(attention: ReadAttention = readAttention, notify?: Notify, readRun: (id: string) => DomainRun | null = (id) => readDomainRun(id)): Promise<void> {
  const all = heldReports();
  if (!all.length) return;
  const held = all.filter((entry) => {
    if (stillRelevant(entry, readRun)) return true;
    withdrawReport(entry.key);
    if (entry.held.run) moveReportFor(entry.held.run, entry.key, "withdrawn");
    return false;
  });
  if (!held.length) return;
  const due = released(held.map((report) => ({ ...report, heldAt: Date.parse(report.at), until: report.held.until, ...(report.held.focus ? { focus: report.held.focus } : {}), ...(report.held.finished ? { finished: true } : {}) })), await attention());
  if (!due.length) return;
  const { told, owed, states } = await deliverOnce(due, { together: (claimed) => batch(due.filter((report) => claimed.some((said) => said.key === report.key))), ...(notify ? { say: (title, message, said) => notify(title, message, said) } : {}) });
  for (const report of told) {
    const entry = held.find((item) => item.key === report.key);
    const runId = entry?.held.run;
    if (!runId) continue;
    moveReportFor(runId, report.key, reportState(states[report.key]));
    // Legacy flag, written for one release.
    if (!owed.some((left) => left.key === report.key)) updateDomainRun(runId, (current) => ({ ...current, told: { line: report.line, decisionId: entry?.held.decisionId ?? "" } }));
  }
}

/** Moves a run's report on, only while it is still the one telling `key`. */
function moveReportFor(runId: string, key: string, state: RunReport["state"]): void {
  const run = readDomainRun(runId);
  if (run?.report?.key === key && run.report.state !== state) moveReport(runId, run.report, { state });
}

/**
 * Reviews every due report: written with its outcome, so one whose run settled just before a restart, or whose
 * review was cut off, is still told. The sweep, not the sync's callback, is what tells George.
 */
export async function tellDue(options: { notify?: Notify; runs?: DomainRun[]; decide?: RunDecisionStep; windowIsOpen?: (session: string) => boolean; attention?: ReadAttention } = {}): Promise<void> {
  for (const run of (options.runs ?? listDomainRuns()).filter(reportDue)) {
    await notifyRun(run, options.notify, sendRunMessage, options.decide, options.windowIsOpen, options.attention).catch(() => undefined);
  }
}

/**
 * Brings every report still under way up to date with the delivery log: one cut off before it was claimed is said
 * now, and one the log settled (shown, screened, given up, briefed, withdrawn) is recorded so.
 */
export async function settleReports(runs: DomainRun[] = listDomainRuns(), notify?: Notify): Promise<void> {
  for (const run of runs) {
    const report = run.report;
    if (!report?.key || !OPEN_REPORT_STATES.includes(report.state)) continue;
    let state = deliveryState(report.key);
    if (report.state === "sending" && state === undefined && report.line) {
      // Cut off between being recorded as sending and being claimed: said now, once.
      const delivered = await deliverOnce([{ key: report.key, line: report.line, ...(report.kind ? { kind: report.kind } : {}), ...(report.work ? { work: report.work } : {}), evidenceRefs: report.evidenceRefs ?? [] }], { ...(notify ? { say: (title, message, said) => notify(title, message, said) } : {}) }).catch(() => undefined);
      state = delivered?.states[report.key];
    }
    if (state && state !== report.state) moveReport(run.id, report, { state });
  }
}

export async function commandTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Once ever, before anything is told: runs already finished when this shipped are recorded as told without ringing.
    if (!seeded) {
      try {
        seedOnce(listDomainRuns().filter((run) => run.status === "completed").map((run) => finishedKey(run.id)));
        seeded = true;
      } catch {
        // Tried again next tick.
      }
    }
    // Each sync writes a new outcome with its report due, in the same commit; the sweep below tells it.
    await Promise.all([
      syncFirstmateDomainRuns(),
      syncLibrarianDomainRuns(),
      syncDesignMateRuns(),
    ]);
    await tellDue().catch(() => undefined);
    // Every report still owed (left undelivered, or cut off mid-send) is said again, from the first tick at Core start on.
    await deliverOwed().catch(() => undefined);
    await settleReports().catch(() => undefined);
    // The Chief of Staff's objectives: intake, dispatch and one report each (FLYD_COS=1; a no-op otherwise).
    await (await import("./cos/tick.js")).cosTick().catch(() => undefined);
    // Reports held for a natural break are told once his focus breaks, together.
    await tellHeld().catch(() => undefined);
  } finally {
    running = false;
  }
}

export function startCommandScheduler(options: { intervalMs?: number; onError?: (error: unknown) => void } = {}): () => void {
  stopCommandScheduler();
  const tick = () => void commandTick().catch((error) => options.onError?.(error));
  timer = setInterval(tick, options.intervalMs ?? 15_000);
  timer.unref?.();
  tick();
  return stopCommandScheduler;
}

export function stopCommandScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
