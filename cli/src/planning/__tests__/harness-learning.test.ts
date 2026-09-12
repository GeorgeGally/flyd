import { describe, expect, it, vi } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { decideHarnessEntry } from "../harness-decision.js";
import { reconcileHarnessPrediction, recordHarnessPrediction, type HarnessLearningDependencies } from "../harness-learning.js";

function state(overrides: Partial<WorldStateSnapshot> = {}): WorldStateSnapshot {
  const fact = <T>(value: T) => ({ value, confidence: "high" as const, provenance: ["test"] });
  return {
    id: "state-before",
    capturedAt: "2026-09-12T00:00:00.000Z",
    activeProjects: fact(["flyd"]),
    activeTasks: fact([]),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty: false, head: "abc" }]),
    blockers: fact([]), decisions: fact([]), commitments: fact([]), entities: fact([]), deadlines: fact([]), agentWork: fact([]),
    ...overrides,
  };
}

function deps() {
  const saveTrace = vi.fn((..._args: Parameters<HarnessLearningDependencies["saveTrace"]>) => undefined);
  const saveOutcome = vi.fn((..._args: Parameters<HarnessLearningDependencies["saveOutcome"]>) => undefined);
  return { saveTrace, saveOutcome };
}

describe("live harness prediction learning", () => {
  it("persists the prediction that actually reached execution", async () => {
    const decision = await decideHarnessEntry({
      state: state(),
      requestedOutcome: "Fix the flaky benchmark",
    });
    const d = deps();

    const trace = recordHarnessPrediction(decision, "inv-1", d);

    expect(trace?.chosenActionId).toBe("execute-requested-outcome");
    expect(trace?.goal).toBe("Fix the flaky benchmark");
    expect(d.saveTrace).toHaveBeenCalledWith(trace, "inv-1");
  });

  it("keeps unmodeled effects as insufficient evidence while retaining observed changes", async () => {
    const decision = await decideHarnessEntry({
      state: state(),
      requestedOutcome: "Fix the flaky benchmark",
    });
    const observed = state({
      id: "state-after",
      repoStates: {
        value: [{ root: "/flyd", branch: "main", dirty: true, head: "def" }],
        confidence: "high",
        provenance: ["test"],
      },
    });
    const d = deps();

    const outcome = reconcileHarnessPrediction(decision, observed, "inv-2", d);

    expect(outcome?.category).toBe("insufficient_evidence");
    expect(outcome?.missedEffects.length).toBeGreaterThan(0);
    expect(d.saveOutcome).toHaveBeenCalledWith(outcome, "inv-2");
  });

  it("retains supervised completion separately from state-effect correctness", async () => {
    const decision = await decideHarnessEntry({
      state: state(),
      requestedOutcome: "Verify the release",
    });
    const d = deps();

    const outcome = reconcileHarnessPrediction(
      decision,
      state({ id: "state-after" }),
      "inv-verified",
      d,
      { status: "completed", signal: "verified" },
    );

    expect(outcome?.category).toBe("insufficient_evidence");
    expect(outcome?.executionStatus).toBe("completed");
    expect(outcome?.executionSignal).toBe("verified");
    expect(d.saveOutcome).toHaveBeenCalledWith(expect.objectContaining({
      executionStatus: "completed",
      executionSignal: "verified",
    }), "inv-verified");
  });

  it("does not persist a prediction when policy asks the user instead of acting", async () => {
    const decision = await decideHarnessEntry({ state: state(), requestedOutcome: "fix it" });
    const d = deps();

    expect(recordHarnessPrediction(decision, "inv-3", d)).toBeNull();
    expect(reconcileHarnessPrediction(decision, state(), "inv-3", d)).toBeNull();
    expect(d.saveTrace).not.toHaveBeenCalled();
    expect(d.saveOutcome).not.toHaveBeenCalled();
  });
});
