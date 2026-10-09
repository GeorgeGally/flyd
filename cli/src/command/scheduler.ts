import { syncFirstmateDomainRuns } from "./firstmate.js";
import { syncLibrarianDomainRuns } from "./librarian.js";
import { saveDomainRun } from "./store.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function notifyRun(run: Awaited<ReturnType<typeof syncFirstmateDomainRuns>>[number]): Promise<void> {
  if (!run.result || run.notified || !["completed", "failed", "needs_decision"].includes(run.status)) return;
  try {
    const { notifyMac } = await import("../runtime/agenda.js");
    const prefix = run.status === "needs_decision"
      ? "I need your decision: "
      : run.status === "failed"
        ? "Work hit a problem: "
        : "";
    await notifyMac("Flyd", `${prefix}${run.result.brief}`);
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
