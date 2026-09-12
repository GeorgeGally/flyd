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

PRESENT itself remains zero-persistence. `snapshotFromPresent()` only persists when an authorized caller explicitly creates a planning snapshot at a meaningful action boundary.

## Modules

- `cli/src/planning/world-model.ts`
  - `WorldStateSnapshot`
  - `TrajectoryEvent`
  - `FutureModel`
  - `DeterministicFutureModel`
  - `ActionEvaluator`
  - `PlanningTrace`
  - `PredictionOutcome`
  - `MultiStepPlanner`
  - state diff + confidence calibration primitives
- `cli/src/planning/snapshot.ts`
  - governed conversion from PRESENT/work hypothesis into a durable planning snapshot
- `cli/src/planning/store.ts`
  - SQLite persistence in the existing work-index for snapshots, trajectories, traces and prediction outcomes
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

Every meaningful action can eventually yield:

```text
state_before → action → predicted_state → observed_state → outcome
```

This provides the substrate for calibration and, later, a learned dynamics model without committing Flyd to one today.

## Evaluation

Run:

```bash
cd cli
npm test
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
- No opaque chain-of-thought persistence; planning traces contain structured decision inputs, predictions, scores, alternatives and uncertainty only.
- Semantic prediction remains a future `FutureModel` implementation behind the existing interface.
