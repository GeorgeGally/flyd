import { createHash } from "node:crypto";
import { bossMessageKind, FENCE_HELD, HELD_FOR_ATTENTION, notesSentToBoss, recommendationText } from "../intelligence/executive/decision-step.js";
import { recordHeld } from "../council/reply-review.js";
import { syncFirstmateDomainRuns } from "./firstmate.js";
import { syncDesignMateRuns } from "./design-mate.js";
import { syncLibrarianDomainRuns } from "./librarian.js";
import { sendRunMessage } from "./messages.js";
import { noticeKind } from "./notice.js";
import type { GeorgeKind } from "../lib/reaches-george.js";
import { listDomainRuns, readDomainRun, saveDomainRun } from "./store.js";
import type { DomainRun } from "./types.js";
import { notificationLine } from "../council/chief-of-staff.js";
import { relayShortfalls } from "../runtime/honesty-check.js";
import { authorityForStaffRun, processFirstmateChange } from "../intelligence/executive/firstmate-decision.js";
import { standingPreferences } from "../intelligence/executive/standing-rules.js";
import type { ExecutiveDecisionRecord, ExecutiveInternalAction } from "../intelligence/executive/decision-step.js";
import { deliverOnce, deliverOwed, finishedKey, markTold, seedOnce } from "../runtime/delivered.js";
import { windowOpen } from "../conversation-view/window-presence.js";

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
  if (receipt && outcome.run && run.status === "failed") saveDomainRun({ ...outcome.run, status: "working" });
  return { status: receipt ? "verified" : "unknown", evidenceRefs: receipt ? [`domain-message:${receipt.id}`] : [] };
}

export async function decideRun(
  run: DomainRun,
  send: typeof sendRunMessage,
  complete: (prompt: string) => Promise<string> = async (prompt) => (await import("../lib/llm.js")).quickQuery(prompt, { json: true }),
): Promise<ExecutiveDecisionRecord> {
  const result = run.result;
  const detail = [result?.brief, ...(result?.unresolvedQuestions ?? []), ...(result?.risks ?? [])].filter(Boolean).join("\n").slice(0, 2_000);
  const active = ["queued", "accepted", "working", "needs_decision", "incomplete", "failed"].includes(run.status);
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
    labelFromGeorge: true,
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

function noticeForDecision(decision: ExecutiveDecisionRecord): string | null {
  if (!decision.show || !decision.notify) return null;
  // Finished work is told in its own checked line, link and all.
  if (decision.delivery) return relayShortfalls(decision.delivery.line).length === 0 ? decision.delivery.line : null;
  const said = decision.question
    ? `${decision.question}${decision.recommendation ? ` ${recommendationText(decision.recommendation)}` : ""}`
    : decision.summary;
  const line = notificationLine(said);
  return line && relayShortfalls(line).length === 0 ? line : null;
}

/** Work he started from the window, with the window open on that conversation: his reply shows under his message there. */
export function shownInWindow(run: DomainRun, windowIsOpen: (session: string) => boolean = (session) => windowOpen(session)): boolean {
  return run.request.source === "view" && run.request.session !== undefined && windowIsOpen(run.request.session);
}

/** Backstage: Flyd's own note to the staff, or its own fix. Its finished work is never George's to hear. */
export function backstageRun(run: DomainRun): boolean {
  return run.request.source === "flyd" || run.request.source === "self-improvement";
}

/** Finished work never told: Flyd's own, or shown under his message in the conversation it was asked from. */
export function quietRun(run: DomainRun, windowIsOpen: (session: string) => boolean = (session) => windowOpen(session)): boolean {
  return backstageRun(run) || shownInWindow(run, windowIsOpen);
}

/** Tells George only what the executive record says needs his attention, each report once (runtime/delivered.ts). */
export async function notifyRun(
  run: DomainRun,
  notify?: Notify,
  send: typeof sendRunMessage = sendRunMessage,
  decide: RunDecisionStep = decideRun,
  windowIsOpen: (session: string) => boolean = (session) => windowOpen(session),
): Promise<void> {
  if (!run.result || run.notified || !["completed", "failed", "needs_decision"].includes(run.status)) return;
  // His own message from the conversation window: with the window open on that conversation the reply shows under it
  // there, so a notice would say it twice; otherwise he hears it like any other result.
  // Flyd's own note to the staff, and its own fixes, are backstage: their replies settle them and are never his to hear.
  if (quietRun(run, windowIsOpen)) {
    // Recorded as handled, so nothing tells it later either.
    if (run.status === "completed") markTold([finishedKey(run.id)]);
    saveDomainRun({ ...(readDomainRun(run.id) ?? run), notified: true });
    return;
  }
  try {
    const decision = await decide(run, send);
    // Work sent back to its boss stays open: the boss's next reply is decided afresh.
    if (decision.action && decision.verification.status === "verified") return;
    // Settled once George was told, or quietly when nothing is left for him or Flyd; otherwise Flyd holds it in view.
    const notice = noticeForDecision(decision);
    const unsettled = run.status !== "completed" || decision.disposition === "ask_george" || decision.show && decision.notify
      || decision.action !== undefined || decision.reason === FENCE_HELD || decision.reason === HELD_FOR_ATTENTION;
    let owed = false;
    if (notice) {
      const kind = decision.disposition === "ask_george" ? "decision" : noticeKind(run);
      // A run's finished work is one report, whatever its domain; anything else is one per decision. A restart never says either twice.
      owed = (await deliverOnce([{
        key: decision.delivery ? finishedKey(run.id) : `run:${run.id}:${createHash("sha256").update(notice).digest("hex").slice(0, 16)}`,
        line: notice, kind, work: run.request.intendedOutcome, evidenceRefs: decision.evidenceRefs,
      }], { ...(notify ? { say: (title, message, said) => notify(title, message, said) } : {}) })).owed.length > 0;
    } else if (unsettled) recordHeld({ surface: "notification", source: `domain:${run.id}`, text: run.request.intendedOutcome }, []);
    // A report not delivered yet is never marked told; the command tick's sweep says it again (deliverOwed).
    if (!owed) saveDomainRun({ ...(readDomainRun(run.id) ?? run), notified: true });
  } catch {
    // The durable result remains in the command store; notification is best effort.
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
