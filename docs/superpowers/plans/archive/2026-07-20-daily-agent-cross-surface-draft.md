# Daily Agent Cross-Surface Implementation Plan

> **Status: archived design draft; do not execute as written.** Preserved because it contains useful parity scenarios and test ideas, but its proposed Rails projection and controller wiring conflict with the authoritative Surface architecture. A replacement plan must keep PostgreSQL-backed provider state as evidence, compose the homepage through `Flyd::Intelligence` and background jobs, and express shared actions through persisted Surface plans rather than loading an active task directly in `SurfacesController`.

The specific conflicts are:

- Creating separate TypeScript and Rails projection implementations would add another duplicated interpretation boundary instead of strengthening the existing provider and Surface contracts.
- Loading a daily-agent projection in `SurfacesController` would let stored task records become the interface merely because they exist.
- Rendering a dedicated `_daily_agent` plane from controller state would bypass persisted Surface composition and activation.
- Inspecting repository state while serving `GET /` would violate the asynchronous homepage boundary.

Retain the acceptance journeys, human-language normalization cases, and cross-surface action parity tests when this work is replanned against the current architecture.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flyd feel and behave like George's daily coding agent in both CLI and Rails, with one shared interpretation, next action, worker state, and action model.

**Architecture:** Add a canonical `DailyAgentSession` projection over the existing task, repository, memory, worker, artifact, and surface records. CLI and Rails render this projection rather than independently formatting task internals. Runtime actions flow through the existing `RuntimeCommandService`, so both surfaces can start, continue, stop, retry, redirect, review, and complete the same active task with the same permission boundaries.

**Tech Stack:** Rails 8, Hotwire/Turbo, PostgreSQL runtime tables, TypeScript CLI, Vitest, Rails integration/system tests.

---

## Product Contract

Flyd is George's daily agent when startup does five things consistently:

1. Reconstructs the current situation from repository truth, task state, worker state, and relevant memory.
2. States a concise interpretation in human language, never raw runtime internals.
3. Recommends one useful next move and explains why.
4. Offers the same available actions in CLI and Rails.
5. Records whether the interpretation was accepted, focused-corrected, or replaced.

This plan intentionally avoids adding a new chat bot layer. The daily agent is a shared runtime projection and action contract rendered by both surfaces.

## File Structure

- Create `cli/src/runtime/daily-agent.ts`
  - TypeScript canonical projection builder for daily-agent startup and status.
  - Converts task/repository/worker/memory/artifact facts into human sections and action objects.

- Create `cli/src/runtime/__tests__/daily-agent.test.ts`
  - Unit tests for startup interpretation, stale worker handling, internal-string suppression, action parity, and provenance labels.

- Modify `cli/src/runtime/harness.ts`
  - Use the daily-agent projection for startup orientation and continuation prompt.
  - Persist accepted/focused-corrected/replaced interpretation evidence using existing session/correction fields.

- Modify `cli/src/commands/task.ts`
  - Render `task status` from the daily-agent projection.
  - Keep low-level `task workers` available for diagnostics, but stop making it the primary daily-agent output.

- Modify `cli/src/commands/code.ts`
  - Build the projection before running the harness and pass it through the existing dependencies.

- Create `app/services/daily_agent/projection.rb`
  - Rails canonical presenter reading the same persisted task, worker, artifact, repository snapshot, and recommendation state.
  - It should mirror the TypeScript projection schema rather than invent Rails-only behavior.

- Create `test/services/daily_agent/projection_test.rb`
  - Rails service tests for the same projection states as the CLI tests.

- Modify `app/services/runtime_tasks/binding_presenter.rb`
  - Use daily-agent projection concepts for primary outcome and supporting artifacts.
  - Keep task artifact rendering grounded in verified artifacts.

- Modify `app/controllers/surfaces_controller.rb`
  - Load daily-agent projection for the active task and pass it to the surface renderer.

- Modify `app/views/surfaces/_plane.html.erb`
  - Render orientation, action, monitoring, review, and completion states from the projection.

- Create `app/views/surfaces/renderers/_daily_agent.html.erb`
  - Focused daily-agent view for the active task.
  - Shows interpretation, next action, why, worker state, and controls without exposing table names or runtime errors.

- Create `test/integration/daily_agent_cross_surface_test.rb`
  - Asserts CLI status JSON and Rails active task rendering agree on task key, next action, worker state, actions, and evidence status.

- Modify `cli/src/index.ts`
  - Add `flyd status --json` or `flyd task status --json` for cross-surface tests and Rails parity checks.

- Modify `docs/product/flyd-personal-agent-platform-prd.md`
  - Add a short implementation note that the daily-agent projection is the shared contract for CLI and Rails.

---

## Task 1: Define The Shared Daily-Agent Projection

**Files:**
- Create: `cli/src/runtime/daily-agent.ts`
- Create: `cli/src/runtime/__tests__/daily-agent.test.ts`

- [ ] **Step 1: Write the failing projection test**

Add this test file:

