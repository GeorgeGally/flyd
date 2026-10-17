import { syncFirstmateDomainRuns } from "./firstmate.js";
import { syncLibrarianDomainRuns } from "./librarian.js";
import { handsHimInternalDecision } from "../council/chief-of-staff.js";
import { recordHeld } from "../council/reply-review.js";
import { sendRunMessage } from "./messages.js";
import { captainNotice, plainBrief } from "./notice.js";
import { saveDomainRun } from "./store.js";
import type { DomainRun } from "./types.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

type Notify = (title: string, message: string) => Promise<void>;

/** What Flyd tells a domain boss that asked George for an implementation call. */
export const HANDLE_IT_YOURSELF = [
  "This is an implementation call, not one for George, so Flyd has not put it to him.",
  "Make it yourself in line with what he asked for, using the authority the run already has, and reply with the outcome.",
  "Only if it truly turns on what he wants, his money, his name, people he deals with, or something irreversible, reply needs_decision again saying why it is his, with your recommendation, and Flyd will bring it to him.",
].join(" ");

/**
 * A run that asks George to settle how the work is built or run goes back to
 * its boss instead of reaching him (the chief-of-staff standard: bring him
 * only his decisions). Once only, keyed on Flyd's own note: the run stays
 * unannounced, so the boss's next reply reaches him whatever it says.
 * Only a boss that replies (FirstMate) is sent anything back.
 */
async function returnedToBoss(run: DomainRun, send: typeof sendRunMessage): Promise<boolean> {
  if (run.status !== "needs_decision" || !run.result || run.transport.kind !== "firstmate") return false;
  // Flyd's check-ins on quiet work (fleet-monitor.ts) are questions, not this return.
  if (run.messages?.some((message) => message.from === "flyd" && message.kind === "decision")) return false;
  const brief = plainBrief(run.result.brief);
  if (!handsHimInternalDecision(brief)) return false;
  const outcome = await send({ run, kind: "decision", body: HANDLE_IT_YOURSELF, from: "flyd" }).catch(() => ({ delivered: false, run: undefined }));
  if (!outcome.delivered) return false;
  recordHeld({ surface: "notification", source: `domain:${run.id}`, text: `I need your decision: ${brief}` }, [{
    requirement: "decisions_handled", reason: "an implementation call; returned to the work instead of reaching him", quote: brief.slice(0, 240), by: "check",
  }]);
  return true;
}

/** Tells George about a settled run once; routine chatter is kept in the store, not shown. */
export async function notifyRun(run: DomainRun, notify?: Notify, send: typeof sendRunMessage = sendRunMessage): Promise<void> {
  if (!run.result || run.notified || !["completed", "failed", "needs_decision"].includes(run.status)) return;
  try {
    if (await returnedToBoss(run, send)) return;
    const notice = captainNotice(run);
    if (notice) await (notify ?? (await import("../runtime/agenda.js")).notifyMac)("Flyd", notice);
    saveDomainRun({ ...run, notified: true });
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
