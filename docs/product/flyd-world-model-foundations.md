# Flyd World-Model Foundations

Status: implemented foundation, 2026-09-12

## Purpose

Flyd should be able to represent the current working state, predict the likely consequences of candidate actions, compare those futures explicitly, act only through existing authority boundaries, and later compare prediction with reality.

This is not a learned neural world model. The first implementation is deterministic, inspectable and replaceable.

## Runtime loop

```text
OBSERVE
  ↓
PRESENT / canonical world projection
  ↓ explicit INVOKED or agent-action boundary
WORLD STATE SNAPSHOT
  ↓
FUTURE MODEL
  ↓
ACTION EVALUATOR
  ↓
SHORT-HORIZON PLAN
  ↓ existing approval / authority boundary
ACT
  ↓
OBSERVE OUTCOME
  ↓
PREDICTION RECONCILIATION
  ↓
TRAJECTORY + CALIBRATION DATA
```

PRESENT itself remains zero-persistence. `snapshotFromPresent()` only creates a durable snapshot when an authorized caller explicitly invokes it at a meaningful action boundary.

## Canonical ownership

This feature follows `docs/architecture/operational-truth-ownership.md` and extends the existing personal-intelligence runtime rather than creating a parallel model.

- Canonical world claims remain under `cli/src/intelligence/world/`.
- `WorldStateSnapshot` is defined alongside those world types as a point-in-time projection for planning.
- Personal durable planning state belongs to the canonical `IntelligenceEventStore`.
- Action → next-state/outcome trajectories remain owned by the existing `cli/src/transitions/` spine.
- Planning does not create a second world model, trajectory table, or truth authority.
- `stateBeforeId` and `stateAfterId` optionally link transition records to governed planning snapshots.
- PRESENT remains a projection and is never made durable merely because it was observed.

## Modules

- `cli/src/intelligence/world/types.ts`
  - canonical claim/entity types
  - `WorldStateSnapshot` and provenance-bearing `StateFact`
- `cli/src/intelligence/world/world-model.ts`
  - existing claim/belief lifecycle projection; unchanged as canonical world authority
- `cli/src/planning/future-model.ts`
  - `FutureModel`
  - `DeterministicFutureModel`
  - `ActionEvaluator`
  - `PlanningTrace`
  - `PredictionOutcome`
  - `MultiStepPlanner`
  - state diff + confidence calibration primitives
- `cli/src/planning/snapshot.ts`
  - governed conversion from caller-supplied PRESENT/work hypothesis state into a planning snapshot
- `cli/src/planning/store.ts`
  - governed persistence of snapshots, planning traces and prediction outcomes on `IntelligenceEventStore`
- `cli/src/transitions/types.ts` + `writer.ts`
  - canonical trajectory spine, extended with optional `stateBeforeId` / `stateAfterId` references
- `cli/src/lib/tail-significance.ts`
  - consequence-aware preservation scoring for unusual/important memory events
- `cli/src/memory-gate.ts`
  - failed outcomes retained as sparse consequence signals; they are not automatically promoted into learned rules
- `cli/src/planning/benchmark.ts`
  - 20-scenario deterministic regression benchmark
- `cli/src/commands/planning-eval.ts`
  - `flyd eval planning [--json]`

## Action evaluation

Actions are evaluated using explicit dimensions rather than semantic proximity alone:

- progress
- reachability
- leverage
- urgency
- user effort
- risk
- reversibility
- confidence

The component scores remain inspectable. The initial weighted aggregate is intentionally simple and should be calibrated against observed outcomes rather than treated as permanent policy.

## Confidence

Planning confidence uses shared bands: `high`, `medium`, `low`, `unknown`.

Reasons are stored alongside the band. Signals include freshness, supporting observations, contradictions, deterministic transitions, prior similar transitions, horizon and external dependencies.

## Tail-event preservation

Tail handling operates at two layers:

1. Write/promotion boundary: failed outcomes survive the memory gate; corrections and durable decisions already survive through the existing learning gates.
2. Retrieval boundary: surprise, consequence, correction, failure, decision, state-transition and unresolved-blocker metadata can add a bounded retrieval-utility boost.

Importance never increases epistemic confidence.

## Learning data

The existing transition spine already captures action → outcome pairs. This foundation allows those events to reference governed before/after snapshots, producing:

```text
state_before → action → predicted_state → observed_state → outcome
```

Prediction reconciliation stores the comparison separately, preserving both the original forecast and observed reality. This provides the substrate for calibration and, later, a learned dynamics model without committing Flyd to one today.

## Current integration boundary

The planning engine is deliberately not inserted as a new execution authority. Existing invocation, harness, grant and approval paths remain unchanged.

Today:

- transition capture is already live in overlay, CLI chat and harness paths;
- snapshot/trace/prediction persistence uses the canonical intelligence spine;
- deterministic `FutureModel`, `ActionEvaluator` and `MultiStepPlanner` are composable Core primitives;
- transition records can link to planning snapshots without duplicating trajectory ownership;
- `flyd eval planning` exercises the planner independently.

A caller that has multiple legitimate candidate actions can use these primitives before handing the selected action to the existing authority layer. We do not manufacture fake alternatives merely to force planning into a path that currently has one proposed action.

## Evaluation

Run:

```bash
cd cli
npm test -- src/planning/__tests__/world-model.test.ts src/__tests__/memory-gate.test.ts
npm run lint
npm run build
node dist/entry.js eval planning
```

The planning benchmark encodes 20 representative cases including failing builds, stale state, blockers, approval boundaries, failed prior actions, external dependencies, reversibility and reachability-vs-proximity.

## Deliberate limits

- No neural world model.
- No autonomous execution added by planning.
- No bypass of grants, permissions or approval requirements.
- No ambient PRESENT persistence.
- No duplicate world-model or trajectory store.
- No opaque chain-of-thought persistence; planning traces contain structured decision inputs, predictions, scores, alternatives and uncertainty only.
- Semantic prediction remains a future `FutureModel` implementation behind the existing interface.
