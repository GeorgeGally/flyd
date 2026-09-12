# Planning subsystem agent reference

This directory is Flyd's deterministic world-model foundation.

## Invariants

- PRESENT remains zero-persistence. Never turn ambient PRESENT observation into durable snapshots here.
- Create `WorldStateSnapshot` only at an explicit INVOKED or authorized agent-action boundary.
- Planning never grants authority. Execution still goes through existing Flyd permission, grant and approval machinery.
- Persist structured planning inputs/outputs, predictions, scores, alternatives and uncertainty. Never persist hidden chain-of-thought.
- Keep epistemic confidence separate from importance, retrieval utility, urgency and consequence.
- Prefer deterministic state transitions. Semantic/LLM prediction must implement `FutureModel` behind the same contract and expose assumptions/confidence.
- Goals should expose explicit success criteria when they are known. Do not keep taking actions after those criteria are satisfied.
- A blocking information gap must interrupt action selection. Investigate first when Flyd can resolve the gap; ask the user only for genuine preference/approval; otherwise defer instead of guessing.
- `DecisionPolicy` sits between ranking and execution. It may recommend act/investigate/ask/defer, but it never grants execution authority.
- An action reaching execution must satisfy its declared preconditions in `ExecutionGuard`. Approval remains a separate explicit input; a satisfied state precondition never implies approval.
- Verify declared postconditions after execution. Absence of postconditions means outcome verification is unknown, not successful by default.
- Correlation is not causation. Attribute an observed change to Flyd only when it matches a predicted effect and complete correlated tool/verifier evidence exists. Otherwise retain weaker `action_consistent`, `external_or_unknown`, or `contradictory` labels.
- Treat one supervised `runCode()` attempt as the live harness action boundary. Worker routing/retries are implementation detail; task grants, worker authority, verification, and integration remain owned by the existing runtime harness.
- The prediction, action trajectory, observed after-state, and reconciliation for a live harness run must share one correlation id.
- If a prediction declares no expected effects, reconcile it as `insufficient_evidence` even when the world changes. Retain the observed changes for future modeling, but never score an unmodeled transition as wrong.
- Calibration distinguishes observed runs from scorable predictions. `insufficient_evidence` belongs in the learning dataset but is excluded from the correctness denominator.
- Empirical effects are subordinate to declared deterministic effects. Promote them only from repeated correlated local runs: minimum three comparable examples and at least 80% consistency by default. A single run must never become a rule.
- Do not learn volatile exact values such as commit hashes as transition laws. Start with stable semantic effects and widen only with benchmark evidence.
- Learn repository effects by stable repository identity/root, not array position. A cross-repo rule must only materialize when that same repository is present in the current snapshot.
- Never memorise blocker text as a generic law. It is acceptable to learn stable structure such as repeated blocker-clearing, but not to predict the contents of a future blocker from unrelated runs.
- Supervised execution/verification outcome is not world state. Keep execution forecasts separate from `expectedEffects`; use them to inform reachability/risk/confidence, never to fabricate snapshot changes or execution authority.
- INVOKED multi-repo context must reuse the canonical SQLite work index. Do not add another repository scanner. The foreground repo may be live PRESENT; secondary repo state must come from a bounded, fresh cached observation.
- Never present a stale cached dirty/branch state as current. Secondary repository observations older than the planning freshness window are omitted rather than guessed.
- Blockers must come from authoritative runtime/work evidence. Prefer explicit blocked worker reasons; if only blocked task status is known, state that the task is blocked without inventing the cause.
- If work-index context is unavailable, keep the foreground live snapshot usable rather than failing the action.
- If empirical history is unavailable, prediction must fall back to the deterministic baseline rather than blocking execution.
- Every new planning heuristic should add or update a scenario in `benchmark.ts` or a planning-gated regression test.
- When a real outcome becomes observable, reconcile it with the prediction and retain the trajectory rather than silently overwriting the prediction.

## Architecture

```text
PRESENT foreground + canonical work index
  -> INVOKED context projection
       -> live foreground repo
       -> fresh cached active secondary repos
       -> grounded blocker observations
  -> snapshotFromPresent (explicit boundary)
  -> GoalSpec + PlanningGap[]
  -> FutureModel
       -> deterministic effects first
       -> conservative empirical state effects from repeated reconciled runs
       -> separate supervised execution/verification forecast
  -> ActionEvaluator
  -> MultiStepPlanner
  -> DecisionPolicy
       -> act | investigate | ask_user | defer
  -> ExecutionGuard.checkBefore
  -> existing execution authority
       -> supervised coding harness (one live trajectory per runCode attempt)
  -> observed snapshot + runtime result
  -> ExecutionGuard.verifyAfter
  -> reconcilePrediction + causal attribution
  -> trajectory/calibration data
       -> empirical transition + execution history
```

## Verification

Run from `cli/`:

```bash
npm test -- src/planning/__tests__/world-model.test.ts src/planning/__tests__/runtime-capture.test.ts src/planning/__tests__/decision-policy.test.ts src/planning/__tests__/execution-guard.test.ts src/planning/__tests__/harness-trajectory.test.ts src/planning/__tests__/harness-learning.test.ts src/planning/__tests__/empirical-future-model.test.ts
npm run lint
npm run build
node dist/entry.js eval planning
```
