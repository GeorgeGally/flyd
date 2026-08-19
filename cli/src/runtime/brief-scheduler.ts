import { composeDailyBrief, persistDailyBrief, dailyBriefFile, type DailyBriefDeps } from "./daily-brief.js";

export interface BriefSchedulerConfig {
  intervalMs?: number;
  deps?: DailyBriefDeps;
  onError?: (error: unknown) => void;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export async function runAndPersistBrief(deps: DailyBriefDeps = {}): Promise<{ ok: boolean; file: string }> {
  try {
    const brief = await composeDailyBrief(deps);
    const file = persistDailyBrief(brief);
    return { ok: true, file };
  } catch (error) {
    if (deps.last30daysScript) {
      // keep last error observable, but a brief must never crash Core
      console.error(`[brief] compose failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { ok: false, file: dailyBriefFile() };
  }
}

// Runs the daily brief on a background interval and persists it, so the
// opening / /brief can show a fresh brief without blocking the session on
// network research. Not tied to the synchronous job runner (last30days is
// async). Caller owns lifecycle; returns a stop() handle.
export function startBriefScheduler(config: BriefSchedulerConfig = {}): () => void {
  if (intervalHandle) stopBriefScheduler();
  const intervalMs = config.intervalMs ?? 15 * 60 * 1000;
  const tick = (): void => {
    void runAndPersistBrief(config.deps).catch((error) => config.onError?.(error));
  };
  tick(); // run once immediately on start
  intervalHandle = setInterval(tick, intervalMs);
  intervalHandle.unref();
  return stopBriefScheduler;
}

export function stopBriefScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
