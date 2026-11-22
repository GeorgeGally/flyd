/**
 * Real pinned AgentRun interpreter exercising Flyd's production CoS recovery
 * runner, but with injected System-1 responses and a temporary in-memory store.
 * No external provider, domain effect, or installed Mac is involved.
 */
import assert from "node:assert/strict";
import { runWorkflow, validateWorkflow } from "@parcha/agentrun-dsl";
import { IntelligenceEventStore } from "../../cli/src/intelligence/event-store.js";
import { runRecoveryDsl } from "../../cli/src/command/cos/decision-workflows/recovery-runner.js";
import { recoveryWorkflow } from "../../cli/src/command/cos/decision-workflows/recovery-workflow.js";
import type { RecoveryInput } from "../../cli/src/command/cos/recovery.js";
import type { PredicateEvaluation } from "../../cli/src/cognition/system-one/types.js";

const executor = { runWorkflow, validateWorkflow } as any;
const input: RecoveryInput = {
  objective: {
    id: "obj-dsl-integration", briefRevision: 1, words: "Fix internal component test", adaptations: [],
  },
  run: { key: "r1", team: "coding", outcome: "Repair broken test", attempt: 1, ref: "internal-r1" },
  failure: "Test snapshot differs", effectKnownInternal: true, retryable: true,
};
const state = {
  source_state: "coding",
  summary: "Component snapshot differs",
  question: "Choose safe internal recovery",
  options: ["rebrief", "hold"],
  goal_context: "Make component test pass",
};
function answer(p = 0.94): PredicateEvaluation {
  return {
    ok: true, evaluator: "jev", model: "scripted-offline", rubricVersion: "test",
    projectionHash: "opaque", evaluatedAt: new Date(0).toISOString(),
    latencyMs: 1, answers: {
      cos_recovery_tactic: {
        id: "cos_recovery_tactic", type: "choice",
        choice: "rebrief_with_different_tactic", probability: p, confidence: p,
        probabilities: { rebrief_with_different_tactic: p, hold_for_evidence: 1 - p },
      },
    },
  };
}
const valid = validateWorkflow(recoveryWorkflow() as any);
assert.equal(valid.ok, true, JSON.stringify(valid));

{
  const store = new IntelligenceEventStore({ path: ":memory:" });
  let calls = 0;
  try {
    const options = { executor, store, evaluate: async () => { calls++; return answer(); } };
    const first = await runRecoveryDsl(input, state, options);
    assert.equal(first.kind, "decided", JSON.stringify(first));
    if (first.kind === "decided") assert.equal(first.action, "rebrief");
    const replay = await runRecoveryDsl(input, state, options);
    assert.equal(replay.kind, "decided");
    if (replay.kind === "decided") assert.equal(replay.replayed, true);
    assert.equal(calls, 1, "must not re-query a model after a decision");
    const events = store.readSource("cos.dsl.recovery");
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((x) => x.payload?.phase), ["started", "answered"]);
    assert.equal(JSON.stringify(events).includes("Component snapshot differs"), false);
  } finally { store.close(); }
}

{
  const store = new IntelligenceEventStore({ path: ":memory:" });
  let calls = 0;
  try {
    const options = { executor, store, evaluate: async () => {
      calls++; return { ...answer(), ok: false, answers: {}, error: "jev_http_503" };
    } };
    const first = await runRecoveryDsl(input, state, options);
    const second = await runRecoveryDsl(input, state, options);
    assert.equal(first.kind, "hold");
    assert.equal(second.kind, "hold");
    assert.equal(calls, 1, "ambiguous provider result must never be re-sent");
  } finally { store.close(); }
}

{
  const result = await runRecoveryDsl(input, state, {
    executor, testOnlyUndurable: true, evaluate: async () => answer(0.5),
  });
  assert.equal(result.kind, "decided");
  if (result.kind === "decided") assert.equal(result.action, "hold");
}

console.log("Flyd bounded CoS recovery ↔ real AgentRun interpreter: PASS");