```ts
import { describe, expect, it } from "vitest";
import { buildDailyAgentProjection } from "../daily-agent.js";
import type { AgentTask, MemoryEvidence, RepositorySnapshot, WorkerSession } from "../types.js";

const repository: RepositorySnapshot = {
  root: "/Users/radarboy3000/Documents/flyd",
  name: "flyd",
  remote: "GeorgeGally/flyd",
  branch: "main",
  head: "abc123",
  dirty: false,
  statusLines: [],
  statusDigest: "clean",
};

const task: AgentTask = {
  id: "1",
  taskKey: "task-1",
  projectId: "1",
  projectName: "GeorgeGally/flyd",
  projectRoot: repository.root,
  status: "ready",
  intendedOutcome: "Make Flyd work as my daily agent",
  successCriteria: [],
  verificationCriteria: [],
  plan: {},
  contextSnapshot: {},
  repositorySnapshot: { head: "old-head", status_digest: "old" },
  recommendedNextAction: "Current repository evidence invalidated the assignment base",
  outcomeSummary: null,
  verificationResult: { integrated: false },
  revision: 8,
  startedAt: "2026-07-20T00:00:00.000Z",
  completedAt: null,
  updatedAt: "2026-07-20T00:10:00.000Z",
};

const worker: WorkerSession = {
  id: "2",
  workerKey: "worker-1",
  agentTaskId: "1",
  taskGrantId: "grant-1",
  taskAssignmentId: "assignment-1",
  status: "interrupted",
  adapter: "codex",
  capabilities: ["implementation", "testing"],
  executablePath: "/bin/codex",
  executableVersion: "codex-cli 0.145.0-alpha.18",
  workingDirectory: "/tmp/flyd/worktree",
  externalSessionId: "thread-1",
  processId: 18862,
  processIdentity: "old-process",
  errorSummary: "Flyd restarted after the worker process ended",
  output: null,
  exitStatus: null,
  startedAt: "2026-07-20T00:00:30.000Z",
  endedAt: null,
  lastObservedAt: "2026-07-20T00:01:00.000Z",
  stopReason: null,
  assignmentRevision: 2,
};

const memory: MemoryEvidence = {
  verdict: "sufficient",
  matches: [
    { id: "memory:1", path: "docs/product/flyd-personal-agent-platform-prd.md", excerpt: "Flyd must become George's daily coding agent harness.", stale: false },
  ],
};

describe("buildDailyAgentProjection", () => {
  it("turns runtime facts into a daily-agent orientation without leaking internals", () => {
    const projection = buildDailyAgentProjection({ task, repository, worker, memory });

    expect(projection.mode).toBe("orientation");
    expect(projection.taskKey).toBe("task-1");
    expect(projection.interpretation).toContain("daily agent");
    expect(projection.nextAction.label).toBe("Re-check the current repository");
    expect(projection.nextAction.reason).toContain("changed while work was running");
    expect(projection.worker?.status).toBe("interrupted");
    expect(projection.availableActions.map((action) => action.id)).toEqual(["continue", "correct", "workers"]);
    expect(JSON.stringify(projection)).not.toContain("Current repository evidence invalidated the assignment base");
    expect(JSON.stringify(projection)).not.toContain("No healthy worker satisfies");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd cli && npx vitest run src/runtime/__tests__/daily-agent.test.ts
```

Expected: fail because `daily-agent.ts` does not exist.

- [ ] **Step 3: Add the projection implementation**

Create `cli/src/runtime/daily-agent.ts`:

```ts
import type { AgentTask, MemoryEvidence, RepositorySnapshot, WorkerSession } from "./types.js";

export type DailyAgentMode = "orientation" | "action" | "monitoring" | "review" | "completion";

export interface DailyAgentAction {
  id: "continue" | "correct" | "workers" | "review" | "complete" | "stop" | "retry" | "redirect" | "replace";
  label: string;
  command?: string;
  destructive: boolean;
}

export interface DailyAgentProjection {
  mode: DailyAgentMode;
  taskKey: string | null;
  projectName: string;
  projectRoot: string;
  interpretation: string;
  nextAction: {
    label: string;
    reason: string;
    command?: string;
  };
  worker: null | {
    key: string;
    adapter: string;
    status: WorkerSession["status"];
    summary: string;
  };
  availableActions: DailyAgentAction[];
  evidence: Array<{
    id: string;
    label: string;
    stale: boolean;
  }>;
}

function repositoryChanged(task: AgentTask, repository: RepositorySnapshot): boolean {
  const recordedHead = String(task.repositorySnapshot.head ?? "");
  const recordedDigest = String(task.repositorySnapshot.status_digest ?? "");
  return recordedHead !== repository.head || recordedDigest !== repository.statusDigest;
}

function workerSummary(worker: WorkerSession): string {
  if (worker.status === "interrupted") return `${worker.adapter} stopped before completing its assignment.`;
  if (worker.status === "running") return `${worker.adapter} is working now.`;
  if (worker.status === "completed") return `${worker.adapter} finished and its output needs Flyd verification.`;
  if (worker.status === "failed") return `${worker.adapter} failed and needs retry, replacement, or a narrower assignment.`;
  return `${worker.adapter} is ${worker.status}.`;
}

function nextActionFor(task: AgentTask, repository: RepositorySnapshot, worker: WorkerSession | null): DailyAgentProjection["nextAction"] {
  if (repositoryChanged(task, repository)) {
    return {
      label: "Re-check the current repository",
      reason: "The repository changed while work was running, so current files must override the previous assignment base.",
      command: "flyd",
    };
  }

  if (worker?.status === "interrupted") {
    return {
      label: "Recover the interrupted work",
      reason: "The last worker stopped before Flyd could verify and integrate the result.",
      command: "flyd",
    };
  }

  if (task.verificationResult.integrated === true) {
    return {
      label: "Review the verified result",
      reason: "Flyd has an integrated result that needs user confirmation before the task is complete.",
      command: "flyd",
    };
  }

  return {
    label: task.recommendedNextAction?.trim() || "Continue the unfinished task",
    reason: "This is the current persisted re-entry point for the active task.",
    command: "flyd",
  };
}

function modeFor(task: AgentTask, worker: WorkerSession | null): DailyAgentMode {
  if (task.status === "completed") return "completion";
  if (task.verificationResult.integrated === true) return "review";
  if (worker && ["queued", "starting", "running", "stopping"].includes(worker.status)) return "monitoring";
  return "orientation";
}

function actionsFor(task: AgentTask, worker: WorkerSession | null): DailyAgentAction[] {
  const actions: DailyAgentAction[] = [
    { id: "continue", label: "Continue", command: "flyd", destructive: false },
    { id: "correct", label: "Correct Flyd", destructive: false },
    { id: "workers", label: "Inspect Workers", command: "flyd task workers", destructive: false },
  ];

  if (task.verificationResult.integrated === true) {
    actions.unshift({ id: "review", label: "Review Result", command: "flyd", destructive: false });
    actions.push({ id: "complete", label: "Confirm Complete", command: "flyd task complete", destructive: false });
  }

  if (worker && ["queued", "starting", "running", "stopping"].includes(worker.status)) {
    actions.push({ id: "stop", label: "Stop Worker", command: `flyd task stop ${worker.workerKey}`, destructive: false });
  }

  if (worker && ["failed", "interrupted"].includes(worker.status)) {
    actions.push({ id: "retry", label: "Retry Worker", command: `flyd task retry ${worker.workerKey}`, destructive: false });
    actions.push({ id: "replace", label: "Replace Worker", command: `flyd task replace ${worker.workerKey}`, destructive: false });
  }

  return actions;
}

export function buildDailyAgentProjection(input: {
  task: AgentTask | null;
  repository: RepositorySnapshot;
  worker: WorkerSession | null;
  memory: MemoryEvidence;
}): DailyAgentProjection {
  const { task, repository, worker, memory } = input;

  if (!task) {
    return {
      mode: "orientation",
      taskKey: null,
      projectName: repository.name,
      projectRoot: repository.root,
      interpretation: `You are in ${repository.name}. Flyd does not have an active coding task here yet.`,
      nextAction: {
        label: "Tell Flyd the outcome",
        reason: "A daily-agent session starts from the result you want, not a tool choice.",
        command: "flyd \"<outcome>\"",
      },
      worker: null,
      availableActions: [
        { id: "continue", label: "Start", command: "flyd \"<outcome>\"", destructive: false },
      ],
      evidence: memory.matches.map((match) => ({ id: match.id, label: match.path, stale: match.stale })),
    };
  }

  return {
    mode: modeFor(task, worker),
    taskKey: task.taskKey,
    projectName: task.projectName,
    projectRoot: task.projectRoot,
    interpretation: `You are trying to ${task.intendedOutcome.replace(/\.$/, "")}.`,
    nextAction: nextActionFor(task, repository, worker),
    worker: worker ? {
      key: worker.workerKey,
      adapter: worker.adapter,
      status: worker.status,
      summary: workerSummary(worker),
    } : null,
    availableActions: actionsFor(task, worker),
    evidence: memory.matches.map((match) => ({ id: match.id, label: match.path, stale: match.stale })),
  };
}
```

