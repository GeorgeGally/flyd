import { execFile as nodeExecFile } from "child_process";
import { promisify } from "util";
import {
  runJsonWorkerProcess,
  sanitizeWorkerEnvironment,
  type WorkerAdapter,
  type WorkerHealth,
  type WorkerSpawn,
} from "./worker-adapter.js";

const execFileAsync = promisify(nodeExecFile);
const TESTED_OPENCODE_VERSION = /^1\.17\.\d+$/;
const OPENCODE_CAPABILITIES = [ "analysis", "implementation", "review", "testing", "resume" ] as const;
type ExecFile = (executable: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface OpenCodeEvent {
  type: string;
  sessionId: string | null;
  text: string | null;
}

export function isTestedOpenCodeVersion(version: string): boolean {
  return TESTED_OPENCODE_VERSION.test(version.trim());
}

export async function detectOpenCode(input: {
  candidates?: string[];
  execFile?: ExecFile;
} = {}): Promise<WorkerHealth> {
  const candidates = input.candidates ?? [
    process.env.FLYD_OPENCODE_PATH,
    `${process.env.HOME ?? ""}/.opencode/bin/opencode`,
    "opencode",
  ].filter((candidate): candidate is string => Boolean(candidate));
  const execFile = input.execFile ?? (async (executable, args) => {
    const result = await execFileAsync(executable, args, { encoding: "utf8", timeout: 3_000 });
    return { stdout: result.stdout, stderr: result.stderr };
  });
  const diagnostics: string[] = [];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const { stdout } = await execFile(candidate, [ "--version" ]);
      const version = stdout.trim();
      if (!isTestedOpenCodeVersion(version)) {
        diagnostics.push(`${candidate}: ${version || "unknown version"}`);
        continue;
      }
      return {
        name: "opencode",
        executable: candidate,
        version,
        healthy: true,
        capabilities: [...OPENCODE_CAPABILITIES],
      };
    } catch (error) {
      diagnostics.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No healthy OpenCode 1.17.x executable (${diagnostics.join("; ")})`);
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

export { sanitizeWorkerEnvironment };

export async function runOpenCode(input: {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  killGraceMs?: number;
  permissionConfig?: OpenCodePermissionConfig;
  spawn?: WorkerSpawn;
  onEvent?: (event: OpenCodeEvent) => void;
  onStart?: (processId: number | null) => void | Promise<void>;
}): Promise<{ exitStatus: number; externalSessionId: string | null; output: string; error: string }> {
  return runJsonWorkerProcess({
    executable: input.executable,
    args: input.args,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    killGraceMs: input.killGraceMs,
    spawn: input.spawn,
    label: "OpenCode",
    parseEvent: parseOpenCodeEvent,
    onEvent: input.onEvent,
    onStart: input.onStart,
    extraEnvironment: input.permissionConfig
      ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(input.permissionConfig) }
      : undefined,
  });
}

export function createOpenCodeAdapter(permissionConfig: OpenCodePermissionConfig): WorkerAdapter {
  return {
    name: "opencode",
    capabilities: [...OPENCODE_CAPABILITIES],
    detect: detectOpenCode,
    buildArgs: buildOpenCodeArgs,
    parseEvent: parseOpenCodeEvent,
    run: (input) => runOpenCode({ ...input, permissionConfig }),
  };
}
