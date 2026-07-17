import { execFile as nodeExecFile } from "child_process";
import { promisify } from "util";
import {
  runJsonWorkerProcess,
  type WorkerAdapter,
  type WorkerCommandInput,
  type WorkerEvent,
  type WorkerHealth,
  type WorkerRunInput,
  type WorkerRunResult,
} from "./worker-adapter.js";

const execFileAsync = promisify(nodeExecFile);
const TESTED_CODEX_VERSION = /^codex-cli 0\.144\.\d+$/;
const CODEX_CAPABILITIES = [ "analysis", "implementation", "review", "testing", "resume" ] as const;

type ExecFile = (executable: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export function isTestedCodexVersion(version: string): boolean {
  return TESTED_CODEX_VERSION.test(version.trim());
}

export async function detectCodex(input: {
  candidates?: string[];
  execFile?: ExecFile;
} = {}): Promise<WorkerHealth> {
  const candidates = input.candidates ?? [
    process.env.FLYD_CODEX_PATH,
    "/Applications/Codex.app/Contents/Resources/codex",
    "codex",
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
      if (!isTestedCodexVersion(version)) {
        diagnostics.push(`${candidate}: ${version || "unknown version"}`);
        continue;
      }
      return {
        name: "codex",
        executable: candidate,
        version,
        healthy: true,
        capabilities: [...CODEX_CAPABILITIES],
      };
    } catch (error) {
      diagnostics.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No healthy Codex 0.144.x executable (${diagnostics.join("; ")})`);
}

function strictRuntimeArgs(): string[] {
  return [
    "--json",
    "--strict-config",
    "--ignore-user-config",
    "--ignore-rules",
    "-c", 'approval_policy="never"',
    "-c", 'sandbox_mode="workspace-write"',
    "-c", "sandbox_workspace_write.network_access=false",
    "-c", 'shell_environment_policy.inherit="core"',
  ];
}

export function buildCodexArgs(input: WorkerCommandInput): string[] {
  if (input.externalSessionId) {
    return [
      "exec",
      "resume",
      ...strictRuntimeArgs(),
      input.externalSessionId,
      input.assignment,
    ];
  }

  const context = input.contextPath ? `\n\nFlyd context: ${input.contextPath}` : "";
  return [
    "exec",
    ...strictRuntimeArgs(),
    "-C", input.projectRoot,
    `${input.assignment}${context}\nFlyd task: ${input.taskKey}`,
  ];
}

export function parseCodexEvent(line: string): WorkerEvent | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const item = parsed.item && typeof parsed.item === "object"
      ? parsed.item as Record<string, unknown>
      : null;
    const text = item?.type === "agent_message" && typeof item.text === "string"
      ? item.text
      : null;
    return {
      type: typeof parsed.type === "string" ? parsed.type : "unknown",
      sessionId: typeof parsed.thread_id === "string" ? parsed.thread_id : null,
      text,
    };
  } catch {
    return null;
  }
}

export function runCodex(input: WorkerRunInput): Promise<WorkerRunResult> {
  return runJsonWorkerProcess({
    ...input,
    label: "Codex",
    parseEvent: parseCodexEvent,
  });
}

export const codexAdapter: WorkerAdapter = {
  name: "codex",
  capabilities: [...CODEX_CAPABILITIES],
  detect: detectCodex,
  buildArgs: buildCodexArgs,
  parseEvent: parseCodexEvent,
  run: runCodex,
};
