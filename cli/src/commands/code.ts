import { mkdir, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { retrieveBrainEvidence } from "../lib/brain-retrieval.js";
import { planAssignments } from "../runtime/assignment-planner.js";
import { deliverArchiveOutbox } from "../runtime/archive-outbox.js";
import { codexAdapter } from "../runtime/codex-adapter.js";
import { createRuntimePool } from "../runtime/database.js";
import { runContinuityHarness } from "../runtime/harness.js";
import {
  buildOpenCodePermissionConfig,
  createOpenCodeAdapter,
  detectOpenCode,
  runOpenCode,
} from "../runtime/opencode-adapter.js";
import { orchestrateAssignments } from "../runtime/orchestrator.js";
import { inspectRepository } from "../runtime/repository-inspector.js";
import { recoverInterruptedWorkers, workerProcessIsAlive } from "../runtime/recovery.js";
import { PostgresTaskStore } from "../runtime/task-store.js";
import { NodeTerminal } from "../runtime/terminal.js";
import type { ContextPackage, MemoryEvidence } from "../runtime/types.js";
import { GitWorktreeManager } from "../runtime/worktree-manager.js";

export { detectOpenCode };

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
    throw new Error("The Flyd coding harness requires an interactive terminal");
  }

  const pool = createRuntimePool();
  const terminal = new NodeTerminal();
  const store = new PostgresTaskStore(pool);
  const manager = new GitWorktreeManager();
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
        orchestrationGrantScope: {
          workerAdapters: [ "codex", "opencode" ],
          worktreeRoot: manager.managedRoot,
          providerIdentity: "codex-local,opencode-configured-provider",
        },
        orchestrate: async ({ task, grant, repository, memory, contextPath, assignment }) => {
          let assignments = await store.listAssignments(task.id);
          if (assignments.length === 0) {
            const plan = await planAssignments({
              outcome: assignment,
              repository,
              memory,
            });
            const current = await store.findTask(task.taskKey);
            if (!current) throw new Error(`Task ${task.taskKey} disappeared before planning`);
            const persisted = await store.persistAssignmentPlan(task.taskKey, current.revision, {
              ...plan,
              baseHead: repository.head,
              idempotencyKey: `task-plan:${task.taskKey}:${repository.head}`,
            });
            assignments = persisted.assignments;
          }
          const adapters = [
            codexAdapter,
            createOpenCodeAdapter(buildOpenCodePermissionConfig({
              fileOperations: grant.fileOperations,
              commandClasses: grant.commandClasses,
            })),
          ];
          return orchestrateAssignments({
            task,
            grant,
            assignments,
            repository,
            contextPath,
            adapters,
            deps: { store, manager },
          });
        },
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