- [ ] **Step 4: Run the projection test**

Run:

```bash
cd cli && npx vitest run src/runtime/__tests__/daily-agent.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/runtime/daily-agent.ts cli/src/runtime/__tests__/daily-agent.test.ts
git commit -m "feat(cli): define daily agent projection"
```

---

## Task 2: Make CLI Startup Render The Daily-Agent Projection

**Files:**
- Modify: `cli/src/runtime/harness.ts`
- Modify: `cli/src/runtime/__tests__/harness.test.ts`

- [ ] **Step 1: Write failing startup output test**

Add this test to `cli/src/runtime/__tests__/harness.test.ts`:

```ts
it("renders daily-agent orientation instead of raw task internals on resume", async () => {
  const deps = dependencies();
  deps.store.findResumableTask.mockResolvedValue(task({
    intendedOutcome: "Make Flyd my daily agent",
    recommendedNextAction: "Current repository evidence invalidated the assignment base",
  }));
  deps.store.latestWorker.mockResolvedValue({ ...worker, status: "interrupted", errorSummary: "Flyd restarted after the worker process ended" });
  deps.store.approvedGrant.mockResolvedValue(grant);
  deps.terminal.ask.mockResolvedValue("");

  await runContinuityHarness({ deps });

  const output = deps.terminal.write.mock.calls.map(([text]) => text).join("\n");
  expect(output).toContain("You are trying to Make Flyd my daily agent");
  expect(output).toContain("Next: Re-check the current repository");
  expect(output).not.toContain("Current repository evidence invalidated the assignment base");
});
```

- [ ] **Step 2: Run the failing harness test**

Run:

```bash
cd cli && npx vitest run src/runtime/__tests__/harness.test.ts
```

Expected: fail because `harness.ts` still writes `buildOrientation` output directly.

- [ ] **Step 3: Render projection in `harness.ts`**

In `cli/src/runtime/harness.ts`, import:

```ts
import { buildDailyAgentProjection } from "./daily-agent.js";
```

After `const orientation = buildOrientation(...)`, add:

```ts
const dailyAgent = buildDailyAgentProjection({
  task: resumedTask,
  repository,
  worker: previousWorker,
  memory,
});
```

Replace the existing orientation terminal write with:

```ts
deps.terminal.write(
  `\n${dailyAgent.interpretation}\n${orientation.detail}\nNext: ${dailyAgent.nextAction.label}\nWhy: ${dailyAgent.nextAction.reason}\n`,
);
```

When prompting for continuation, change the prompt text to use the label:

```ts
`Press Enter to ${dailyAgent.nextAction.label.toLowerCase()}, or type a focused correction:`
```

Set the assignment fallback to:

```ts
assignment = correction || explicitOutcome || orientation.nextAction;
```

Keep `orientation.nextAction` for machine routing, because it may still need the exact intended task. The projection is the human renderer.

- [ ] **Step 4: Run harness tests**

Run:

```bash
cd cli && npx vitest run src/runtime/__tests__/harness.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/runtime/harness.ts cli/src/runtime/__tests__/harness.test.ts
git commit -m "feat(cli): render daily agent startup orientation"
```

