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
  readOnly?: boolean;
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
  onAuthorityCheck?: () => boolean | Promise<boolean>;
  authorityCheckIntervalMs?: number;
  allowedReadPaths?: string[];
  onTimeout?: (reason: "runtime" | "inactive" | "authority") => void | Promise<void>;
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
  const child = spawn(input.executable, input.args, { cwd: input.cwd, env, stdio: "pipe", detached: true });
  const processGroupAlive = () => {
    if (input.spawn || !child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const signalWorkerGroup = (signal: NodeJS.Signals) => {
    if (input.spawn || !child.pid) return child.kill(signal);
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      return child.kill(signal);
    }
  };
  signalWorkerGroup("SIGSTOP");
  child.stdin?.end();

  let stdoutBuffer = "";
  let output = "";
  let error = "";
  let timeoutReason: "runtime" | "inactive" | "authority" | null = null;
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
    let authorityTimer: NodeJS.Timeout | undefined;
    let childClosed = false;
    let timeoutJournal: Promise<void> = Promise.resolve();
    const clearTimers = () => {
      if (runtimeTimer) clearTimeout(runtimeTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (forceTimer) clearTimeout(forceTimer);
      if (authorityTimer) clearInterval(authorityTimer);
    };
    const finish = (code: number | null, forced = false) => {
      if (settled) return;
      settled = true;
      clearTimers();
      void timeoutJournal.finally(() => {
        if (stdoutBuffer) consume(stdoutBuffer);
        if (timeoutReason === "runtime") {
          error = `${error}${error ? "\n" : ""}${input.label} timed out after ${input.timeoutMs}ms`;
        }
        if (timeoutReason === "inactive") {
          error = `${error}${error ? "\n" : ""}${input.label} was inactive for ${input.inactivityTimeoutMs}ms`;
        }
        if (timeoutReason === "authority") {
          error = `${error}${error ? "\n" : ""}${input.label} lost its approved task authority`;
        }
        if (forced) error = `${error}${error ? "\n" : ""}${input.label} required forced termination`;
        resolve({ exitStatus: code ?? 1, externalSessionId, output, error });
      });
    };
    const waitForProcessGroupExit = async (timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while (processGroupAlive() && Date.now() < deadline) {
        await new Promise((wait) => setTimeout(wait, 10));
      }
      return !processGroupAlive();
    };
    const finishAfterDescendants = async (code: number | null) => {
      if (!processGroupAlive()) return finish(code);
      signalWorkerGroup("SIGTERM");
      if (await waitForProcessGroupExit(input.killGraceMs ?? 5_000)) return finish(code);
      signalWorkerGroup("SIGKILL");
      if (await waitForProcessGroupExit(input.killGraceMs ?? 5_000)) return finish(code);
      finish(null, true);
    };
    const terminate = (reason: "runtime" | "inactive" | "authority") => {
      if (settled || timeoutReason) return;
      timeoutReason = reason;
      if (runtimeTimer) clearTimeout(runtimeTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      timeoutJournal = Promise.resolve(input.onTimeout?.(reason)).catch((timeoutError) => {
        error = `${error}${error ? "\n" : ""}Failed to journal timeout: ${
          timeoutError instanceof Error ? timeoutError.message : String(timeoutError)
        }`;
      });
      void timeoutJournal.finally(() => {
        if (childClosed) return;
        signalWorkerGroup("SIGTERM");
        forceTimer = setTimeout(() => {
          signalWorkerGroup("SIGKILL");
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
    if (input.onAuthorityCheck) {
      authorityTimer = setInterval(() => {
        Promise.resolve(input.onAuthorityCheck?.()).then((authorized) => {
          if (!authorized) terminate("authority");
        }).catch(() => terminate("authority"));
      }, input.authorityCheckIntervalMs ?? 1_000);
    }
    resetInactivityTimer();
    child.once("error", (spawnError) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(spawnError);
    });
    child.once("close", (code) => {
      childClosed = true;
      void finishAfterDescendants(code);
    });
    Promise.resolve(input.onStart?.(child.pid ?? null)).then(
      () => signalWorkerGroup("SIGCONT"),
      (startError) => {
        signalWorkerGroup("SIGKILL");
        if (settled) return;
        settled = true;
        clearTimers();
        reject(startError);
      },
    );
  });
}
