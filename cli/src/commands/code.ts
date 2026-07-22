import { mkdir, rename, writeFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { FLYD_DIR, zodiacSign } from "../lib/config.js";
import { currentPlanAssignments, planAssignments } from "../runtime/assignment-planner.js";
import { deliverArchiveOutbox } from "../runtime/archive-outbox.js";
import { createRuntimePool } from "../runtime/database.js";
import { createFlydWorkerAdapter } from "../runtime/flyd-worker-adapter.js";
import { loadFlydWorkerConfigs } from "../runtime/flyd-worker-config.js";
import { createFlydTextGenerator } from "../runtime/flyd-worker-process.js";
import { runContinuityHarness } from "../runtime/harness.js";
import { orchestrateAssignments } from "../runtime/orchestrator.js";
import { inspectRepository } from "../runtime/repository-inspector.js";
import { resolveRequestedRepositoryRoots } from "../runtime/repository-roots.js";
import { recoverInterruptedWorkers, terminateWorkerProcessGroup, workerProcessIsAlive } from "../runtime/recovery.js";
import { RuntimeCommandService } from "../runtime/runtime-command-service.js";
import { verificationCommandsForRepository } from "../runtime/verification-commands.js";
import { PostgresTaskStore } from "../runtime/task-store.js";
import { NodeTerminal } from "../runtime/terminal.js";
import { runAgentSession, type AgentSituation } from "../runtime/agent-session.js";
import { respondToConversation } from "../runtime/conversation-responder.js";
import {
  createConversationMemorySession,
  mergeAgentMemoryEvidence,
  retrieveRecentActionableOutcome,
  retrieveRecentConversationEvidence,
} from "../runtime/conversation-memory.js";
import { retrieveFastBrainEvidence } from "../runtime/fast-brain-retrieval.js";
import { isHoroscopeQuestion, verifiedHoroscopeEvidence } from "../runtime/personal-context-memory.js";
import { retrieveSharedMemoryEvidence } from "../runtime/shared-memory-retrieval.js";
import { actionableTaskNextAction } from "../runtime/orientation.js";
import type { ContextPackage, MemoryEvidence } from "../runtime/types.js";
import { GitWorktreeManager } from "../runtime/worktree-manager.js";
import { controlWorker, defaultWorkerControlDependencies } from "../runtime/worker-controller.js";

const execFileAsync = promisify(execFile);
const FLYD_APPLICATION_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export async function retrieveRuntimeMemory(query: string): Promise<MemoryEvidence> {
  return retrieveFastBrainEvidence(query);
}

export async function retrieveAgentMemory(
  query: string,
  options: {
    excludeConversationSessionId?: string;
    pool?: ReturnType<typeof createRuntimePool>;
  } = {},
): Promise<MemoryEvidence> {
  const [conversation, archive] = await Promise.all([
    retrieveRecentConversationEvidence(query, {
      excludeSessionId: options.excludeConversationSessionId,
    }),
    retrieveFastBrainEvidence(query),
  ]);
  const pool = options.pool ?? createRuntimePool();
  const ownsPool = !options.pool;
  let shared: MemoryEvidence = { verdict: "insufficient", matches: [] };
  try {
    shared = await retrieveSharedMemoryEvidence(query, {
      query: async (sql) => {
        const result = await pool.query(sql);
        return { rows: result.rows };
      },
      now: () => new Date(),
    });
  } catch {
    // Filesystem memory remains available when the shared Rails database is offline.
  }
  const combined = mergeAgentMemoryEvidence(query, [ conversation, shared, archive ]);
  try {
    if (!isHoroscopeQuestion(query)) return combined;
    const result = await pool.query(
      `SELECT status, fresh_until, payload
       FROM intelligence_snapshots
       WHERE provider = 'personal-context'
       ORDER BY received_at DESC, created_at DESC
       LIMIT 1`,
    );
    const horoscopes = verifiedHoroscopeEvidence(result.rows[0] ?? null, zodiacSign());
    if (horoscopes.length === 0) return combined;
    return {
      verdict: "partial",
      matches: [ ...horoscopes, ...combined.matches ].slice(0, 6),
    };
  } catch {
    return combined;
  } finally {
    if (ownsPool) await pool.end();
  }
}

export async function writeRuntimeContext(taskKey: string, context: ContextPackage): Promise<string> {
  const directory = join(FLYD_DIR, "runtime");
  const path = join(directory, `${taskKey}-context.md`);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, context.markdown, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  return path;
}

export async function loadAgentSituation(
  options: { pool?: ReturnType<typeof createRuntimePool> } = {},
): Promise<AgentSituation | null> {
  const pool = options.pool ?? createRuntimePool();
  const ownsPool = !options.pool;
  try {
    const repository = await inspectRepository();
    const store = new PostgresTaskStore(pool);
    const resumable = await store.findResumableTask(repository.root);
    const recent = resumable ?? (await store.listTasks(repository.root, 10))
      .find((task) => task.status !== "cancelled") ?? null;
    let latestCommit: string | null = null;
    try {
      const result = await execFileAsync("git", [ "-C", repository.root, "log", "-1", "--pretty=%s" ]);
      latestCommit = result.stdout.trim() || null;
    } catch {
      latestCommit = null;
    }
    return {
      project: repository.name,
      branch: repository.branch,
      head: repository.head.slice(0, 12),
      dirty: repository.dirty,
      changedFiles: repository.statusLines.length,
      latestCommit,
      outcome: recent?.intendedOutcome ?? null,
      status: recent?.status ?? null,
      nextAction: recent ? actionableTaskNextAction(recent) : null,
    };
  } finally {
    if (ownsPool) await pool.end();
  }
}

export async function runAgent(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Flyd requires an interactive terminal");
  }

  const conversation = createConversationMemorySession();
  const pool = createRuntimePool(undefined, { connectionTimeoutMillis: 500 });
  let result;
  try {
    result = await runAgentSession({
      sessionId: conversation.id,
      terminal: new NodeTerminal(),
      retrieveMemory: (query) => retrieveAgentMemory(query, {
        excludeConversationSessionId: conversation.id,
        pool,
      }),
      recoverActionRequest: () => retrieveRecentActionableOutcome(),
      recordTurn: conversation.recordTurn,
      respond: respondToConversation,
      loadSituation: () => loadAgentSituation({ pool }),
    });
  } finally {
    await pool.end();
  }

  if (result.kind === "coding") await runCode(result.outcome);
  if (result.kind === "resume") await runCode();
}