---

## Task 3: Make `flyd task status` A Daily-Agent Status View

**Files:**
- Modify: `cli/src/commands/task.ts`
- Modify: `cli/src/commands/__tests__/task.test.ts`
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Add status formatting tests**

Add this test to `cli/src/commands/__tests__/task.test.ts`:

```ts
import { formatDailyAgentStatus } from "../task.js";

it("formats daily-agent status with interpretation, next action, worker, and actions", () => {
  const output = formatDailyAgentStatus({
    mode: "orientation",
    taskKey: "task-1",
    projectName: "GeorgeGally/flyd",
    projectRoot: "/work/flyd",
    interpretation: "You are trying to make Flyd work as your daily agent.",
    nextAction: {
      label: "Re-check the current repository",
      reason: "The repository changed while work was running.",
      command: "flyd",
    },
    worker: {
      key: "worker-1",
      adapter: "codex",
      status: "interrupted",
      summary: "codex stopped before completing its assignment.",
    },
    availableActions: [
      { id: "continue", label: "Continue", command: "flyd", destructive: false },
      { id: "workers", label: "Inspect Workers", command: "flyd task workers", destructive: false },
    ],
    evidence: [
      { id: "memory:1", label: "docs/product/flyd-personal-agent-platform-prd.md", stale: false },
    ],
  });

  expect(output).toContain("Flyd Daily Agent");
  expect(output).toContain("You are trying to make Flyd work as your daily agent.");
  expect(output).toContain("Next: Re-check the current repository");
  expect(output).toContain("Why: The repository changed while work was running.");
  expect(output).toContain("Worker: codex interrupted");
  expect(output).toContain("Continue: flyd");
});
```

- [ ] **Step 2: Run the failing command test**

Run:

```bash
cd cli && npx vitest run src/commands/__tests__/task.test.ts
```

Expected: fail because `formatDailyAgentStatus` does not exist.

- [ ] **Step 3: Implement status formatter**

In `cli/src/commands/task.ts`, import the projection type:

```ts
import { buildDailyAgentProjection, type DailyAgentProjection } from "../runtime/daily-agent.js";
```

Add:

```ts
export function formatDailyAgentStatus(projection: DailyAgentProjection): string {
  const lines = [
    "Flyd Daily Agent",
    `Project: ${projection.projectName}`,
    projection.taskKey ? `Task: ${projection.taskKey}` : "Task: none",
    `Mode: ${projection.mode}`,
    "",
    projection.interpretation,
    "",
    `Next: ${projection.nextAction.label}`,
    `Why: ${projection.nextAction.reason}`,
  ];

  if (projection.worker) {
    lines.push("", `Worker: ${projection.worker.adapter} ${projection.worker.status}`, projection.worker.summary);
  }

  lines.push("", "Actions:");
  for (const action of projection.availableActions) {
    lines.push(`- ${action.label}${action.command ? `: ${action.command}` : ""}`);
  }

  if (projection.evidence.length > 0) {
    lines.push("", "Evidence:");
    for (const item of projection.evidence.slice(0, 3)) {
      lines.push(`- ${item.stale ? "stale" : "current"}: ${item.label}`);
    }
  }

  return lines.join("\n");
}
```

In `runTaskStatus`, after recovering workers and loading `currentTask`, build the projection:

```ts
const projection = buildDailyAgentProjection({
  task: currentTask,
  repository,
  worker,
  memory: { verdict: "insufficient", matches: [] },
});
console.log(formatDailyAgentStatus(projection));
```

Keep `task workers` as the detailed worker diagnostic command.

- [ ] **Step 4: Add JSON output option**

In `cli/src/index.ts`, change task status command to:

```ts
task
  .command("status")
  .description("Show the current daily-agent state")
  .argument("[task-key]", "exact Flyd task key")
  .option("--json", "print machine-readable daily-agent projection")
  .action((taskKey?: string, options?: { json?: boolean }) => runTaskStatus(taskKey, options));
```

Change `runTaskStatus` signature:

```ts
export async function runTaskStatus(taskKey?: string, options: { json?: boolean } = {}): Promise<void>
```

If `options.json` is true:

```ts
console.log(JSON.stringify(projection, null, 2));
return;
```

- [ ] **Step 5: Run command tests and manual status**

Run:

```bash
cd cli && npx vitest run src/commands/__tests__/task.test.ts
cd cli && npm run dev -- task status
cd cli && npm run dev -- task status --json
```

Expected: tests pass; text status is human-readable; JSON contains `mode`, `taskKey`, `nextAction`, `worker`, and `availableActions`.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/task.ts cli/src/commands/__tests__/task.test.ts cli/src/index.ts
git commit -m "feat(cli): render daily agent task status"
```

---

## Task 4: Add Rails Daily-Agent Projection

**Files:**
- Create: `app/services/daily_agent/projection.rb`
- Create: `test/services/daily_agent/projection_test.rb`

- [ ] **Step 1: Write failing Rails projection test**

Create `test/services/daily_agent/projection_test.rb`:

```rb
require "test_helper"

