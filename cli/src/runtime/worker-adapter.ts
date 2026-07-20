import { spawn as nodeSpawn } from "child_process";
import type { SpawnOptionsWithoutStdio } from "child_process";

export type WorkerCapability =
  | "analysis"
  | "implementation"
  | "review"
  | "testing"
  | "resume";

export interface WorkerEvent {
  type: string;
  sessionId: string | null;
  text: string | null;
}

export interface WorkerHealth {
  name: string;
  executable: string;
  version: string;
  healthy: boolean;
  capabilities: WorkerCapability[];
  error?: string;
}

export interface WorkerRunResult {
  exitStatus: number;
  externalSessionId: string | null;
  output: string;
  error: string;
}

export interface WorkerCommandInput {
  assignment: string;
  projectRoot: string;
  taskKey: string;
  contextPath?: string;
  externalSessionId?: string;
}

export interface WorkerRunInput {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  inactivityTimeoutMs?: number;
  killGraceMs?: number;
  onEvent?: (event: WorkerEvent) => void;
  onStart?: (processId: number | null) => void | Promise<void>;
  onActivity?: () => void | Promise<void>;
  onTimeout?: (reason: "runtime" | "inactive") => void | Promise<void>;
}

export interface WorkerAdapter {
  name: string;
  capabilities: WorkerCapability[];
  detect(): Promise<WorkerHealth>;
  buildArgs(input: WorkerCommandInput): string[];
  parseEvent(line: string): WorkerEvent | null;
  run(input: WorkerRunInput): Promise<WorkerRunResult>;
}

interface SpawnedProcess {
  pid?: number;
  stdin?: { end(): void };
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null) => void): this;
}

export type WorkerSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => SpawnedProcess;

const PASSTHROUGH_ENVIRONMENT = new Set([
  "PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "LC_ALL", "XDG_CONFIG_HOME", "CODEX_HOME",
]);

export function nonInteractiveAssignment(assignment: string): string {
  return `${assignment.trim()}

Work non-interactively. Do not ask the user questions or stop for confirmation. Use repository evidence and the supplied task context to make conservative, reasonable assumptions. Implement and verify the requested outcome. If material ambiguity prevents safe work, exit non-zero with a concise blocker instead of claiming completion.`;
}

export function sanitizeWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) => PASSTHROUGH_ENVIRONMENT.has(key)));
}

export async function runJsonWorkerProcess(input: WorkerRunInput & {
  label: string;
  parseEvent(line: string): WorkerEvent | null;
  spawn?: WorkerSpawn;
  extraEnvironment?: NodeJS.ProcessEnv;
}): Promise<WorkerRunResult> {
  const spawn = input.spawn ?? (nodeSpawn as unknown as WorkerSpawn);
  const env = { ...sanitizeWorkerEnvironment(), ...input.extraEnvironment };
  const child = spawn(input.executable, input.args, { cwd: input.cwd, env, stdio: "pipe" });
  child.kill("SIGSTOP");
  child.stdin?.end();

  let stdoutBuffer = "";
  let output = "";
  let error = "";
  let timeoutReason: "runtime" | "inactive" | null = null;
  let externalSessionId: string | null = null;
  let markActivity = () => undefined;
  const consume = (line: string) => {
    const event = input.parseEvent(line);
    if (!event) return;
    externalSessionId ||= event.sessionId;
    if (event.text) output = event.text;
    input.onEvent?.(event);
  };

  child.stdout.on("data", (chunk: Buffer | string) => {
    markActivity();
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    lines.forEach(consume);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    markActivity();
    error += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    let inactivityTimer: NodeJS.Timeout | undefined;
    let runtimeTimer: NodeJS.Timeout | undefined;
    const clearTimers = () => {
      if (runtimeTimer) clearTimeout(runtimeTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (forceTimer) clearTimeout(forceTimer);
    };
    const finish = (code: number | null, forced = false) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (stdoutBuffer) consume(stdoutBuffer);
      if (timeoutReason === "runtime") {
        error = `${error}${error ? "\n" : ""}${input.label} timed out after ${input.timeoutMs}ms`;
      }
      if (timeoutReason === "inactive") {
        error = `${error}${error ? "\n" : ""}${input.label} was inactive for ${input.inactivityTimeoutMs}ms`;
      }
      if (forced) error = `${error}${error ? "\n" : ""}${input.label} required forced termination`;
      resolve({ exitStatus: code ?? 1, externalSessionId, output, error });
    };
    const terminate = (reason: "runtime" | "inactive") => {
      if (settled || timeoutReason) return;
      timeoutReason = reason;
      if (runtimeTimer) clearTimeout(runtimeTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      Promise.resolve(input.onTimeout?.(reason)).catch((timeoutError) => {
        error = `${error}${error ? "\n" : ""}Failed to journal timeout: ${
          timeoutError instanceof Error ? timeoutError.message : String(timeoutError)
        }`;
      }).finally(() => {
        if (settled) return;
        child.kill("SIGTERM");
        forceTimer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(null, true);
        }, input.killGraceMs ?? 5_000);
      });
    };
    const resetInactivityTimer = () => {
      if (!input.inactivityTimeoutMs || input.inactivityTimeoutMs <= 0 || settled || timeoutReason) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => terminate("inactive"), input.inactivityTimeoutMs);
    };
    markActivity = () => {
      resetInactivityTimer();
      Promise.resolve(input.onActivity?.()).catch(() => undefined);
    };
    runtimeTimer = setTimeout(() => terminate("runtime"), input.timeoutMs);
    resetInactivityTimer();
    child.once("error", (spawnError) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(spawnError);
    });
    child.once("close", (code) => finish(code));
    Promise.resolve(input.onStart?.(child.pid ?? null)).then(
      () => child.kill("SIGCONT"),
      (startError) => {
        child.kill("SIGKILL");
        if (settled) return;
        settled = true;
        clearTimers();
        reject(startError);
      },
    );
  });
}
