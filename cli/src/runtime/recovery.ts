import { execFileSync } from "child_process";
import type { WorkerSession } from "./types.js";

interface RecoveryInput {
  workers: WorkerSession[];
  isProcessAlive(processId: number, worker: WorkerSession): boolean;
  transition(workerKey: string, update: {
    status: "interrupted";
    error: string;
    idempotencyKey: string;
  }): Promise<WorkerSession>;
  now?: () => Date;
}

const TERMINAL_RESULT_GRACE_MS = 15_000;

export function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

export function readProcessIdentity(processId: number): string | null {
  try {
    const startedAt = execFileSync(
      "ps",
      [ "-p", String(processId), "-o", "lstart=" ],
      { encoding: "utf8", timeout: 1_000 },
    ).trim();
    return startedAt || null;
  } catch {
    return null;
  }
}

export function workerProcessIsAlive(
  worker: WorkerSession,
  readCommand: (processId: number) => string = (processId) =>
    execFileSync("ps", [ "-p", String(processId), "-o", "command=" ], { encoding: "utf8", timeout: 1_000 }).trim(),
  readIdentity: (processId: number) => string | null = readProcessIdentity,
): boolean {
  if (!worker.processId || !processIsAlive(worker.processId)) return false;
  try {
    if (!worker.processIdentity || readIdentity(worker.processId) !== worker.processIdentity) return false;
    const command = readCommand(worker.processId);
    const executable = worker.executablePath;
    if (!executable) return false;
    const escaped = executable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[\\s"'])${escaped}(?=$|[\\s"'])`).test(command);
  } catch {
    return false;
  }
}

export async function recoverInterruptedWorkers(input: RecoveryInput): Promise<number> {
  let recovered = 0;
  for (const worker of input.workers) {
    if (worker.processId && (
      input.isProcessAlive(worker.processId, worker) ||
      input.isProcessAlive(worker.processId, worker)
    )) continue;
    const observedAt = worker.lastObservedAt ? Date.parse(worker.lastObservedAt) : Number.NaN;
    const elapsedSinceObservation = (input.now?.() ?? new Date()).getTime() - observedAt;
    if (Number.isFinite(observedAt) &&
        elapsedSinceObservation >= 0 &&
        elapsedSinceObservation < TERMINAL_RESULT_GRACE_MS) continue;
    await input.transition(worker.workerKey, {
      status: "interrupted",
      error: "Flyd restarted after the worker process ended",
      idempotencyKey: `worker-recovery:${worker.workerKey}:${worker.processId ?? "not-started"}`,
    });
    recovered += 1;
  }
  return recovered;
}