class DailyAgent::ProjectionTest < ActiveSupport::TestCase
  test "builds orientation without leaking runtime internals" do
    project = Project.create!(name: "GeorgeGally/flyd", root_path: Rails.root.to_s)
    task = project.agent_tasks.create!(
      task_key: "task-1",
      status: "ready",
      intended_outcome: "Make Flyd work as my daily agent",
      success_criteria: [],
      verification_criteria: [],
      plan: {},
      context_snapshot: {},
      repository_snapshot: { "head" => "old", "status_digest" => "old" },
      recommended_next_action: "Current repository evidence invalidated the assignment base",
      verification_result: { "integrated" => false },
      revision: 3
    )
    grant = task.task_grants.create!(
      grant_key: "grant-1",
      status: "approved",
      scope_digest: "digest",
      repository_roots: [Rails.root.to_s],
      worktree_paths: [],
      worker_adapters: ["codex"],
      file_operations: ["read", "write"],
      command_classes: ["inspect", "test"],
      verification_commands: ["git diff --check"],
      renewal_required_actions: ["deploy"],
      max_concurrency: 1,
      budget: {},
      provider_identity: "codex-local",
      approved_at: Time.current,
      expires_at: 1.hour.from_now
    )
    worker = task.worker_sessions.create!(
      task_grant: grant,
      worker_key: "worker-1",
      task_assignment_id: nil,
      status: "interrupted",
      adapter: "codex",
      capabilities: ["implementation", "testing"],
      executable_path: "/bin/codex",
      executable_version: "codex-cli 0.145.0-alpha.18",
      working_directory: "/tmp/flyd",
      external_session_id: "thread-1",
      error_summary: "Flyd restarted after the worker process ended"
    )

    projection = DailyAgent::Projection.new(
      task: task,
      repository: {
        root: Rails.root.to_s,
        name: "flyd",
        head: "new",
        status_digest: "clean"
      },
      worker: worker,
      memory: []
    ).call

    assert_equal "orientation", projection.fetch(:mode)
    assert_equal "task-1", projection.fetch(:task_key)
    assert_match "daily agent", projection.fetch(:interpretation)
    assert_equal "Re-check the current repository", projection.dig(:next_action, :label)
    refute_includes projection.to_json, "Current repository evidence invalidated the assignment base"
  end
end
```

- [ ] **Step 2: Run failing Rails test**

Run:

```bash
bin/rails test test/services/daily_agent/projection_test.rb
```

Expected: fail because `DailyAgent::Projection` does not exist.

- [ ] **Step 3: Implement Rails projection**

Create `app/services/daily_agent/projection.rb`:

```rb
module DailyAgent
  class Projection
    def initialize(task:, repository:, worker:, memory: [])
      @task = task
      @repository = repository
      @worker = worker
      @memory = memory
    end

    def call
      return empty_projection unless @task

      {
        mode: mode,
        task_key: @task.task_key,
        project_name: @task.project.name,
        project_root: @task.project.root_path,
        interpretation: "You are trying to #{@task.intended_outcome.to_s.sub(/\.\z/, "")}.",
        next_action: next_action,
        worker: worker_projection,
        available_actions: actions,
        evidence: @memory.map { |item| evidence_item(item) }
      }
    end

    private

    def empty_projection
      {
        mode: "orientation",
        task_key: nil,
        project_name: @repository[:name],
        project_root: @repository[:root],
        interpretation: "You are in #{@repository[:name]}. Flyd does not have an active coding task here yet.",
        next_action: {
          label: "Tell Flyd the outcome",
          reason: "A daily-agent session starts from the result you want, not a tool choice."
        },
        worker: nil,
        available_actions: [ { id: "continue", label: "Start", destructive: false } ],
        evidence: []
      }
    end

    def repository_changed?
      recorded_head = @task.repository_snapshot["head"].to_s
      recorded_digest = @task.repository_snapshot["status_digest"].to_s
      recorded_head != @repository[:head].to_s || recorded_digest != @repository[:status_digest].to_s
    end

    def mode
      return "completion" if @task.completed?
      return "review" if @task.verification_result["integrated"] == true
      return "monitoring" if @worker && %w[queued starting running stopping].include?(@worker.status)
      "orientation"
    end

    def next_action
      if repository_changed?
        {
          label: "Re-check the current repository",
          reason: "The repository changed while work was running, so current files must override the previous assignment base."
        }
      elsif @worker&.interrupted?
        {
          label: "Recover the interrupted work",
          reason: "The last worker stopped before Flyd could verify and integrate the result."
        }
      elsif @task.verification_result["integrated"] == true
        {
          label: "Review the verified result",
          reason: "Flyd has an integrated result that needs user confirmation before the task is complete."
        }
      else
        {
          label: @task.recommended_next_action.presence || "Continue the unfinished task",
          reason: "This is the current persisted re-entry point for the active task."
        }
      end
    end

    def worker_projection
      return nil unless @worker

      {
        key: @worker.worker_key,
        adapter: @worker.adapter,
        status: @worker.status,
        summary: worker_summary
      }
    end

    def worker_summary
      case @worker.status
      when "interrupted" then "#{@worker.adapter} stopped before completing its assignment."
      when "running" then "#{@worker.adapter} is working now."
      when "completed" then "#{@worker.adapter} finished and its output needs Flyd verification."
      when "failed" then "#{@worker.adapter} failed and needs retry, replacement, or a narrower assignment."
      else "#{@worker.adapter} is #{@worker.status}."
      end
    end

    def actions
      [
        { id: "continue", label: "Continue", destructive: false },
        { id: "correct", label: "Correct Flyd", destructive: false },
        { id: "workers", label: "Inspect Workers", destructive: false }
      ]
    end

    def evidence_item(item)
      {
        id: item.fetch(:id),
        label: item.fetch(:label),
        stale: item.fetch(:stale, false)
      }
    end
  end
end
```

- [ ] **Step 4: Run Rails projection test**

Run:

```bash
bin/rails test test/services/daily_agent/projection_test.rb
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/services/daily_agent/projection.rb test/services/daily_agent/projection_test.rb
git commit -m "feat(rails): add daily agent projection"
```

---

## Task 5: Render Daily Agent In Rails Surface

**Files:**
- Modify: `app/controllers/surfaces_controller.rb`
- Create: `app/views/surfaces/renderers/_daily_agent.html.erb`
- Modify: `app/views/surfaces/_plane.html.erb`
- Create: `test/integration/daily_agent_surface_test.rb`

- [ ] **Step 1: Write failing Rails surface test**

Create `test/integration/daily_agent_surface_test.rb`:

```rb
require "test_helper"

