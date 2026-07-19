import { execFile } from "child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orchestrateAssignments } from "../orchestrator.js";
import { buildCodexArgs, parseCodexEvent, runCodex } from "../codex-adapter.js";
import { buildOpenCodeArgs, parseOpenCodeEvent, runOpenCode } from "../opencode-adapter.js";
import { inspectRepository } from "../repository-inspector.js";
import type { AgentTask, TaskAssignment, TaskGrant, WorkerSession } from "../types.js";
import type { WorkerAdapter, WorkerRunInput } from "../worker-adapter.js";
import { GitWorktreeManager } from "../worktree-manager.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function repository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "flyd-orchestrator-test-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-b", "main", root]);
  await writeFile(join(root, "one.txt"), "one base\n");
  await writeFile(join(root, "two.txt"), "two base\n");
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "-c", "user.name=Flyd Test", "-c", "user.email=flyd@example.test", "commit", "-m", "base"]);
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  return { root, head: stdout.trim() };
}

function assignment(id: string, title: string, capabilities: TaskAssignment["capabilityRequirements"], file: string): TaskAssignment {
  return {
    id,
    assignmentKey: `assignment-${id}`,
    agentTaskId: "1",
    status: "pending",
    title,
    instructions: `Change ${file}`,
    successCriteria: ["File changed"],
    capabilityRequirements: capabilities,
    dependencyKeys: [],
    declaredFileScope: [file],
    excludedAdapters: [],
    worktreePath: null,
    branchName: null,
    baseHead: null,
    verificationResult: {},
    integrationResult: {},
    revision: 1,
  };
}

