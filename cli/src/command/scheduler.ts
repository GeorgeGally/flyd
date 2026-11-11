import { createHash } from "node:crypto";
import { bossMessageKind, FENCE_HELD, HELD_FOR_ATTENTION, notesSentToBoss } from "../intelligence/executive/decision-step.js";
import { recordHeld } from "../council/reply-review.js";
import { syncFirstmateDomainRuns } from "./firstmate.js";
import { syncDesignMateRuns } from "./design-mate.js";
import { syncLibrarianDomainRuns } from "./librarian.js";
import { sendRunMessage } from "./messages.js";
import { noticeKind } from "./notice.js";
import type { GeorgeKind } from "../lib/reaches-george.js";
import { listDomainRuns, mutateDomainRun, updateDomainRun } from "./store.js";
import { cameBack, isOpen } from "./run-state.js";
import type { DomainRun } from "./types.js";
import { cosEnabled, readObjective } from "./cos/objectives.js";
import { followsRun } from "./cos/plan.js";
import { deliver, reportFromRun } from "../runtime/delivery.js";
import { authorityForStaffRun, processFirstmateChange } from "../intelligence/executive/firstmate-decision.js";
import { standingPreferences } from "../intelligence/executive/standing-rules.js";
import type { ExecutiveDecisionRecord, ExecutiveInternalAction } from "../intelligence/executive/decision-step.js";
import { deliverOnce, deliverOwed, finishedKey, heldReports, holdReport, markTold, seedOnce, type DeliveryReport } from "../runtime/delivered.js";
import { batch, callKind, readFocus, readSignals, released, sameProject, timing, type Focus, type Timing } from "../runtime/attention.js";
import { windowOpen } from "../conversation-view/window-presence.js";
import { deskWords } from "../conversation-view/firstmate-inbox.js";
import { plainNote } from "../conversation-view/rail.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let seeded = false;

type Notify = (title: string, message: string, kind?: GeorgeKind) => Promise<void>;

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

/** Tells George only what the executive record says needs his attention, each report once (runtime/delivered.ts). */
export async function notifyRun(
  run: DomainRun,
  notify?: Notify,
  send: typeof sendRunMessage = sendRunMessage,
  decide: RunDecisionStep = decideRun,
  windowIsOpen: (session: string) => boolean = (session) => windowOpen(session),
  attention: ReadAttention = readAttention,
): Promise<void> {
  if (!run.result || run.notified || !cameBack(run.status)) return;
  // Work done for a Chief of Staff objective is the objective's to report (command/cos/tick.ts), never told on its own.
  if (run.request.objectiveId && cosEnabled()) {
    const objective = readObjective(run.request.objectiveId);
    if (objective && followsRun(objective, run.id)) return;
  }
  // His own message from the conversation window: with the window open on that conversation the reply shows under it
  // there, so a notice would say it twice; otherwise he hears it like any other result.
  // Flyd's own note to the staff, and its own fixes, are backstage: their replies settle them and are never his to hear.
  if (quietRun(run, windowIsOpen)) {
    // Recorded as handled, so nothing tells it later either.
    if (run.status === "completed") markTold([finishedKey(run.id)]);
    mutateDomainRun(run.id, (current) => {
      const { told: _told, ...rest } = current ?? run;
      return { ...rest, notified: true };
    });
    return;
  }
  try {
    const decision = await decide(run, send);
    // Work sent back to its boss stays open: the boss's next reply is decided afresh.
    if (decision.action && decision.verification.status === "verified") return;
    await tellRun(run, decision, { ...(notify ? { notify } : {}), attention });
  } catch {
    // The durable result remains in the command store; notification is best effort.
  }
}

/**
 * Tells George a reviewed run's report, once: held for a natural break or said now (runtime/attention.ts), then the run
 * is marked notified with the line he was told. Shared by notifyRun and the Chief of Staff's objective reports.
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
  let owed = false;
  let waiting = false;
  if (notice) {
    const kind = decision.disposition === "ask_george" ? "decision" : noticeKind(run);
    // A run's finished work is one report, whatever its domain; anything else is one per decision. A restart never says either twice.
    const report: DeliveryReport = {
      key: options.key ?? (decision.delivery ? finishedKey(run.id) : `run:${run.id}:${createHash("sha256").update(notice).digest("hex").slice(0, 16)}`),
      line: notice, kind, work: run.request.intendedOutcome, evidenceRefs: decision.evidenceRefs,
    };
    // When follows what he is focused on: held for a natural break, or now as the notice (its lead line and link).
    const { timing: when, focus } = await whenToTell(run, decision, options.attention ?? readAttention);
    if (when.when === "held") {
      holdReport(report, {
        until: when.until, ...(focus?.project ? { focus: focus.project } : {}),
        finished: kind === "deliverable", run: run.id, decisionId: decision.decisionId,
      });
      waiting = true;
    } else {
      owed = (await deliverOnce([report], { ...(options.notify ? { say: (title, message, said) => options.notify!(title, message, said) } : {}) })).owed.length > 0;
    }
  } else if (unsettled) recordHeld({ surface: "notification", source: `domain:${run.id}`, text: run.request.intendedOutcome }, []);
  // A report not delivered yet is never marked told; the command tick's sweep says it again (deliverOwed).
  // One held for a break is told by the tick when his focus breaks (tellHeld), which records its line then.
  if (!owed) {
    mutateDomainRun(run.id, (current) => {
      const { told: _told, ...rest } = current ?? run;
      return { ...rest, notified: true, ...(notice && !waiting ? { told: { line: notice, decisionId: decision.decisionId } } : {}) };
    });
  }
  return { notice, owed, waiting };
}

/** Tells held reports whose wait is over, together as one delivery, and records each run's told line. */
export async function tellHeld(attention: ReadAttention = readAttention, notify?: Notify): Promise<void> {
  const held = heldReports();
  if (!held.length) return;
  const due = released(held.map((report) => ({ ...report, heldAt: Date.parse(report.at), until: report.held.until, ...(report.held.focus ? { focus: report.held.focus } : {}), ...(report.held.finished ? { finished: true } : {}) })), await attention());
  if (!due.length) return;
  const { told, owed } = await deliverOnce(due, { together: (claimed) => batch(due.filter((report) => claimed.some((said) => said.key === report.key))), ...(notify ? { say: (title, message, said) => notify(title, message, said) } : {}) });
  for (const report of told.filter((said) => !owed.some((left) => left.key === said.key))) {
    const runId = held.find((entry) => entry.key === report.key)?.held.run;
    if (runId) updateDomainRun(runId, (current) => ({ ...current, told: { line: report.line, decisionId: held.find((entry) => entry.key === report.key)?.held.decisionId ?? "" } }));
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
    await Promise.all([
      syncFirstmateDomainRuns({ onChanged: notifyRun }),
      syncLibrarianDomainRuns({ onChanged: notifyRun }),
      syncDesignMateRuns({ onChanged: notifyRun }),
    ]);
    // Every report still owed (left undelivered, or cut off mid-send) is said again, from the first tick at Core start on.
    await deliverOwed().catch(() => undefined);
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