class DailyAgentSurfaceTest < ActionDispatch::IntegrationTest
  test "root renders active task through daily-agent projection" do
    project = Project.create!(name: "GeorgeGally/flyd", root_path: Rails.root.to_s)
    task = project.agent_tasks.create!(
      task_key: "task-1",
      status: "ready",
      intended_outcome: "Make Flyd work as my daily agent",
      success_criteria: [],
      verification_criteria: [],
      plan: {},
      context_snapshot: {},
      repository_snapshot: { "head" => "old", "status_digest" => "old" },
      recommended_next_action: "Current repository evidence invalidated the assignment base",
      verification_result: { "integrated" => false },
      revision: 3
    )

    get root_url(task_key: task.task_key)

    assert_response :success
    assert_select "[data-daily-agent-task-key='task-1']"
    assert_select "h2", text: /daily agent/i
    assert_select "[data-daily-agent-next-action]", text: /Re-check the current repository/
    refute_includes response.body, "Current repository evidence invalidated the assignment base"
  end
end
```

- [ ] **Step 2: Run failing surface test**

Run:

```bash
bin/rails test test/integration/daily_agent_surface_test.rb
```

Expected: fail because the root surface does not render `data-daily-agent-task-key`.

- [ ] **Step 3: Load projection in `SurfacesController`**

In `app/controllers/surfaces_controller.rb`, after active task resolution, set:

```rb
@daily_agent_projection = if params[:task_key].present?
  task = AgentTask.find_by(task_key: params[:task_key])
  worker = task&.worker_sessions&.order(:created_at)&.last
  DailyAgent::Projection.new(
    task: task,
    worker: worker,
    repository: {
      root: Rails.root.to_s,
      name: Rails.root.basename.to_s,
      head: `git rev-parse HEAD`.strip,
      status_digest: Digest::SHA256.hexdigest(`git status --short`)
    },
    memory: []
  ).call
end
```

If shelling out in the controller conflicts with existing repository inspection helpers, replace it with the repo's existing repository inspector. Do not add LLM calls to `GET /`.

- [ ] **Step 4: Add renderer**

Create `app/views/surfaces/renderers/_daily_agent.html.erb`:

```erb
<section class="daily-agent"
         data-daily-agent-task-key="<%= projection[:task_key] %>">
  <header class="daily-agent__header">
    <p class="daily-agent__eyebrow">Flyd Daily Agent</p>
    <h2><%= projection[:interpretation] %></h2>
  </header>

  <div class="daily-agent__next" data-daily-agent-next-action>
    <span>Next</span>
    <strong><%= projection.dig(:next_action, :label) %></strong>
    <p><%= projection.dig(:next_action, :reason) %></p>
  </div>

  <% if projection[:worker] %>
    <div class="daily-agent__worker">
      <span>Worker</span>
      <strong><%= projection.dig(:worker, :adapter) %> <%= projection.dig(:worker, :status) %></strong>
      <p><%= projection.dig(:worker, :summary) %></p>
    </div>
  <% end %>

  <div class="daily-agent__actions">
    <% projection[:available_actions].each do |action| %>
      <button type="button"
              class="daily-agent__action"
              data-action-id="<%= action[:id] %>">
        <%= action[:label] %>
      </button>
    <% end %>
  </div>
</section>
```

- [ ] **Step 5: Render projection from plane**

In `app/views/surfaces/_plane.html.erb`, before fallback item rendering:

```erb
<% if local_assigns[:daily_agent_projection].present? %>
  <%= render "surfaces/renderers/daily_agent", projection: daily_agent_projection %>
<% else %>
  <%# existing surface item rendering remains here %>
<% end %>
```

Pass the local from `show.html.erb` or the existing plane render call:

```erb
<%= render "surfaces/plane", surface: @surface, active_conversation: @conversation, daily_agent_projection: @daily_agent_projection %>
```

- [ ] **Step 6: Run Rails surface test**

Run:

```bash
bin/rails test test/integration/daily_agent_surface_test.rb
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add app/controllers/surfaces_controller.rb app/views/surfaces/_plane.html.erb app/views/surfaces/renderers/_daily_agent.html.erb test/integration/daily_agent_surface_test.rb
git commit -m "feat(rails): render daily agent surface"
```

---

## Task 6: Cross-Surface Parity Test

**Files:**
- Create: `test/integration/daily_agent_cross_surface_test.rb`
- Modify: `cli/src/commands/task.ts`

- [ ] **Step 1: Write failing parity test**

Create `test/integration/daily_agent_cross_surface_test.rb`:

```rb
require "test_helper"
require "json"
require "open3"

class DailyAgentCrossSurfaceTest < ActionDispatch::IntegrationTest
  test "CLI json and Rails surface expose the same daily-agent task state" do
    project = Project.create!(name: "GeorgeGally/flyd", root_path: Rails.root.to_s)
    task = project.agent_tasks.create!(
      task_key: "task-cross-surface",
      status: "ready",
      intended_outcome: "Make Flyd work as my daily agent",
      success_criteria: [],
      verification_criteria: [],
      plan: {},
      context_snapshot: {},
      repository_snapshot: { "head" => "old", "status_digest" => "old" },
      recommended_next_action: "Current repository evidence invalidated the assignment base",
      verification_result: { "integrated" => false },
      revision: 3
    )

    stdout, stderr, status = Open3.capture3(
      { "DATABASE_URL" => ENV.fetch("DATABASE_URL", nil).to_s },
      "npm", "run", "dev", "--", "task", "status", task.task_key, "--json",
      chdir: Rails.root.join("cli").to_s
    )

    assert status.success?, stderr
    cli_projection = JSON.parse(stdout.lines.drop_while { |line| line.start_with?(">") || line.strip.empty? }.join)

    get root_url(task_key: task.task_key)

    assert_response :success
    assert_equal "task-cross-surface", cli_projection.fetch("taskKey")
    assert_includes response.body, cli_projection.dig("nextAction", "label")
    assert_includes response.body, cli_projection.fetch("taskKey")
  end
