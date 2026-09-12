import { composeDailyBrief, persistDailyBrief, dailyBriefFile, type DailyBriefDeps } from "./daily-brief.js";
import {
  refreshRepositoryIntelligence,
  type RepositoryIntelligenceRefresh,
} from "./repository-intelligence-refresh.js";

export interface BriefSchedulerConfig {
  intervalMs?: number;
  deps?: DailyBriefDeps;
  repositoryRefresh?: RepositoryIntelligenceRefresh;
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

// Core's lightweight daily maintenance loop. Repository intelligence refreshes
// first so the canonical work index, commit/activity distillation, and durable
// work hypothesis are current before the brief is composed. The brief remains
// independently best-effort; either maintenance task can fail without taking
// Core down.
//
// Runs once immediately on start, then once per day by default. Cadence is
// overridable via intervalMs. Caller owns lifecycle; returns a stop() handle.
export function startBriefScheduler(config: BriefSchedulerConfig = {}): () => void {
  if (intervalHandle) stopBriefScheduler();
  const intervalMs = config.intervalMs ?? 24 * 60 * 60 * 1000;
  const tick = (): void => {
    void (async () => {
      await refreshRepositoryIntelligence(config.repositoryRefresh);
      await runAndPersistBrief(config.deps);
    })().catch((error) => config.onError?.(error));
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
