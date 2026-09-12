import { createRuntimePool } from "./database.js";
import { startContinuousSupervisor, type ContinuousSupervisor } from "./continuous-supervisor.js";

let supervisor: ContinuousSupervisor | null = null;
let pool: ReturnType<typeof createRuntimePool> | null = null;

export function ensureContinuousSupervisionStarted(): void {
  if (supervisor) return;
  pool = createRuntimePool(undefined, { connectionTimeoutMillis: 500 });
  supervisor = startContinuousSupervisor(pool, {
    onError: (error) => {
      console.warn("[Flyd Core] Operational supervision sweep failed:", error instanceof Error ? error.message : error);
    },
  });
}

export async function stopContinuousSupervision(): Promise<void> {
  supervisor?.stop();
  supervisor = null;
  if (pool) {
    const current = pool;
    pool = null;
    await current.end().catch(() => undefined);
  }
}
