import { composeDailyBrief, persistDailyBrief, dailyBriefFile, type DailyBriefDeps } from "./daily-brief.js";
import {
  refreshRepositoryIntelligence,
  type RepositoryIntelligenceRefresh,
} from "./repository-intelligence-refresh.js";

// The morning brief belongs to George's local morning, on his working days.
// A fixed interval alone is time-blind: it fired on a Sunday afternoon with a
// morning greeting, because the loop ran once immediately on start and then
// every 24h from that moment. The gate below is the fix: compose only on a
// local weekday, only inside the local morning window, and only once per day.
export const BRIEF_WINDOW_START_HOUR = 7;
export const BRIEF_WINDOW_END_HOUR = 11;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

export interface BriefSchedulerConfig {
  intervalMs?: number;
  deps?: DailyBriefDeps;
  repositoryRefresh?: RepositoryIntelligenceRefresh;
  onError?: (error: unknown) => void;
  /** Compose on start regardless of the local clock (used by tests and `flyd brief`). */
  force?: boolean;
  /** Local hour the brief window opens/closes; defaults to 07:00–11:00. */
  windowStartHour?: number;
  windowEndHour?: number;
}

/** Local calendar day key, e.g. "2026-09-28" in the machine's timezone. */
export function localDayKey(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Mon–Fri, matching George's weekday brief routine. */
export function isLocalWeekday(now = new Date()): boolean {
  const day = now.getDay();
  return day >= 1 && day <= 5;
}

export function isBriefWindow(now = new Date(), startHour = BRIEF_WINDOW_START_HOUR, endHour = BRIEF_WINDOW_END_HOUR): boolean {
  return now.getHours() >= startHour && now.getHours() < endHour;
}

/** True when a brief is due now: local weekday, inside the local morning window, not already done today. */
export function briefDueNow(
  now = new Date(),
  lastRunDay?: string,
  startHour = BRIEF_WINDOW_START_HOUR,
  endHour = BRIEF_WINDOW_END_HOUR,
): boolean {
  if (!isLocalWeekday(now)) return false;
  if (!isBriefWindow(now, startHour, endHour)) return false;
  return lastRunDay !== localDayKey(now);
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
// Checks every 15 minutes by default and only does work when the local clock
// says a brief is due (local weekday, 07:00–11:00, once per day), so a Core
// start at any hour, a sleep/wake, or a fixed interval can't produce an
// off-hours "morning" brief. Pass force: true to compose immediately.
// Caller owns lifecycle; returns a stop() handle.
export function startBriefScheduler(config: BriefSchedulerConfig = {}): () => void {
  if (intervalHandle) stopBriefScheduler();
  const intervalMs = config.intervalMs ?? CHECK_INTERVAL_MS;
  const startHour = config.windowStartHour ?? BRIEF_WINDOW_START_HOUR;
  const endHour = config.windowEndHour ?? BRIEF_WINDOW_END_HOUR;
  let lastRunDay: string | undefined;
  const tick = (): void => {
    const now = new Date();
    if (!config.force && !briefDueNow(now, lastRunDay, startHour, endHour)) return;
    lastRunDay = localDayKey(now);
    void (async () => {
      await refreshRepositoryIntelligence(config.repositoryRefresh);
      await runAndPersistBrief(config.deps);
    })().catch((error) => config.onError?.(error));
  };
  tick(); // first chance at being due; the gate decides whether it composes
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
