import { bossMessageKind, HELD_FOR_ATTENTION, notesSentToBoss, recommendationText } from "../intelligence/executive/decision-step.js";
import { recordHeld } from "../council/reply-review.js";
import { syncFirstmateDomainRuns } from "./firstmate.js";
import { syncLibrarianDomainRuns } from "./librarian.js";
import { sendRunMessage } from "./messages.js";
import { noticeKind } from "./notice.js";
import type { GeorgeKind } from "../lib/reaches-george.js";
import { readDomainRun, saveDomainRun } from "./store.js";
import type { DomainRun } from "./types.js";
import { notificationLine } from "../council/chief-of-staff.js";
import { relayShortfalls } from "../runtime/honesty-check.js";
import { authorityForStaffRun, processFirstmateChange } from "../intelligence/executive/firstmate-decision.js";
import type { ExecutiveDecisionRecord, ExecutiveInternalAction } from "../intelligence/executive/decision-step.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

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
  return processFirstmateChange({
    sourceId: run.transport.kind === "firstmate" ? "firstmate.change" : `domain.${run.request.domain}`,
    eventId: `domain-run:${run.id}:${run.status}`,
    taskId: run.id,
    kind: run.status === "needs_decision" ? "decision" : "reply",
    state: run.status,
    label: run.request.intendedOutcome,
    detail: [detail, ...(result?.evidence ?? [])].join("\n"),
    evidenceRefs: [`domain-run:${run.id}`],
    authority: authorityForStaffRun({
      runId: run.id,
      firstmate: run.transport.kind === "firstmate" && run.request.domain === "coding",
      active,
      autonomy: (await import("../runtime/tool-policy.js")).autonomyLevel(),
    }),
    sentToBoss: notesSentToBoss(run.messages),
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
  const said = decision.question
    ? `${decision.question}${decision.recommendation ? ` ${recommendationText(decision.recommendation)}` : ""}`
    : decision.summary;
  const line = notificationLine(said);
  return line && relayShortfalls(line).length === 0 ? line : null;
}

/** Tells George only what the executive record says needs his attention. */
export async function notifyRun(
  run: DomainRun,
  notify?: Notify,
  send: typeof sendRunMessage = sendRunMessage,
  decide: RunDecisionStep = decideRun,
): Promise<void> {
  if (!run.result || run.notified || !["completed", "failed", "needs_decision"].includes(run.status)) return;
  try {
    const decision = await decide(run, send);
    const notice = noticeForDecision(decision);
    if (notice) await (notify ?? (await import("../runtime/agenda.js")).notifyMac)("Flyd", notice, decision.disposition === "ask_george" ? "decision" : noticeKind(run));
    // Work sent back to its boss stays open: the boss's next reply is decided afresh.
    if (decision.action && decision.verification.status === "verified") return;
    if (decision.action || decision.reason === HELD_FOR_ATTENTION) {
      recordHeld({ surface: "notification", source: `domain:${run.id}`, text: run.request.intendedOutcome }, []);
    }
    saveDomainRun({ ...(readDomainRun(run.id) ?? run), notified: true });
  } catch {
    // The durable result remains in the command store; notification is best effort.
  }
}

export async function commandTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await Promise.all([
      syncFirstmateDomainRuns({ onChanged: notifyRun }),
      syncLibrarianDomainRuns({ onChanged: notifyRun }),
    ]);
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
