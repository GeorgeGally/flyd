# Planning subsystem agent reference

This directory is Flyd's deterministic world-model foundation.

## Invariants

- PRESENT remains zero-persistence. Never turn ambient PRESENT observation into durable snapshots here.
- Create `WorldStateSnapshot` only at an explicit INVOKED or authorized agent-action boundary.
- Planning never grants authority. Execution still goes through existing Flyd permission, grant and approval machinery.
- Persist structured planning inputs/outputs, predictions, scores, alternatives and uncertainty. Never persist hidden chain-of-thought.
- Keep epistemic confidence separate from importance, retrieval utility, urgency and consequence.
- Prefer deterministic state transitions. Semantic/LLM prediction must implement `FutureModel` behind the same contract and expose assumptions/confidence.
- Every new planning heuristic should add or update a scenario in `benchmark.ts`.
- When a real outcome becomes observable, reconcile it with the prediction and retain the trajectory rather than silently overwriting the prediction.

## Architecture

```text
PRESENT / work hypothesis
  -> snapshotFromPresent (explicit boundary)
  -> FutureModel
  -> ActionEvaluator
  -> MultiStepPlanner
  -> existing execution authority
  -> observed snapshot
  -> reconcilePrediction
  -> trajectory/calibration data
```

## Verification

Run from `cli/`:

```bash
npm test -- src/planning/__tests__/world-model.test.ts
npm run lint
npm run build
node dist/entry.js eval planning
```
