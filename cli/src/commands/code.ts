import { execFile } from "child_process";
import { mkdir, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";
import { retrieveBrainEvidence } from "../lib/brain-retrieval.js";
import { deliverArchiveOutbox } from "../runtime/archive-outbox.js";
import { createRuntimePool } from "../runtime/database.js";
import { runContinuityHarness } from "../runtime/harness.js";
import { runOpenCode } from "../runtime/opencode-adapter.js";
import { inspectRepository } from "../runtime/repository-inspector.js";
import { recoverInterruptedWorkers, workerProcessIsAlive } from "../runtime/recovery.js";
import { PostgresTaskStore } from "../runtime/task-store.js";
import { NodeTerminal } from "../runtime/terminal.js";
import type { ContextPackage, MemoryEvidence } from "../runtime/types.js";

const execFileAsync = promisify(execFile);
const TESTED_OPENCODE_VERSION = /^1\.17\.\d+$/;

export async function detectOpenCode(): Promise<{ executable: string; version: string }> {
  const [{ stdout: executable }, { stdout: versionOutput }] = await Promise.all([
    execFileAsync("which", ["opencode"], { encoding: "utf8", timeout: 3_000 }),
    execFileAsync("opencode", ["--version"], { encoding: "utf8", timeout: 3_000 }),
  ]);
  const version = versionOutput.trim();
  if (!TESTED_OPENCODE_VERSION.test(version)) {
    throw new Error(`OpenCode ${version || "unknown"} is outside Flyd's tested 1.17.x range`);
  }
  return { executable: executable.trim(), version };
}

export async function retrieveRuntimeMemory(query: string): Promise<MemoryEvidence> {
  const result = await retrieveBrainEvidence(query);
  return {
    verdict: result.sufficiency.verdict,
    matches: result.matches.map((match) => ({
      id: match.id,
      path: match.content.path,
      excerpt: match.content.excerpt,
      stale: match.content.stale,
    })),
  };
}

export async function writeRuntimeContext(taskKey: string, context: ContextPackage): Promise<string> {
  const directory = join(homedir(), ".flyd", "runtime");
  const path = join(directory, `${taskKey}-context.md`);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, context.markdown, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  return path;
}

export async function runCode(outcome?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The Release 1A coding harness requires an interactive terminal");
  }

  const pool = createRuntimePool();
  const terminal = new NodeTerminal();
  const store = new PostgresTaskStore(pool);
  try {
    const result = await runContinuityHarness({
      outcome,
      deps: {
        store,
        terminal,
        inspectRepository,
        retrieveMemory: retrieveRuntimeMemory,
        detectOpenCode,
        recoverWorkers: async (projectRoot) => recoverInterruptedWorkers({
          workers: await store.liveWorkers(projectRoot),
          isProcessAlive: (_processId, worker) => workerProcessIsAlive(worker),
          transition: (workerKey, update) => store.transitionWorker(workerKey, update),
        }),
        recoverSessions: (projectRoot) => store.recoverTaskSessions(projectRoot),
        writeContext: writeRuntimeContext,
        now: () => new Date(),
        runWorker: ({ executable, args, cwd, timeoutMs, permissionConfig, onStart, onEvent }) =>
          runOpenCode({ executable, args, cwd, timeoutMs, permissionConfig, onStart, onEvent }),
      },
    });
    process.stdout.write(`\nTask ${result.taskKey}: ${result.status}\n`);
  } finally {
    try {
      await deliverArchiveOutbox(store);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Flyd memory delivery is delayed: ${message}\n`);
    }
    await pool.end();
  }
}
