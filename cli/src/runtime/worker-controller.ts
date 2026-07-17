import { workerProcessIsAlive } from "./recovery.js";
import type {
  WorkerCommand,
  WorkerCommandKind,
  WorkerSession,
} from "./types.js";

interface ControlStore {
  queueWorkerCommand(
    workerKey: string,
    kind: WorkerCommandKind,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ command: WorkerCommand; worker: WorkerSession }>;
  completeWorkerCommand(
    commandKey: string,
    input: { workerStatus: "stopped" | "interrupted" | "replaced" | null; error?: string },
  ): Promise<WorkerCommand>;
}

export async function controlWorker(input: {
  workerKey: string;
  kind: WorkerCommandKind;
  instruction?: string;
  idempotencyKey: string;
  killGraceMs?: number;
  deps: {
    store: ControlStore;
    isProcessAlive(worker: WorkerSession): boolean;
    signal(processId: number, signal: NodeJS.Signals): void;
    wait(milliseconds: number): Promise<void>;
  };
}): Promise<WorkerCommand> {
  const instruction = input.instruction?.trim();
  if (input.kind === "redirect" && !instruction) throw new Error("Redirect requires a focused instruction");
  const { command, worker } = await input.deps.store.queueWorkerCommand(
    input.workerKey,
    input.kind,
    instruction ? { instruction } : {},
    input.idempotencyKey,
  );
  if (command.status === "completed") return command;

  const shouldStop = [ "stop", "redirect", "replace" ].includes(input.kind);
  if (shouldStop && worker.processId && input.deps.isProcessAlive(worker)) {
    input.deps.signal(worker.processId, "SIGTERM");
    await input.deps.wait(input.killGraceMs ?? 5_000);
    if (input.deps.isProcessAlive(worker)) input.deps.signal(worker.processId, "SIGKILL");
  }
  const workerStatus = input.kind === "stop"
    ? "stopped"
    : input.kind === "redirect"
      ? "interrupted"
      : input.kind === "replace"
        ? "replaced"
        : null;
  return input.deps.store.completeWorkerCommand(command.commandKey, { workerStatus });
}

export function defaultWorkerControlDependencies(store: ControlStore) {
  return {
    store,
    isProcessAlive: (worker: WorkerSession) => workerProcessIsAlive(worker),
    signal: (processId: number, signal: NodeJS.Signals) => {
      process.kill(processId, signal);
    },
    wait: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  };
}
