import { describe, expect, it } from "vitest";
import { buildContextPackage, buildOrientation } from "../orientation.js";
import type { AgentTask, MemoryEvidence, RepositorySnapshot, WorkerSession } from "../types.js";

const repository: RepositorySnapshot = {
  root: "/work/flyd",
  name: "GeorgeGally/flyd",
  remote: "git@github.com:GeorgeGally/flyd.git",
  branch: "main",
  head: "new-head",
  dirty: true,
  statusLines: [" M cli/src/index.ts"],
  statusDigest: "new-digest",
};

const task: AgentTask = {
  id: "1",
  taskKey: "task-1",
  projectId: "1",
  projectName: "GeorgeGally/flyd",
  projectRoot: "/work/flyd",
  status: "ready",
  intendedOutcome: "Make Flyd resume coding work",
  contextSnapshot: {},
  repositorySnapshot: { head: "old-head", status_digest: "old-digest" },
  recommendedNextAction: "Continue the runtime store",
  outcomeSummary: null,
  verificationResult: {},
  revision: 2,
  startedAt: "2026-07-17T00:00:00.000Z",
  completedAt: null,
  updatedAt: "2026-07-17T00:30:00.000Z",
};

const worker: WorkerSession = {
  id: "2",
  workerKey: "worker-1",
  agentTaskId: "1",
  taskGrantId: "3",
  status: "interrupted",
  adapter: "opencode",
  executablePath: "/usr/local/bin/opencode",
  executableVersion: "1.17.18",
  workingDirectory: "/work/flyd",
  externalSessionId: "ses_1",
  processId: null,
  errorSummary: "runtime restarted",
  output: "Implemented the first store test",
  exitStatus: null,
  startedAt: "2026-07-17T00:10:00.000Z",
  endedAt: "2026-07-17T00:20:00.000Z",
};

const memory: MemoryEvidence = {
  verdict: "partial",
  matches: [{ id: "memory:1", path: "flyd-prd.md", excerpt: "Flyd should own the daily coding experience.", stale: false }],
};

describe("buildOrientation", () => {
  it("distinguishes the persisted task from changed repository truth", () => {
    const orientation = buildOrientation({ task, repository, worker, memory });

    expect(orientation.kind).toBe("resume_changed");
    expect(orientation.headline).toContain("Make Flyd resume coding work");
    expect(orientation.detail).toContain("repository changed");
    expect(orientation.nextAction).toBe("Continue the runtime store");
    expect(orientation.evidenceRefs).toEqual(["memory:1"]);
  });

  it("builds a bounded context package with epistemic labels", () => {
    const context = buildContextPackage({ task, repository, worker, memory, maxCharacters: 2_000 });

    expect(context.markdown).toContain("## Current repository observation");
    expect(context.markdown).toContain("## Confirmed task state");
    expect(context.markdown).toContain("## Retrieved memory evidence");
    expect(context.markdown.length).toBeLessThanOrEqual(2_000);
    expect(context.evidenceRefs).toEqual(["memory:1"]);
  });
});
