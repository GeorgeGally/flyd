import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { DeterministicFutureModel, type CandidateAction } from "../future-model.js";
import { ExecutionGuard, attributeObservedChanges, type ExecutionContract } from "../execution-guard.js";

function state(overrides: Partial<WorldStateSnapshot> = {}): WorldStateSnapshot {
  const fact = <T>(value: T) => ({ value, confidence: "high" as const, provenance: ["test"] });
  return {
    id: randomUUID(),
    capturedAt: new Date().toISOString(),
    projectId: "flyd",
    activeProjects: fact(["flyd"]),
    activeTasks: fact([{ id: "task-1", description: "Ship planner", status: "running" }]),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty: true }]),
    blockers: fact([]), decisions: fact([]), commitments: fact([]), entities: fact([]),
    deadlines: fact([]), agentWork: fact([]),
    ...overrides,
  };
}

const contract: ExecutionContract = {
  actionId: "clean",
  preconditions: [{
    id: "repo-dirty",
    description: "repository has work to clean",
    path: "repoStates.value.0.dirty",
    operator: "equals",
    value: true,
  }],
  postconditions: [{
    id: "repo-clean",
    description: "repository is clean",
    path: "repoStates.value.0.dirty",
    operator: "equals",
    value: false,
  }],
};

describe("ExecutionGuard", () => {
  it("allows an action only when declared preconditions hold", () => {
    const guard = new ExecutionGuard();
    expect(guard.checkBefore({ contract, state: state() }).allowed).toBe(true);
    const clean = state({ repoStates: { value: [{ root: "/flyd", branch: "main", dirty: false }], confidence: "high", provenance: ["test"] } });
    const blocked = guard.checkBefore({ contract, state: clean });
    expect(blocked.allowed).toBe(false);
    expect(blocked.failedPreconditions.map((item) => item.id)).toContain("repo-dirty");
  });

  it("keeps approval separate from state preconditions", () => {
    const guard = new ExecutionGuard();
    const approvalContract = { ...contract, requiresApproval: true };
    expect(guard.checkBefore({ contract: approvalContract, state: state(), approved: false }).allowed).toBe(false);
    expect(guard.checkBefore({ contract: approvalContract, state: state(), approved: true }).allowed).toBe(true);
  });

  it("verifies declared postconditions after execution", () => {
    const guard = new ExecutionGuard();
    const clean = state({ repoStates: { value: [{ root: "/flyd", branch: "main", dirty: false }], confidence: "high", provenance: ["test"] } });
    expect(guard.verifyAfter({ contract, state: clean }).status).toBe("verified");
    expect(guard.verifyAfter({ contract, state: state() }).status).toBe("failed");
  });

  it("returns unknown when no postconditions were declared", () => {
    const result = new ExecutionGuard().verifyAfter({ contract: { ...contract, postconditions: [] }, state: state() });
    expect(result.status).toBe("unknown");
  });
});

describe("causal attribution", () => {
  const action: CandidateAction = {
    id: "clean",
    description: "clean repository",
    deterministicEffects: [{
      path: "repoStates.value",
      value: [{ root: "/flyd", branch: "main", dirty: false }],
    }],
  };

  it("strongly attributes a predicted effect only with complete correlated tool evidence", async () => {
    const before = state();
    const prediction = await new DeterministicFutureModel().predict({ currentState: before, candidateAction: action });
    const result = attributeObservedChanges({
      prediction,
      before,
      after: prediction.predictedState,
      evidence: { origin: "tool", correlationMatched: true, causalComplete: true },
    });
    expect(result.actionAttributed).toBe(1);
    expect(result.changes[0].category).toBe("attributed_to_action");
  });

  it("keeps a matching user-reported change merely action-consistent", async () => {
    const before = state();
    const prediction = await new DeterministicFutureModel().predict({ currentState: before, candidateAction: action });
    const result = attributeObservedChanges({
      prediction,
      before,
      after: prediction.predictedState,
      evidence: { origin: "user", correlationMatched: true, causalComplete: true },
    });
    expect(result.actionAttributed).toBe(0);
    expect(result.changes[0].category).toBe("action_consistent");
  });

  it("marks unpredicted changes external or unknown", async () => {
    const before = state();
    const prediction = await new DeterministicFutureModel().predict({ currentState: before, candidateAction: { id: "noop", description: "noop" } });
    const after = state({ blockers: { value: ["external outage"], confidence: "high", provenance: ["test"] } });
    const result = attributeObservedChanges({
      prediction,
      before,
      after,
      evidence: { origin: "external", correlationMatched: false, causalComplete: false },
    });
    expect(result.externalOrUnknown).toBeGreaterThan(0);
    expect(result.changes.some((item) => item.category === "external_or_unknown")).toBe(true);
  });

  it("marks a changed expected path contradictory when the observed value disagrees", async () => {
    const before = state();
    const prediction = await new DeterministicFutureModel().predict({ currentState: before, candidateAction: action });
    const after = state({ repoStates: { value: [{ root: "/flyd", branch: "main", dirty: true, head: "different" }], confidence: "high", provenance: ["test"] } });
    const result = attributeObservedChanges({
      prediction,
      before,
      after,
      evidence: { origin: "verifier", correlationMatched: true, causalComplete: true },
    });
    expect(result.contradictory).toBeGreaterThan(0);
  });
});
