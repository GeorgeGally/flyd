import { execFileSync } from "child_process";
import { resolve } from "path";
import type { WorkerSession } from "./types.js";

interface RecoveryInput {
  workers: WorkerSession[];
  isProcessAlive(processId: number, worker: WorkerSession): boolean;
  transition(workerKey: string, update: {
    status: "interrupted";
    error: string;
    idempotencyKey: string;
  }): Promise<WorkerSession>;
  terminateProcessGroup?(worker: WorkerSession): Promise<void>;
  now?: () => Date;
}

const ACTIVE_SUPERVISOR_LEASE_MS = 10_000;

export function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

export function processGroupIsAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
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

export function workerProcessGroupBelongsToWorker(worker: WorkerSession): boolean {
  const processGroupId = worker.processGroupId;
  if (!processGroupId || !worker.executablePath) return false;
  try {
    const rows = execFileSync("ps", [ "-axo", "pid=,pgid=,command=" ], { encoding: "utf8", timeout: 1_000 });
    const members = rows.split("\n").filter(Boolean).flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return match && Number(match[2]) === processGroupId ? [ { pid: Number(match[1]), command: match[3] } ] : [];
    });
    const escaped = worker.executablePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (members.some((member) => new RegExp(`(^|[\\s"'])${escaped}(?=$|[\\s"'])`).test(member.command))) return true;
    const worktree = resolve(worker.workingDirectory);
    return members.some((member) => {
      try {
        const cwd = execFileSync("/usr/sbin/lsof", [ "-a", "-p", String(member.pid), "-d", "cwd", "-Fn" ], {
          encoding: "utf8", timeout: 1_000,
        }).split("\n").find((line) => line.startsWith("n"))?.slice(1);
        return cwd ? resolve(cwd) === worktree : false;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function workerProcessIsAlive(
  worker: WorkerSession,
  readCommand: (processId: number) => string = (processId) =>
    execFileSync("ps", [ "-p", String(processId), "-o", "command=" ], { encoding: "utf8", timeout: 1_000 }).trim(),
  readIdentity: (processId: number) => string | null = readProcessIdentity,
  groupBelongsToWorker: (worker: WorkerSession) => boolean = workerProcessGroupBelongsToWorker,
): boolean {
  if ((!worker.processId || !processIsAlive(worker.processId)) && worker.processGroupId) {
    return processGroupIsAlive(worker.processGroupId) && groupBelongsToWorker(worker);
  }
  if (!worker.processId) return false;
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

export async function terminateWorkerProcessGroup(worker: WorkerSession, graceMs = 2_000): Promise<void> {
  const processGroupId = worker.processGroupId ?? worker.processId;
  if (!processGroupId) return;
  if (!workerProcessIsAlive(worker)) return;
  if (worker.processGroupId && !workerProcessGroupBelongsToWorker(worker)) return;
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-processGroupId, name);
    } catch {
      try {
        process.kill(processGroupId, name);
      } catch {
        // The process settled between the liveness check and the signal.
      }
    }
  };
  signal("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  if (processGroupIsAlive(processGroupId) &&
      (!worker.processGroupId || workerProcessGroupBelongsToWorker(worker))) signal("SIGKILL");
}

export async function recoverInterruptedWorkers(input: RecoveryInput): Promise<number> {
  let recovered = 0;
  for (const worker of input.workers) {
    // Confirm a negative observation once before treating a persisted worker as dead.
    const processAlive = worker.processId && (
      input.isProcessAlive(worker.processId, worker) ||
      input.isProcessAlive(worker.processId, worker)
    );
    if (processAlive) {
      if (!input.terminateProcessGroup) continue;
      const observedAt = worker.lastObservedAt ? Date.parse(worker.lastObservedAt) : Number.NaN;
      const elapsedSinceObservation = (input.now?.() ?? new Date()).getTime() - observedAt;
      if (Number.isFinite(observedAt) && elapsedSinceObservation >= 0 && elapsedSinceObservation < ACTIVE_SUPERVISOR_LEASE_MS) {
        continue;
      }
      await input.terminateProcessGroup(worker);
      await input.transition(worker.workerKey, {
        status: "interrupted",
        error: "Flyd restarted and terminated an orphaned worker process group",
        idempotencyKey: `worker-recovery:${worker.workerKey}:${worker.processGroupId ?? worker.processId}:orphaned`,
      });
      recovered += 1;
      continue;
    }
    await input.transition(worker.workerKey, {
      status: "interrupted",
      error: "Flyd restarted after the worker process ended",
      idempotencyKey: `worker-recovery:${worker.workerKey}:${worker.processId ?? "not-started"}`,
    });
    recovered += 1;
  }
  return recovered;
}
