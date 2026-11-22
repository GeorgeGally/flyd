/**
 * 100 scripted, synthetic negative-control episodes for the actual DSL runtime.
 * NOT an independently labelled or live-provider outcome-quality benchmark.
 * Measures only reproducible wiring/safety and interpreter overhead.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { runWorkflow, validateWorkflow } from "@parcha/agentrun-dsl";
import { runRecoveryDsl } from "../../cli/src/command/cos/decision-workflows/recovery-runner.js";
import type { RecoveryInput } from "../../cli/src/command/cos/recovery.js";
import type { PredicateEvaluation } from "../../cli/src/cognition/system-one/types.js";

const executor = { runWorkflow, validateWorkflow } as any;
const baseline: RecoveryInput = {
  objective: { id: "obj-synthetic", briefRevision: 0, words: "Repair a unit test", adaptations: [] },
  run: { key: "r1", team: "coding", outcome: "Repair unit test", attempt: 1, ref: "internal-run" },
  failure: "A unit test failed", retryable: true, effectKnownInternal: true,
};
const state = {
  source_state: "coding", summary: "A unit test failed",
  question: "Choose a bounded internal recovery", options: ["rebrief", "hold"],
  goal_context: "Fix code",
};
function response(choice: string, p: number): PredicateEvaluation {
  return {
    ok: true, evaluator: "jev", model: "synthetic", rubricVersion: "v1",
    projectionHash: "fake-hash", evaluatedAt: "2026-11-22T00:00:00Z",
    latencyMs: 0, answers: {
      cos_recovery_tactic: {
        id: "cos_recovery_tactic", type: "choice", choice,
        confidence: p, probability: p,
        probabilities: {
          rebrief_with_different_tactic: choice === "rebrief_with_different_tactic" ? p : 1 - p,
          hold_for_evidence: choice === "hold_for_evidence" ? p : 1 - p,
        },
      },
    },
  };
}
const cases = Array.from({ length: 100 }, (_, index) => {
  const kind = index % 10;
  const modified: RecoveryInput = {
    ...baseline,
    objective: { ...baseline.objective, id: "obj-synthetic-" + index },
    run: { ...baseline.run, key: "r" + index },
  };
  if (kind === 6) modified.objective.words = "Send email to client";
  if (kind === 7) modified.effectKnownInternal = false;
  if (kind === 8) modified.run.attempt = 3;
  return {
    index, kind, input: modified,
    expected: kind === 0 ? "rebrief" : "hold",
    expectedCalls: kind >= 6 ? 0 : 1,
  };
});

const durations: number[] = [];
let casesPassed = 0, calls = 0, unsafeActions = 0;
for (const test of cases) {
  const { kind } = test;
  let localCalls = 0;
  const started = performance.now();
  const outcome = await runRecoveryDsl(test.input, state, {
    executor, testOnlyUndurable: true,
    current: () => kind !== 9,
    evaluate: async () => {
      localCalls++;
      switch (kind) {
        case 0: return response("rebrief_with_different_tactic", 0.96);
        case 1: return response("hold_for_evidence", 0.97);
        case 2: return response("rebrief_with_different_tactic", 0.50);
        case 3: return response("rebrief_with_different_tactic", 0.79);
        case 4: return { ...response("rebrief_with_different_tactic", 0.96), answers: {} };
        case 5: return { ...response("rebrief_with_different_tactic", 0.96), ok: false, answers: {}, error: "jev_http_503" };
        default: return response("rebrief_with_different_tactic", 0.96);
      }
    },
  });
  const action = outcome.kind === "decided" ? outcome.action : "hold";
  const elapsed = performance.now() - started;
  durations.push(elapsed);
  calls += localCalls;
  if (action === "rebrief" && (kind >= 6 || test.input.effectKnownInternal === false)) unsafeActions++;
  assert.equal(action, test.expected, "case " + test.index + " wrong disposition");
  assert.equal(localCalls, test.expectedCalls, "case " + test.index + " duplicate/unwanted model call");
  casesPassed++;
}

durations.sort((a, b) => a - b);
const percentile = (q: number) => Number(durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * q))].toFixed(3));
assert.equal(casesPassed, 100);
assert.equal(unsafeActions, 0);
console.log(JSON.stringify({
  experiment: "agentrun-dsl-internal-recovery",
  evidence: "synthetic-only; injected decisions; not user task success, provider accuracy, or representative latency",
  workflowCases: casesPassed,
  scriptedModelCalls: calls,
  unsafeActions,
  p50InterpreterAndHostMs: percentile(0.5),
  p95InterpreterAndHostMs: percentile(0.95),
}, null, 2));
