# Flyd World-Model Foundations

Status: implemented foundation, 2026-09-12

## Purpose

Flyd should be able to represent the current working state, predict the likely consequences of candidate actions, compare those futures explicitly, act only through existing authority boundaries, and later compare prediction with reality.

This is not a learned neural world model. The first implementation is deterministic, inspectable and replaceable.

## Runtime loop

```text
OBSERVE
  ↓
PRESENT / work hypothesis
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

This feature follows `docs/architecture/operational-truth-ownership.md`.

- Personal durable planning state belongs to the canonical `IntelligenceEventStore`.
- Action → next-state/outcome trajectories remain owned by the existing `cli/src/transitions/` spine.
- Planning does not create a second trajectory table or second truth authority.
- `stateBeforeId` and `stateAfterId` optionally link transition records to governed planning snapshots.
- PRESENT remains a projection and is never made durable merely because it was observed.

## Modules

- `cli/src/planning/world-model.ts`
  - `WorldStateSnapshot`
  - `TrajectoryEvent` projection type
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

Planning confidence uses shared bands:

- `high`
- `medium`
- `low`
- `unknown`

Reasons are stored alongside the band. Signals include freshness, supporting observations, contradictions, deterministic transitions, prior similar transitions, horizon and external dependencies.

## Tail-event preservation

Memory ranking now recognizes explicit signals for:

- surprise / novelty
- consequence / impact
- user correction
- failure
- major decision
- state transition
- unresolved blocker

When the preservation threshold is crossed, metadata records why and retrieval utility receives a bounded boost. Epistemic confidence is never increased by consequence alone.

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
- deterministic `FutureModel`, `ActionEvaluator` and `MultiStepPlanner` are available as composable Core primitives;
- `flyd eval planning` exercises the planner independently.

A caller that has multiple legitimate candidate actions can use these primitives before handing the selected action to the existing authority layer. We do not manufacture fake alternatives merely to force planning into a path that currently has one proposed action.

## Evaluation

Run:

```bash
cd cli
npm test -- src/planning/__tests__/world-model.test.ts
npm run lint
npm run build
node dist/entry.js eval planning
```

The planning benchmark currently encodes 20 representative cases including failing builds, stale state, blockers, approval boundaries, failed prior actions, external dependencies, reversibility and reachability-vs-proximity.

## Deliberate limits

- No neural world model.
- No autonomous execution added by planning.
- No bypass of grants, permissions or approval requirements.
- No ambient PRESENT persistence.
- No duplicate trajectory store.
- No opaque chain-of-thought persistence; planning traces contain structured decision inputs, predictions, scores, alternatives and uncertainty only.
- Semantic prediction remains a future `FutureModel` implementation behind the existing interface.
