import { syncFirstmateDomainRuns } from "./firstmate.js";
import { syncLibrarianDomainRuns } from "./librarian.js";
import { captainNotice } from "./notice.js";
import { saveDomainRun } from "./store.js";
import type { DomainRun } from "./types.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

type Notify = (title: string, message: string) => Promise<void>;

/** Tells George about a settled run once; routine chatter is kept in the store, not shown. */
export async function notifyRun(run: DomainRun, notify?: Notify): Promise<void> {
  if (!run.result || run.notified || !["completed", "failed", "needs_decision"].includes(run.status)) return;
  try {
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
