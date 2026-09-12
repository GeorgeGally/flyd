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
- Every new planning heuristic should add or update a scenario in `benchmark.ts`.
- When a real outcome becomes observable, reconcile it with the prediction and retain the trajectory rather than silently overwriting the prediction.

## Architecture

```text
PRESENT / work hypothesis
  -> snapshotFromPresent (explicit boundary)
  -> GoalSpec + PlanningGap[]
  -> FutureModel
  -> ActionEvaluator
  -> MultiStepPlanner
  -> DecisionPolicy
       -> act | investigate | ask_user | defer
  -> ExecutionGuard.checkBefore
  -> existing execution authority
       -> supervised coding harness (one live trajectory per runCode attempt)
  -> observed snapshot
  -> ExecutionGuard.verifyAfter
  -> reconcilePrediction + causal attribution
  -> trajectory/calibration data
```

## Verification

Run from `cli/`:

```bash
npm test -- src/planning/__tests__/world-model.test.ts src/planning/__tests__/decision-policy.test.ts src/planning/__tests__/execution-guard.test.ts src/planning/__tests__/harness-trajectory.test.ts
npm run lint
npm run build
node dist/entry.js eval planning
```
