import { buildPresentModelBelief } from "../work/work-hypothesis/index.js";

export interface RepositoryIntelligenceSchedulerConfig {
  intervalMs?: number;
  refresh?: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export async function refreshRepositoryIntelligence(
  refresh: () => Promise<unknown> = () => buildPresentModelBelief({ coreCwd: process.cwd() }),
): Promise<{ ok: boolean }> {
  try {
    await refresh();
    return { ok: true };
  } catch (error) {
    console.warn(
      "[repository-intelligence] refresh failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false };
  }
}

/**
 * Keep the canonical work index + work hypothesis fresh while Core is alive.
 * Reuses buildPresentModelBelief(), which owns discovery, repository observation,
 * commit/activity distillation, task projection, and durable hypothesis refresh.
 *
 * Runs once immediately at Core start and then every six hours by default.
 * The timer is unref'd so repository intelligence never keeps Core alive.
 */
export function startRepositoryIntelligenceScheduler(
  config: RepositoryIntelligenceSchedulerConfig = {},
): () => void {
  if (intervalHandle) stopRepositoryIntelligenceScheduler();

  const intervalMs = config.intervalMs ?? 6 * 60 * 60 * 1000;
  const refresh = config.refresh ?? (() => buildPresentModelBelief({ coreCwd: process.cwd() }));
  const tick = (): void => {
    void refreshRepositoryIntelligence(refresh).then((result) => {
      if (!result.ok) config.onError?.(new Error("repository intelligence refresh failed"));
    });
  };

  tick();
  intervalHandle = setInterval(tick, intervalMs);
  intervalHandle.unref();
  return stopRepositoryIntelligenceScheduler;
}

export function stopRepositoryIntelligenceScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
