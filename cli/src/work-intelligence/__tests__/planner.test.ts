import { describe, expect, it, vi } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { DeterministicFutureModel } from "../../planning/future-model.js";
import { selectWorkIntelligenceAction } from "../planner.js";
import type { ActionProposal, CurrentWork } from "../types.js";

function fact<T>(value: T) {
  return { value, confidence: "high" as const, provenance: ["test"] };
}

function snapshot(): WorldStateSnapshot {
  return {
    id: "state-1",
    capturedAt: "2026-09-13T00:00:00.000Z",
    activeProjects: fact(["flyd"]),
    activeTasks: fact([]),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty: false, head: "abc" }]),
    blockers: fact([]),
    decisions: fact([]),
    commitments: fact([]),
    entities: fact([]),
    deadlines: fact([]),
    agentWork: fact([]),
  };
}

function currentWork(readiness: "ready" | "blocked" | "uncertain" = "ready"): CurrentWork {
  const evidence = <T>(value: T) => ({
    value,
    source: "foreground" as const,
    confidence: "high" as const,
    provenance: "test",
    sourceTimestamp: "2026-09-13T00:00:00.000Z",
    isHypothesis: false,
  });
  return {
    project: evidence("flyd"),
    objective: evidence("Make normal work interactions more useful"),
    artifact: { kind: "code", title: "planner.ts", contentDigest: "digest" },
    stage: evidence("execution" as const),
    constraints: evidence([]),
    openLoops: readiness === "blocked"
      ? [{ id: "loop-1", description: "Need to understand failing verification", status: "blocked", since: "2026-09-13T00:00:00.000Z" }]
      : [],
    nextAction: evidence({ description: "Ship the next slice", readiness }),
    evidenceSummary: {
      sources: ["foreground", "repository"],
      snapshotTimestamp: "2026-09-13T00:00:00.000Z",
      foregroundApp: "Terminal",
      repositoryRoot: "/flyd",
      branch: "main",
      headDigest: "abc",
      statusDigest: "clean",
      activeWindowTitle: "flyd",
    },
    uncertainty: [],
    confidence: [{ field: "project", confidence: "high" }],
  };
}

function proposal(id: string, kind: ActionProposal["kind"], description: string): ActionProposal {
  return {
    actionId: id,
    kind,
    description,
    targetFingerprint: {},
    workSessionRevision: 0,
    diagnosedIssueId: "",
    finishCondition: "The candidate outcome is independently verified",
    expiryMs: 120000,
    allowedOperation: kind === "repository_action" ? "repository_work" : "shell_execute",
    ...(kind === "file_grep" ? {
      fileOperations: [{ kind: "grep" as const, path: "cli/src", pattern: "verification", explanation: "Find the failing path" }],
    } : {}),
  };
}

function deps(state: WorldStateSnapshot | null) {
  const saveTrace = vi.fn();
  return {
    dependencies: {
      capture: vi.fn(async () => state),
      futureModel: new DeterministicFutureModel(),
      saveTrace,
    },
    saveTrace,
  };
}

describe("work intelligence action planner", () => {
  it("investigates a blocked work state before surfacing mutation", async () => {
    const mutate = proposal("mutate", "repository_action", "Implement the fix now");
    const inspect = proposal("inspect", "file_grep", "Inspect verification evidence first");
    const d = deps(snapshot());

    const selected = await selectWorkIntelligenceAction({
      intent: "Fix the verification problem",
      interactionId: "work-1",
      currentWork: currentWork("blocked"),
      candidates: [mutate, inspect],
      projectRoot: "/flyd",
    }, d.dependencies);

    expect(selected.mode).toBe("investigate");
    expect(selected.proposal?.actionId).toBe("inspect");
    expect(selected.evaluations).toHaveLength(2);
    expect(d.saveTrace).toHaveBeenCalledWith(expect.objectContaining({
      chosenActionId: "inspect",
      rejectedActionIds: ["mutate"],
    }), "work:work-1");
  });

  it("ranks alternatives when work is ready instead of preserving model order", async () => {
    const inspect = proposal("inspect", "file_grep", "Inspect the implementation");
    const mutate = proposal("mutate", "repository_action", "Implement the bounded fix");
    const d = deps(snapshot());

    const selected = await selectWorkIntelligenceAction({
      intent: "Ship the bounded fix",
      interactionId: "work-2",
      currentWork: currentWork("ready"),
      candidates: [inspect, mutate],
      projectRoot: "/flyd",
    }, d.dependencies);

    expect(selected.mode).toBe("act");
    expect(selected.proposal?.actionId).toBe("mutate");
    expect(selected.evaluations.find((item) => item.action.id === "mutate")!.score)
      .toBeGreaterThan(selected.evaluations.find((item) => item.action.id === "inspect")!.score);
  });

  it("falls back to the first bounded proposal when canonical state is unavailable", async () => {
    const first = proposal("first", "file_grep", "Inspect current evidence");
    const second = proposal("second", "repository_action", "Implement a change");
    const d = deps(null);

    const selected = await selectWorkIntelligenceAction({
      intent: "Continue",
      interactionId: "work-3",
      currentWork: currentWork("ready"),
      candidates: [first, second],
      projectRoot: "/flyd",
    }, d.dependencies);

    expect(selected.mode).toBe("fallback");
    expect(selected.proposal?.actionId).toBe("first");
    expect(d.saveTrace).not.toHaveBeenCalled();
  });
});