end
```

- [ ] **Step 2: Run failing parity test**

Run:

```bash
bin/rails test test/integration/daily_agent_cross_surface_test.rb
```

Expected: fail until CLI JSON and Rails use matching field names or renderer wiring is complete.

- [ ] **Step 3: Normalize JSON field names**

If Rails uses snake_case and CLI uses camelCase, add a Rails serializer method in `DailyAgent::Projection`:

```rb
def self.camelize_keys(value)
  case value
  when Array then value.map { |item| camelize_keys(item) }
  when Hash
    value.to_h do |key, item|
      [key.to_s.camelize(:lower), camelize_keys(item)]
    end
  else value
  end
end
```

Use this only for JSON parity endpoints. Keep ERB access idiomatic with symbols.

- [ ] **Step 4: Run parity test**

Run:

```bash
bin/rails test test/integration/daily_agent_cross_surface_test.rb
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add test/integration/daily_agent_cross_surface_test.rb app/services/daily_agent/projection.rb cli/src/commands/task.ts
git commit -m "test: enforce daily agent cross-surface parity"
```

---

## Task 7: Same Actions In CLI And Rails

**Files:**
- Modify: `app/services/runtime_tasks/action_executor.rb`
- Modify: `app/views/surfaces/renderers/_daily_agent.html.erb`
- Modify: `cli/src/runtime/daily-agent.ts`
- Create: `test/integration/daily_agent_actions_test.rb`
- Add or modify: `cli/src/runtime/__tests__/daily-agent.test.ts`

- [ ] **Step 1: Write Rails action parity test**

Create `test/integration/daily_agent_actions_test.rb`:

```rb
require "test_helper"

class DailyAgentActionsTest < ActionDispatch::IntegrationTest
  test "daily-agent surface exposes reversible worker controls only when allowed" do
    project = Project.create!(name: "GeorgeGally/flyd", root_path: Rails.root.to_s)
    task = project.agent_tasks.create!(
      task_key: "task-actions",
      status: "running",
      intended_outcome: "Make Flyd work as my daily agent",
      success_criteria: [],
      verification_criteria: [],
      plan: {},
      context_snapshot: {},
      repository_snapshot: { "head" => "head", "status_digest" => "clean" },
      recommended_next_action: "Monitor the worker",
      verification_result: {},
      revision: 3
    )
    grant = task.task_grants.create!(
      grant_key: "grant-actions",
      status: "approved",
      scope_digest: "digest",
      repository_roots: [Rails.root.to_s],
      worktree_paths: [],
      worker_adapters: ["codex"],
      file_operations: ["read", "write"],
      command_classes: ["inspect", "test"],
      verification_commands: ["git diff --check"],
      renewal_required_actions: ["deploy"],
      max_concurrency: 1,
      budget: {},
      provider_identity: "codex-local",
      approved_at: Time.current,
      expires_at: 1.hour.from_now
    )
    task.worker_sessions.create!(
      task_grant: grant,
      worker_key: "worker-actions",
      status: "running",
      adapter: "codex",
      capabilities: ["implementation"],
      executable_path: "/bin/codex",
      executable_version: "codex-cli 0.145.0-alpha.18",
      working_directory: "/tmp/flyd"
    )

    get root_url(task_key: task.task_key)

    assert_response :success
    assert_select "[data-action-id='stop']"
    assert_select "[data-action-id='retry']", count: 0
    assert_select "[data-action-id='replace']", count: 0
  end
end
```

- [ ] **Step 2: Run failing action test**

Run:

```bash
bin/rails test test/integration/daily_agent_actions_test.rb
```

Expected: fail until the Rails projection includes worker-control actions.

- [ ] **Step 3: Update both projections' action rules**

Make these rules identical in `cli/src/runtime/daily-agent.ts` and `app/services/daily_agent/projection.rb`:

- Always available: `continue`, `correct`, `workers`.
- Running worker: add `stop`.
- Interrupted or failed worker: add `retry`, `redirect`, `replace`.
- Integrated result: add `review`, `complete`.
- No destructive action is available without a runtime grant renewal path.

- [ ] **Step 4: Run CLI and Rails action tests**

Run:

```bash
cd cli && npx vitest run src/runtime/__tests__/daily-agent.test.ts
bin/rails test test/integration/daily_agent_actions_test.rb
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/runtime/daily-agent.ts cli/src/runtime/__tests__/daily-agent.test.ts app/services/daily_agent/projection.rb test/integration/daily_agent_actions_test.rb app/views/surfaces/renderers/_daily_agent.html.erb
git commit -m "feat: align daily agent actions across cli and rails"
```

---

## Task 8: Acceptance Journeys As End-To-End Checks

**Files:**
- Create: `test/integration/daily_agent_acceptance_journeys_test.rb`
- Modify: `cli/src/runtime/__tests__/harness.test.ts`

- [ ] **Step 1: Add resumed-work journey test**

Create `test/integration/daily_agent_acceptance_journeys_test.rb`:

```rb
require "test_helper"