function adapter(
  name: string,
  capabilities: WorkerAdapter["capabilities"],
  file: string,
  concurrency: { active: number; maximum: number },
  release?: Promise<void>,
): WorkerAdapter {
  return {
    name,
    capabilities,
    detect: async () => ({ name, executable: `/bin/${name}`, version: "1.0.0", healthy: true, capabilities }),
    buildArgs: ({ assignment }) => [assignment],
    parseEvent: () => null,
    run: async (input: WorkerRunInput) => {
      concurrency.active += 1;
      concurrency.maximum = Math.max(concurrency.maximum, concurrency.active);
      await input.onStart?.(100 + concurrency.active);
      input.onEvent?.({ type: "session", sessionId: `${name}-session`, text: null });
      await (release ?? new Promise((resolve) => setTimeout(resolve, 20)));
      await writeFile(join(input.cwd, file), `${name} changed\n`);
      concurrency.active -= 1;
      return { exitStatus: 0, externalSessionId: `${name}-session`, output: `${name} done`, error: "" };
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("orchestrateAssignments", () => {
  it("blocks a resumed assignment whose recorded base no longer matches main", async () => {
    const repo = await repository();
    const snapshot = await inspectRepository(repo.root);
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-orchestrator-managed-"));
    roots.push(managedRoot);
    const stale = assignment("1", "Implement", ["implementation"], "one.txt");
    stale.baseHead = "stale-head";
    const store = {
      updateAssignmentWorkspace: vi.fn(),
      createWorker: vi.fn(),
      transitionWorker: vi.fn(),
      recordAssignmentVerification: vi.fn(async () => undefined),
      queueWorkerCommand: vi.fn(),
      completeWorkerCommand: vi.fn(),
      recordTaskIntegration: vi.fn(),
    };
    const task: AgentTask = {
      id: "1", taskKey: "task-1", projectId: "1", projectName: "test", projectRoot: repo.root,
      status: "ready", intendedOutcome: "Change one file", successCriteria: ["Changed"],
      verificationCriteria: ["git diff --check"], plan: {}, contextSnapshot: {},
      repositorySnapshot: {}, recommendedNextAction: null, outcomeSummary: null,
      verificationResult: {}, revision: 1, startedAt: new Date().toISOString(),
      completedAt: null, updatedAt: new Date().toISOString(),
    };
    const grant: TaskGrant = {
      id: "2", grantKey: "grant-1", agentTaskId: "1", status: "approved", scopeDigest: "digest",
      repositoryRoots: [repo.root], worktreePaths: [managedRoot], workerAdapters: ["codex"],
      fileOperations: ["read", "write"], commandClasses: ["test"], verificationCommands: ["git diff --check"],
      renewalRequiredActions: ["deploy"], maxConcurrency: 1, budget: { max_worker_runs: 1, max_runtime_minutes: 90 },
      providerIdentity: "local", approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      decisionReason: null, decidedAt: new Date().toISOString(),
    };
    const neverRun: WorkerAdapter = {
      name: "codex", capabilities: ["implementation"],
      detect: async () => ({ name: "codex", executable: "/bin/codex", version: "1", healthy: true, capabilities: ["implementation"] }),
      buildArgs: () => [], parseEvent: () => null,
      run: vi.fn(),
    };

    const result = await orchestrateAssignments({
      task, grant, assignments: [stale], repository: snapshot, contextPath: "/tmp/context.md",
      adapters: [neverRun], deps: { store, manager: new GitWorktreeManager({ managedRoot }) },
    });

    expect(result).toMatchObject({ status: "blocked", summary: expect.stringMatching(/invalidated.*base/i) });
    expect(store.recordAssignmentVerification).toHaveBeenCalledWith(
      stale.assignmentKey,
      expect.objectContaining({
        status: "blocked",
        result: expect.objectContaining({ intervention: expect.objectContaining({ action: "escalate" }) }),
      }),
    );
    expect(store.createWorker).not.toHaveBeenCalled();
    expect(neverRun.run).not.toHaveBeenCalled();
  });

  it("routes and runs two disjoint assignments concurrently, verifies, and integrates main", async () => {
    const repo = await repository();
    const snapshot = await inspectRepository(repo.root);
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-orchestrator-managed-"));
    roots.push(managedRoot);
    const concurrency = { active: 0, maximum: 0 };
    let releaseWorkers!: () => void;
    const workersReleased = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });
    const assignments = [
      assignment("1", "Implement", ["implementation", "testing"], "one.txt"),
      assignment("2", "Review", ["review", "testing"], "two.txt"),
    ];
    const workers: WorkerSession[] = [];
    const transitionOrder: string[] = [];
    const store = {
      updateAssignmentWorkspace: vi.fn(async () => undefined),
      createWorker: vi.fn(async (input: Record<string, unknown>) => {
        const worker: WorkerSession = {
          id: String(workers.length + 1),
          workerKey: `worker-${workers.length + 1}`,
          agentTaskId: "1",
          taskGrantId: "2",
          taskAssignmentId: assignments.find((item) => item.assignmentKey === input.assignmentKey)!.id,
          status: "queued",
          adapter: input.adapter as string,
          capabilities: input.capabilities as WorkerSession["capabilities"],
          executablePath: input.executablePath as string,
          executableVersion: input.executableVersion as string,
          workingDirectory: input.workingDirectory as string,
          externalSessionId: null,
          processId: null,
          processIdentity: null,
          errorSummary: null,
          output: null,
          exitStatus: null,
          startedAt: null,
          endedAt: null,
          lastObservedAt: null,
          stopReason: null,
        };
        workers.push(worker);
        return worker;
      }),
      transitionWorker: vi.fn(async (workerKey: string, update: Record<string, unknown>) => {
        const worker = workers.find((item) => item.workerKey === workerKey)!;
        if ([ "completed", "failed" ].includes(update.status as string)) {
          transitionOrder.push(`${workerKey}:terminal`);
        } else if (update.externalSessionId) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          transitionOrder.push(`${workerKey}:session`);
        }
        Object.assign(worker, { status: update.status });
        return worker;
      }),
      recordAssignmentVerification: vi.fn(async () => undefined),
      queueWorkerCommand: vi.fn(),
      completeWorkerCommand: vi.fn(),
      recordTaskIntegration: vi.fn(async () => undefined),
    };
    const task: AgentTask = {
      id: "1", taskKey: "task-1", projectId: "1", projectName: "test", projectRoot: repo.root,
      status: "ready", intendedOutcome: "Change both files", successCriteria: ["Both changed"],
      verificationCriteria: ["git diff --check"], plan: {}, contextSnapshot: {},
      repositorySnapshot: {}, recommendedNextAction: null, outcomeSummary: null,
      verificationResult: {}, revision: 1, startedAt: new Date().toISOString(),
      completedAt: null, updatedAt: new Date().toISOString(),
    };
    const grant: TaskGrant = {
      id: "2", grantKey: "grant-1", agentTaskId: "1", status: "approved", scopeDigest: "digest",
      repositoryRoots: [repo.root], worktreePaths: [managedRoot], workerAdapters: ["codex", "opencode"],
      fileOperations: ["read", "write"], commandClasses: ["test"], verificationCommands: ["git diff --check"],
      renewalRequiredActions: ["deploy"], maxConcurrency: 2, budget: { max_worker_runs: 4, max_runtime_minutes: 90 },
      providerIdentity: "local", approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      decisionReason: null, decidedAt: new Date().toISOString(),
    };

    const orchestration = orchestrateAssignments({
      task,
      grant,
      assignments,
      repository: snapshot,
      contextPath: "/tmp/context.md",
      adapters: [
        adapter("opencode", ["implementation", "testing", "resume"], "one.txt", concurrency, workersReleased),
        adapter("codex", ["review", "testing", "resume"], "two.txt", concurrency, workersReleased),
      ],
      deps: { store, manager: new GitWorktreeManager({ managedRoot }) },
    });

    await vi.waitFor(() => expect(concurrency.active).toBe(2));
    releaseWorkers();
    const result = await orchestration;

    expect(result.status, JSON.stringify(result)).toBe("integrated");
    expect(concurrency.maximum).toBe(2);
    expect(await readFile(join(repo.root, "one.txt"), "utf8")).toBe("opencode changed\n");
    expect(await readFile(join(repo.root, "two.txt"), "utf8")).toBe("codex changed\n");
    expect(store.recordAssignmentVerification).toHaveBeenCalledTimes(2);
    expect(store.recordTaskIntegration).toHaveBeenCalledOnce();
    for (const worker of workers) {
      expect(
        transitionOrder.indexOf(`${worker.workerKey}:session`),
        transitionOrder.join(","),
      ).toBeLessThan(transitionOrder.indexOf(`${worker.workerKey}:terminal`));
    }
  });

  it("launches real adapter processes, replaces a failed worker, and integrates both verified patches", async () => {
    const repo = await repository();
    const snapshot = await inspectRepository(repo.root);
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-orchestrator-managed-"));
    const executableRoot = await mkdtemp(join(tmpdir(), "flyd-orchestrator-bin-"));
    roots.push(managedRoot, executableRoot);
    const codexPath = join(executableRoot, "codex");
    const openCodePath = join(executableRoot, "opencode");
    await writeFile(codexPath, `#!/bin/sh
sleep 0.05
printf '%s\\n' '{"type":"thread.started","thread_id":"fake-codex"}'
exit 1
`);
    await writeFile(openCodePath, `#!/bin/sh
case "$*" in
  *one.txt*) target=one.txt ;;
  *two.txt*) target=two.txt ;;
  *) exit 2 ;;
esac
sleep 0.05
printf 'fake opencode changed\\n' > "$target"
printf '%s\\n' '{"type":"text","sessionID":"fake-opencode","part":{"text":"done"}}'
`);
    await Promise.all([chmod(codexPath, 0o755), chmod(openCodePath, 0o755)]);

    const assignments = [
      assignment("1", "Implement one", ["implementation", "testing"], "one.txt"),
      assignment("2", "Implement two", ["implementation", "testing"], "two.txt"),
    ];
    const workers: WorkerSession[] = [];
    const store = {
      updateAssignmentWorkspace: vi.fn(async () => undefined),
      createWorker: vi.fn(async (input: Record<string, unknown>) => {
        const worker: WorkerSession = {
          id: String(workers.length + 1),
          workerKey: `worker-${workers.length + 1}`,
          agentTaskId: "1",
          taskGrantId: "2",
          taskAssignmentId: assignments.find((item) => item.assignmentKey === input.assignmentKey)!.id,
          status: "queued",
          adapter: input.adapter as string,
          capabilities: input.capabilities as WorkerSession["capabilities"],
          executablePath: input.executablePath as string,
          executableVersion: input.executableVersion as string,
          workingDirectory: input.workingDirectory as string,
          externalSessionId: null,
          processId: null,
          processIdentity: null,
          errorSummary: null,
          output: null,
          exitStatus: null,
          startedAt: null,
          endedAt: null,
          lastObservedAt: null,
          stopReason: null,
        };
        workers.push(worker);
        return worker;
      }),
      transitionWorker: vi.fn(async (workerKey: string, update: Record<string, unknown>) => {
        const worker = workers.find((item) => item.workerKey === workerKey)!;
        Object.assign(worker, {
          status: update.status,
          externalSessionId: update.externalSessionId ?? worker.externalSessionId,
          exitStatus: update.exitStatus ?? worker.exitStatus,
        });
        return worker;
      }),
      recordAssignmentVerification: vi.fn(async () => undefined),
      queueWorkerCommand: vi.fn(async (workerKey: string, kind: "stop" | "retry" | "replace") => ({
        command: {
          id: "1", commandKey: `command-${workerKey}`, agentTaskId: "1",
          workerSessionId: "1", kind, status: "queued" as const, idempotencyKey: `command-${workerKey}`,
          payload: {}, dispatchedAt: null, completedAt: null, errorSummary: null,
        },
        worker: workers.find((item) => item.workerKey === workerKey)!,
      })),
      completeWorkerCommand: vi.fn(),
      recordTaskIntegration: vi.fn(async () => undefined),
    };
    const task: AgentTask = {
      id: "1", taskKey: "task-process-smoke", projectId: "1", projectName: "test", projectRoot: repo.root,
      status: "ready", intendedOutcome: "Change both files", successCriteria: ["Both changed"],
      verificationCriteria: ["git diff --check"], plan: {}, contextSnapshot: {},
      repositorySnapshot: {}, recommendedNextAction: null, outcomeSummary: null,
      verificationResult: {}, revision: 1, startedAt: new Date().toISOString(),
      completedAt: null, updatedAt: new Date().toISOString(),
    };
    const grant: TaskGrant = {
      id: "2", grantKey: "grant-process-smoke", agentTaskId: "1", status: "approved", scopeDigest: "digest",
      repositoryRoots: [repo.root], worktreePaths: [managedRoot], workerAdapters: ["codex", "opencode"],
      fileOperations: ["read", "write"], commandClasses: ["test"], verificationCommands: ["git diff --check"],
      renewalRequiredActions: ["deploy"], maxConcurrency: 2, budget: { max_worker_runs: 4, max_runtime_minutes: 1 },
      providerIdentity: "local", approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      decisionReason: null, decidedAt: new Date().toISOString(),
    };
    const capabilities: WorkerAdapter["capabilities"] = ["analysis", "implementation", "review", "testing", "resume"];
    const adapters: WorkerAdapter[] = [
      {
        name: "codex",
        capabilities,
        detect: async () => ({ name: "codex", executable: codexPath, version: "codex-cli 0.144.2", healthy: true, capabilities }),
        buildArgs: buildCodexArgs,
        parseEvent: parseCodexEvent,
        run: runCodex,
      },
      {
        name: "opencode",
        capabilities,
        detect: async () => ({ name: "opencode", executable: openCodePath, version: "1.17.18", healthy: true, capabilities }),
        buildArgs: buildOpenCodeArgs,
        parseEvent: parseOpenCodeEvent,
        run: (input) => runOpenCode(input),
      },
    ];

    const result = await orchestrateAssignments({
      task, grant, assignments, repository: snapshot, contextPath: "/tmp/context.md",
      adapters, deps: { store, manager: new GitWorktreeManager({ managedRoot }) },
    });

    expect(result.status, JSON.stringify(result)).toBe("integrated");
    expect(store.queueWorkerCommand).toHaveBeenCalledWith(
      expect.any(String), "replace", expect.objectContaining({ evidence_digest: expect.any(String) }), expect.any(String),
    );
    expect(await readFile(join(repo.root, "one.txt"), "utf8")).toBe("fake opencode changed\n");
    expect(await readFile(join(repo.root, "two.txt"), "utf8")).toBe("fake opencode changed\n");
    expect(store.recordAssignmentVerification).toHaveBeenCalledTimes(2);
    expect(store.recordTaskIntegration).toHaveBeenCalledOnce();
  });

  it("journals a failed worker when its adapter throws before returning a result", async () => {
    const repo = await repository();
    const snapshot = await inspectRepository(repo.root);
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-orchestrator-managed-"));
    roots.push(managedRoot);
    const assignments = [assignment("1", "Implement", ["implementation"], "one.txt")];
    const worker = {
      id: "1", workerKey: "worker-1", agentTaskId: "1", taskGrantId: "2", taskAssignmentId: "1",
      status: "queued", adapter: "codex", capabilities: ["implementation"],
      executablePath: "/bin/codex", executableVersion: "1.0.0", workingDirectory: repo.root,
      externalSessionId: null, processId: null, processIdentity: null, errorSummary: null, output: null, exitStatus: null,
      startedAt: null, endedAt: null, lastObservedAt: null, stopReason: null,
    } satisfies WorkerSession;
    const store = {
      updateAssignmentWorkspace: vi.fn(async () => undefined),
      createWorker: vi.fn(async () => worker),
      transitionWorker: vi.fn(async (_key: string, update: Record<string, unknown>) => {
        Object.assign(worker, { status: update.status, errorSummary: update.error });
        return worker;
      }),
      recordAssignmentVerification: vi.fn(async () => undefined),
      queueWorkerCommand: vi.fn(),
      completeWorkerCommand: vi.fn(),
      recordTaskIntegration: vi.fn(async () => undefined),
    };
    const crashing: WorkerAdapter = {
      name: "codex",
      capabilities: ["implementation"],
      detect: async () => ({
        name: "codex", executable: "/bin/codex", version: "1.0.0",
        healthy: true, capabilities: ["implementation"],
      }),
      buildArgs: () => [],
      parseEvent: () => null,
      run: async (input) => {
        await input.onStart?.(123);
        throw new Error("spawn channel closed");
      },
    };
    const task: AgentTask = {
      id: "1", taskKey: "task-1", projectId: "1", projectName: "test", projectRoot: repo.root,
      status: "ready", intendedOutcome: "Change one file", successCriteria: ["Changed"],
      verificationCriteria: ["git diff --check"], plan: {}, contextSnapshot: {},
      repositorySnapshot: {}, recommendedNextAction: null, outcomeSummary: null,
      verificationResult: {}, revision: 1, startedAt: new Date().toISOString(),
      completedAt: null, updatedAt: new Date().toISOString(),
    };
    const grant: TaskGrant = {
      id: "2", grantKey: "grant-1", agentTaskId: "1", status: "approved", scopeDigest: "digest",
      repositoryRoots: [repo.root], worktreePaths: [managedRoot], workerAdapters: ["codex"],
      fileOperations: ["read", "write"], commandClasses: ["test"], verificationCommands: ["git diff --check"],
      renewalRequiredActions: ["deploy"], maxConcurrency: 1, budget: { max_worker_runs: 1, max_runtime_minutes: 90 },
      providerIdentity: "local", approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      decisionReason: null, decidedAt: new Date().toISOString(),
    };

    const result = await orchestrateAssignments({
      task, grant, assignments, repository: snapshot, contextPath: "/tmp/context.md",
      adapters: [crashing], deps: { store, manager: new GitWorktreeManager({ managedRoot }) },
    });

    expect(result).toMatchObject({ status: "blocked", summary: expect.stringMatching(/budget is exhausted/i) });
    expect(store.transitionWorker).toHaveBeenCalledWith("worker-1", expect.objectContaining({
      status: "failed",
      error: "spawn channel closed",
    }));
    expect(worker.status).toBe("failed");
    expect(store.recordAssignmentVerification).toHaveBeenCalledWith(
      "assignment-1",
      expect.objectContaining({
        status: "blocked",
        result: expect.objectContaining({
          intervention: expect.objectContaining({ action: "escalate" }),
        }),
      }),
    );
  });

  it("records an inactivity stop before accepting a timed-out adapter result", async () => {
    const repo = await repository();
    const snapshot = await inspectRepository(repo.root);
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-orchestrator-managed-"));
    roots.push(managedRoot);
    const assignments = [assignment("1", "Implement", ["implementation"], "one.txt")];
    const worker = {
      id: "1", workerKey: "worker-1", agentTaskId: "1", taskGrantId: "2", taskAssignmentId: "1",
      status: "queued", adapter: "codex", capabilities: ["implementation"],
      executablePath: "/bin/codex", executableVersion: "1.0.0", workingDirectory: repo.root,
      externalSessionId: null, processId: null, processIdentity: null, errorSummary: null, output: null, exitStatus: null,
      startedAt: null, endedAt: null, lastObservedAt: null, stopReason: null,
    } satisfies WorkerSession;
    const command = {
      id: "3", commandKey: "command-1", agentTaskId: "1", workerSessionId: "1",
      kind: "stop", status: "queued", idempotencyKey: "timeout", payload: {},
      dispatchedAt: null, completedAt: null, errorSummary: null,
    } as const;
    const store = {
      updateAssignmentWorkspace: vi.fn(async () => undefined),
      createWorker: vi.fn(async () => worker),
      transitionWorker: vi.fn(async (_key: string, update: Record<string, unknown>) => {
        Object.assign(worker, { status: update.status });
        return worker;
      }),
      recordAssignmentVerification: vi.fn(async () => undefined),
      queueWorkerCommand: vi.fn(async () => ({ command, worker: { ...worker, status: "stopping" as const } })),
      completeWorkerCommand: vi.fn(async () => ({ ...command, status: "completed" as const })),
      recordTaskIntegration: vi.fn(async () => undefined),
    };
    const timedOut: WorkerAdapter = {
      name: "codex",
      capabilities: ["implementation"],
      detect: async () => ({
        name: "codex", executable: "/bin/codex", version: "1.0.0",
        healthy: true, capabilities: ["implementation"],
      }),
      buildArgs: () => [],
      parseEvent: () => null,
      run: async (input) => {
        await input.onStart?.(123);
        await input.onTimeout?.("inactive");
        return { exitStatus: 1, externalSessionId: null, output: "", error: "Codex timed out after 1000ms" };
      },
    };
    const task: AgentTask = {
      id: "1", taskKey: "task-1", projectId: "1", projectName: "test", projectRoot: repo.root,
      status: "ready", intendedOutcome: "Change one file", successCriteria: ["Changed"],
      verificationCriteria: ["git diff --check"], plan: {}, contextSnapshot: {},
      repositorySnapshot: {}, recommendedNextAction: null, outcomeSummary: null,
      verificationResult: {}, revision: 1, startedAt: new Date().toISOString(),
      completedAt: null, updatedAt: new Date().toISOString(),
    };
    const grant: TaskGrant = {
      id: "2", grantKey: "grant-1", agentTaskId: "1", status: "approved", scopeDigest: "digest",
      repositoryRoots: [repo.root], worktreePaths: [managedRoot], workerAdapters: ["codex"],
      fileOperations: ["read", "write"], commandClasses: ["test"], verificationCommands: ["git diff --check"],
      renewalRequiredActions: ["deploy"], maxConcurrency: 1, budget: { max_worker_runs: 2, max_runtime_minutes: 1 / 60 },
      providerIdentity: "local", approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      decisionReason: null, decidedAt: new Date().toISOString(),
    };

    const result = await orchestrateAssignments({
      task, grant, assignments, repository: snapshot, contextPath: "/tmp/context.md",
      adapters: [timedOut], deps: { store, manager: new GitWorktreeManager({ managedRoot }) },
    });

    expect(result).toMatchObject({ status: "blocked", summary: expect.stringMatching(/inactiv/i) });
    expect(store.queueWorkerCommand).toHaveBeenCalledWith(
      "worker-1", "stop", expect.objectContaining({ trigger: "inactive" }), expect.any(String),
    );
    expect(store.completeWorkerCommand).toHaveBeenCalledWith("command-1", { workerStatus: "stopped" });
    expect(store.recordAssignmentVerification).toHaveBeenCalledWith(
      "assignment-1", expect.objectContaining({ status: "blocked" }),
    );
  });
});
