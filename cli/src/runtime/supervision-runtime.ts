import { createRuntimePool } from "./database.js";
import { startContinuousSupervisor, type ContinuousSupervisor } from "./continuous-supervisor.js";

let supervisor: ContinuousSupervisor | null = null;
let pool: ReturnType<typeof createRuntimePool> | null = null;

export function ensureContinuousSupervisionStarted(): void {
  if (supervisor) return;
  pool = createRuntimePool(undefined, { connectionTimeoutMillis: 500 });
  supervisor = startContinuousSupervisor(pool, {
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      // No runtime database on this machine: say so once and stop polling,
      // rather than logging the same failure every few seconds forever.
      if (/database "[^"]+" does not exist|ECONNREFUSED/.test(message)) {
        console.warn(`[Flyd Core] Operational supervision off: ${message}`);
        void stopContinuousSupervision();
        return;
      }
      console.warn("[Flyd Core] Operational supervision sweep failed:", message);
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
