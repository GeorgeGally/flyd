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
  killGraceMs?: number;
  onEvent?: (event: WorkerEvent) => void;
  onStart?: (processId: number | null) => void | Promise<void>;
  onTimeout?: () => void | Promise<void>;
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

  let stdoutBuffer = "";
  let output = "";
  let error = "";
  let timedOut = false;
  let externalSessionId: string | null = null;
  const consume = (line: string) => {
    const event = input.parseEvent(line);
    if (!event) return;
    externalSessionId ||= event.sessionId;
    if (event.text) output += event.text;
    input.onEvent?.(event);
  };

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    lines.forEach(consume);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    error += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const finish = (code: number | null, forced = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (stdoutBuffer) consume(stdoutBuffer);
      if (timedOut) error = `${error}${error ? "\n" : ""}${input.label} timed out after ${input.timeoutMs}ms`;
      if (forced) error = `${error}${error ? "\n" : ""}${input.label} required forced termination`;
      resolve({ exitStatus: code ?? 1, externalSessionId, output, error });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      Promise.resolve(input.onTimeout?.()).catch((timeoutError) => {
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
    }, input.timeoutMs);
    child.once("error", (spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      reject(spawnError);
    });
    child.once("close", (code) => finish(code));
    Promise.resolve(input.onStart?.(child.pid ?? null)).then(
      () => child.kill("SIGCONT"),
      (startError) => {
        child.kill("SIGKILL");
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        reject(startError);
      },
    );
  });
}
