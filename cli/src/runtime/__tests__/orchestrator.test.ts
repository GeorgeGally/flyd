import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orchestrateAssignments } from "../orchestrator.js";
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
      await new Promise((resolve) => setTimeout(resolve, 20));
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
  it("routes and runs two disjoint assignments concurrently, verifies, and integrates main", async () => {
    const repo = await repository();
    const snapshot = await inspectRepository(repo.root);
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-orchestrator-managed-"));
    roots.push(managedRoot);
    const concurrency = { active: 0, maximum: 0 };
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
    };

    const result = await orchestrateAssignments({
      task,
      grant,
      assignments,
      repository: snapshot,
      contextPath: "/tmp/context.md",
      adapters: [
        adapter("opencode", ["implementation", "testing", "resume"], "one.txt", concurrency),
        adapter("codex", ["review", "testing", "resume"], "two.txt", concurrency),
      ],
      deps: { store, manager: new GitWorktreeManager({ managedRoot }) },
    });

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
});