class DailyAgentAcceptanceJourneysTest < ActionDispatch::IntegrationTest
  test "resume interrupted work presents current truth and a correct re-entry action" do
    project = Project.create!(name: "GeorgeGally/flyd", root_path: Rails.root.to_s)
    task = project.agent_tasks.create!(
      task_key: "task-resume-journey",
      status: "ready",
      intended_outcome: "Make Flyd work as my daily agent",
      success_criteria: ["CLI and Rails show the same next move"],
      verification_criteria: ["CLI tests pass", "Rails tests pass"],
      plan: {},
      context_snapshot: {},
      repository_snapshot: { "head" => "old", "status_digest" => "old" },
      recommended_next_action: "Current repository evidence invalidated the assignment base",
      verification_result: { "integrated" => false },
      revision: 5
    )

    get root_url(task_key: task.task_key)

    assert_response :success
    assert_select "[data-daily-agent-next-action]", text: /Re-check the current repository/
    assert_select "[data-action-id='continue']"
    refute_includes response.body, "No healthy worker satisfies"
    refute_includes response.body, "Current repository evidence invalidated the assignment base"
  end
end
```

- [ ] **Step 2: Add CLI loose-outcome test**

In `cli/src/runtime/__tests__/harness.test.ts`, add:

```ts
it("starts a loose outcome as a daily-agent session without asking for worker choice", async () => {
  const deps = dependencies();
  deps.store.findResumableTask.mockResolvedValue(null);
  deps.store.approvedGrant.mockResolvedValue(grant);

  await runContinuityHarness({ outcome: "Make Flyd my daily agent", deps });

  expect(deps.detectOpenCode).not.toHaveBeenCalledBefore(deps.store.createTask);
  expect(deps.terminal.write.mock.calls.map(([text]) => text).join("\n")).toContain("Make Flyd my daily agent");
  expect(deps.terminal.write.mock.calls.map(([text]) => text).join("\n")).not.toContain("Choose a worker");
});
```

- [ ] **Step 3: Run journey tests**

Run:

```bash
bin/rails test test/integration/daily_agent_acceptance_journeys_test.rb
cd cli && npx vitest run src/runtime/__tests__/harness.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add test/integration/daily_agent_acceptance_journeys_test.rb cli/src/runtime/__tests__/harness.test.ts
git commit -m "test: cover daily agent acceptance journeys"
```

---

## Task 9: Documentation And Release Gate Update

**Files:**
- Modify: `docs/product/flyd-personal-agent-platform-prd.md`
- Modify: `docs/architecture/intelligence-surface-foundation.md`

- [ ] **Step 1: Add PRD implementation note**

Add this under `## First product: Flyd coding harness`:

```md
### Daily-agent projection

The daily-agent projection is the shared implementation contract for CLI and Rails. It is built from current repository truth, active task state, worker state, relevant memory evidence, verified artifacts, and available runtime commands. It produces the current interpretation, next action, reason, worker summary, evidence labels, and reversible controls. CLI and Rails may render differently, but they must not disagree about these fields.
```

- [ ] **Step 2: Add architecture note**

Add this under `## Release 1B supervised agent runtime` in `docs/architecture/intelligence-surface-foundation.md`:

```md
The daily-agent projection is the user-facing runtime read model. It prevents raw orchestration failures, stale worker rows, and storage-shaped records from becoming the product interface. Every renderer should consume the projection first and expose raw task, worker, assignment, and artifact records only as inspectable evidence.
```

- [ ] **Step 3: Run doc grep checks**

Run:

```bash
rg "daily-agent projection|Daily-agent projection" docs/product/flyd-personal-agent-platform-prd.md docs/architecture/intelligence-surface-foundation.md
```

Expected: both documents mention the daily-agent projection.

- [ ] **Step 4: Commit**

```bash
git add docs/product/flyd-personal-agent-platform-prd.md docs/architecture/intelligence-surface-foundation.md
git commit -m "docs: define daily agent projection contract"
```

---

## Final Verification

- [ ] **Step 1: Run CLI suite**

```bash
cd cli && npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run CLI build**

```bash
cd cli && npm run build
```

Expected: TypeScript build passes and postbuild prepares executable entrypoints.

- [ ] **Step 3: Run Rails tests covering daily-agent surfaces**

```bash
bin/rails test test/services/daily_agent/projection_test.rb test/integration/daily_agent_surface_test.rb test/integration/daily_agent_cross_surface_test.rb test/integration/daily_agent_actions_test.rb test/integration/daily_agent_acceptance_journeys_test.rb
```

Expected: all tests pass.

- [ ] **Step 4: Run broader Rails regression**

```bash
bin/rails test
```

Expected: all Rails tests pass.

- [ ] **Step 5: Run whitespace check**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 6: Manual CLI check**

```bash
flyd task status
flyd task status --json
```

Expected:
- Text output starts with `Flyd Daily Agent`.
- Text output has interpretation, next action, why, worker summary, and actions.
- JSON output has `mode`, `taskKey`, `interpretation`, `nextAction`, `worker`, `availableActions`, and `evidence`.
- Neither output contains raw strings such as `No healthy worker satisfies` or `Current repository evidence invalidated the assignment base`.

- [ ] **Step 7: Manual Rails check**

Start Rails:

```bash
bin/dev
```

Open:

```text
http://localhost:3000
```

Expected:
- Active task shows as a daily-agent surface, not a generic dashboard.
- The same next action appears as in `flyd task status`.
- Worker controls match CLI actions.
- Provenance is visible but not dominant.

---

## Self-Review

**Spec coverage:** The plan covers startup understanding, outcome-first flow, worker coordination, generated interface, Rails parity, same actions, and acceptance journeys from the PRD.

**Placeholder scan:** Each task has exact files, tests, commands, and expected outcomes.

**Type consistency:** CLI projection uses camelCase fields for JSON and TypeScript. Rails projection uses symbol/snake_case internally, with a camelization step only where JSON parity needs it.

**Known risk:** The Rails repository snapshot shell-out in Task 5 should be replaced with an existing repository inspector if one exists in Rails. The implementation must not make `GET /` call an LLM or do provider refresh work synchronously.
