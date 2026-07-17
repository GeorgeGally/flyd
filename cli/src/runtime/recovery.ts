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
}

export function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

export function workerProcessIsAlive(
  worker: WorkerSession,
  readCommand: (processId: number) => string = (processId) =>
    execFileSync("ps", [ "-p", String(processId), "-o", "command=" ], { encoding: "utf8", timeout: 1_000 }).trim(),
): boolean {
  if (!worker.processId || !processIsAlive(worker.processId)) return false;
  try {
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
    if (worker.processId && input.isProcessAlive(worker.processId, worker)) continue;
    await input.transition(worker.workerKey, {
      status: "interrupted",
      error: "Flyd restarted after the worker process ended",
      idempotencyKey: `worker-recovery:${worker.workerKey}:${worker.processId ?? "not-started"}`,
    });
    recovered += 1;
  }
  return recovered;
}
