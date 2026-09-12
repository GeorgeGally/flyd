import { buildPresentModelBelief } from "../work/work-hypothesis/index.js";

export type RepositoryIntelligenceRefresh = () => Promise<unknown>;

/**
 * Refresh canonical repository observations and the durable work hypothesis.
 * This reuses the existing work-index path: discovery, Git observation,
 * commit/activity distillation, task projection, and hypothesis persistence.
 * It is best-effort because maintenance must never take Core down.
 */
export async function refreshRepositoryIntelligence(
  refresh: RepositoryIntelligenceRefresh = () => buildPresentModelBelief({ coreCwd: process.cwd() }),
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
