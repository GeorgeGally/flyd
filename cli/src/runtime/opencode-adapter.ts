import { spawn as nodeSpawn } from "child_process";
import type { SpawnOptionsWithoutStdio } from "child_process";

export interface OpenCodeEvent {
  type: string;
  sessionId: string | null;
  text: string | null;
}

interface OpenCodeArgsInput {
  assignment: string;
  projectRoot: string;
  taskKey: string;
  contextPath?: string;
  externalSessionId?: string;
}

interface GrantPermissionInput {
  fileOperations: string[];
  commandClasses: string[];
}

type PermissionRule = "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">;

export interface OpenCodePermissionConfig {
  permission: Record<string, PermissionRule>;
}

interface SpawnedProcess {
  pid?: number;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null) => void): this;
}

type Spawn = (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => SpawnedProcess;

export function buildOpenCodeArgs(input: OpenCodeArgsInput): string[] {
  const args = ["run", input.assignment];
  if (input.externalSessionId) args.push("--session", input.externalSessionId);
  else if (input.contextPath) args.push("-f", input.contextPath);
  args.push("--format", "json", "--dir", input.projectRoot);
  if (!input.externalSessionId) args.push("--title", `flyd:${input.taskKey}`);
  args.push("--auto");
  return args;
}

export function parseOpenCodeEvent(line: string): OpenCodeEvent | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const part = parsed.part && typeof parsed.part === "object" ? parsed.part as Record<string, unknown> : {};
    return {
      type: typeof parsed.type === "string" ? parsed.type : "unknown",
      sessionId: typeof parsed.sessionID === "string" ? parsed.sessionID : typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      text: typeof part.text === "string" ? part.text : typeof parsed.text === "string" ? parsed.text : null,
    };
  } catch {
    return null;
  }
}

const COMMAND_PATTERNS: Record<string, string[]> = {
  inspect: [ "pwd", "ls", "ls *", "find *", "rg *", "grep *", "sed *", "cat *", "git log*", "git show*" ],
  test: [ "bin/rails test*", "bundle exec rails test*", "bundle exec rake test*", "npm test*", "npm run test*", "pnpm test*", "yarn test*" ],
  lint: [ "npm run lint*", "pnpm lint*", "yarn lint*", "bundle exec rubocop*", "standardrb*" ],
  build: [ "npm run build*", "pnpm build*", "yarn build*", "bin/rails assets:precompile*", "bundle exec rake assets:precompile*" ],
  git_status: [ "git status*" ],
  git_diff: [ "git diff*" ],
};

export function buildOpenCodePermissionConfig(input: GrantPermissionInput): OpenCodePermissionConfig {
  const bash: Record<string, "allow" | "deny"> = { "*": "deny" };
  for (const commandClass of input.commandClasses) {
    for (const pattern of COMMAND_PATTERNS[commandClass] ?? []) bash[pattern] = "allow";
  }
  const canRead = input.fileOperations.includes("read");
  const canWrite = input.fileOperations.includes("write");
  return {
    permission: {
      "*": "deny",
      read: canRead ? "allow" : "deny",
      edit: canWrite ? "allow" : "deny",
      glob: canRead ? "allow" : "deny",
      grep: canRead ? "allow" : "deny",
      list: canRead ? "allow" : "deny",
      lsp: canRead ? "allow" : "deny",
      todowrite: "allow",
      skill: "allow",
      question: "deny",
      task: "deny",
      webfetch: "deny",
      websearch: "deny",
      external_directory: "deny",
      bash,
    },
  };
}

const PASSTHROUGH_ENVIRONMENT = new Set([
  "PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "LC_ALL", "XDG_CONFIG_HOME",
]);

export function sanitizeWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) => PASSTHROUGH_ENVIRONMENT.has(key)));
}

export async function runOpenCode(input: {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  killGraceMs?: number;
  permissionConfig?: OpenCodePermissionConfig;
  spawn?: Spawn;
  onEvent?: (event: OpenCodeEvent) => void;
  onStart?: (processId: number | null) => void | Promise<void>;
}): Promise<{ exitStatus: number; externalSessionId: string | null; output: string; error: string }> {
  const spawn = input.spawn ?? (nodeSpawn as unknown as Spawn);
  const env = sanitizeWorkerEnvironment();
  if (input.permissionConfig) env.OPENCODE_CONFIG_CONTENT = JSON.stringify(input.permissionConfig);
  const child = spawn(input.executable, input.args, { cwd: input.cwd, env, stdio: "pipe" });
  child.kill("SIGSTOP");

  let stdoutBuffer = "";
  let output = "";
  let error = "";
  let timedOut = false;
  let externalSessionId: string | null = null;
  const consume = (line: string) => {
    const event = parseOpenCodeEvent(line);
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
  child.stderr.on("data", (chunk: Buffer | string) => { error += chunk.toString(); });

  return new Promise((resolve, reject) => {
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const finish = (code: number | null, forced = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (stdoutBuffer) consume(stdoutBuffer);
      if (timedOut) error = `${error}${error ? "\n" : ""}OpenCode timed out after ${input.timeoutMs}ms`;
      if (forced) error = `${error}\nOpenCode required forced termination`;
      resolve({ exitStatus: code ?? 1, externalSessionId, output, error });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(null, true);
      }, input.killGraceMs ?? 5_000);
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