export async function runCode(outcome?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The Flyd coding harness requires an interactive terminal");
  }

  const workerConfigs = loadFlydWorkerConfigs({ projectRoot: FLYD_APPLICATION_ROOT });
  const [ workerConfig, ...fallbackWorkerConfigs ] = workerConfigs;
  const generatePlan = createFlydTextGenerator(workerConfigs);
  const pool = createRuntimePool();
  const terminal = new NodeTerminal();
  const store = new PostgresTaskStore(pool);
  const manager = new GitWorktreeManager();
  const sessionRoot = join(FLYD_DIR, "runtime", "worker-sessions");
  const baseWorkerAdapter = createFlydWorkerAdapter({
    config: workerConfig,
    fallbackConfigs: fallbackWorkerConfigs,
    sessionRoot,
  });
  const runtimeCommands = new RuntimeCommandService({
    store,
    inspectRepository,
    controlWorker: (input) => controlWorker({
      ...input,
      deps: defaultWorkerControlDependencies(store),
    }),
  });
  try {
    const result = await runContinuityHarness({
      outcome,
      deps: {
        store,
        terminal,
        inspectRepository,
        retrieveMemory: retrieveRuntimeMemory,
        resolveRepositoryRoots: (requestedOutcome, primaryRoot) =>
          resolveRequestedRepositoryRoots(requestedOutcome, primaryRoot, inspectRepository),
        resolveVerificationCommands: verificationCommandsForRepository,
        detectWorker: async () => {
          const health = await baseWorkerAdapter.detect();
          return { executable: health.executable, version: health.version };
        },
        workerAdapterName: "flyd",
        buildWorkerArgs: (command) => baseWorkerAdapter.buildArgs(command),
        recoverWorkers: async (projectRoot) => recoverInterruptedWorkers({
          workers: await store.liveWorkers(projectRoot),
          isProcessAlive: (_processId, worker) => workerProcessIsAlive(worker),
          terminateProcessGroup: (worker) => terminateWorkerProcessGroup(worker),
          transition: (workerKey, update) => store.transitionWorker(workerKey, update),
        }),
        recoverSessions: (projectRoot) => store.recoverTaskSessions(projectRoot),
        writeContext: writeRuntimeContext,
        now: () => new Date(),
        runtimeCommands,
        orchestrationGrantScope: {
          workerAdapters: [ "flyd" ],
          worktreeRoot: manager.managedRoot,
          providerIdentity: workerConfigs.map((config) => config.providerIdentity).join(" -> "),
        },
        orchestrate: async ({ task, grant, repository, memory, contextPath, assignment }) => {
          const repositories = await Promise.all(grant.repositoryRoots.map((root) => (
            root === repository.root ? Promise.resolve(repository) : inspectRepository(root)
          )));
          const verificationCommandsByRepository = Object.fromEntries(await Promise.all(repositories.map(async (snapshot) => [
            snapshot.root,
            await verificationCommandsForRepository(snapshot.root),
          ])));
          const repositoryHeads = new Map(repositories.map((snapshot) => [snapshot.root, snapshot.head]));
          let assignments = currentPlanAssignments(task, await store.listAssignments(task.id), repositoryHeads);
          if (assignments.length === 0) {
            const plan = await planAssignments({
              outcome: task.intendedOutcome,
              nextAction: assignment,
              repository,
              repositories,
              memory,
              generate: generatePlan,
            });
            const current = await store.findTask(task.taskKey);
            if (!current) throw new Error(`Task ${task.taskKey} disappeared before planning`);
            const persisted = await store.persistAssignmentPlan(task.taskKey, current.revision, {
              ...plan,
              baseHead: repository.head,
              repositoryHeads: Object.fromEntries(repositoryHeads),
              idempotencyKey: `task-plan:${task.taskKey}:${current.revision}:${[...repositoryHeads.values()].join(":")}`,
            });
            assignments = persisted.assignments;
          }
          const adapters = [
            createFlydWorkerAdapter({
              config: workerConfig,
              fallbackConfigs: fallbackWorkerConfigs,
              sessionRoot,
              fileOperations: grant.fileOperations,
              commandClasses: grant.commandClasses,
              repositoryRoots: grant.repositoryRoots,
            }),
          ];
          return orchestrateAssignments({
            task,
            grant,
            assignments,
            repository,
            verificationCommandsByRepository,
            contextPath,
            adapters,
            deps: { store, manager },
          });
        },
        runWorker: ({ executable, args, cwd, timeoutMs, onStart, onEvent }) =>
          baseWorkerAdapter.run({ executable, args, cwd, timeoutMs, onStart, onEvent }),
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
