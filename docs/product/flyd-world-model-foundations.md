# Flyd World-Model Foundations

Status: implemented foundation + operational inspection, 2026-09-13

## Purpose

Flyd should be able to represent the current working state, predict the likely consequences of candidate actions, compare those futures explicitly, act only through existing authority boundaries, and compare prediction with reality.

This is not a learned neural world model. The current implementation is deterministic/empirical, inspectable and replaceable.

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
DECISION POLICY / SHORT-HORIZON PLAN
  ↓ existing approval / authority boundary
ACT
  ↓
OBSERVE OUTCOME
  ↓
PREDICTION RECONCILIATION
  ↓
TRAJECTORY + CALIBRATION DATA
  ↓
EMPIRICAL FUTURE EVIDENCE
```

PRESENT itself remains zero-persistence. `snapshotFromPresent()` only creates a durable snapshot when an authorized or explicit developer invocation asks Flyd to reason about a meaningful action boundary.

## Canonical ownership

This feature follows `docs/architecture/operational-truth-ownership.md` and extends the existing personal-intelligence runtime rather than creating a parallel model.

- Canonical world claims remain under `cli/src/intelligence/world/`.
- `WorldStateSnapshot` is defined alongside those world types as a point-in-time projection for planning.
- Personal durable planning state belongs to the canonical `IntelligenceEventStore`.
- Action → next-state/outcome trajectories remain owned by the existing `cli/src/transitions/` spine.
- Planning does not create a second world model, trajectory table, repository scanner, or truth authority.
- `stateBeforeId` and `stateAfterId` link transition records to governed planning snapshots.
- PRESENT remains a projection and is never made durable merely because it was observed.

## Modules

- `cli/src/intelligence/world/types.ts`
  - canonical claim/entity types
  - `WorldStateSnapshot` and provenance-bearing `StateFact`
- `cli/src/planning/future-model.ts`
  - `FutureModel`
  - `DeterministicFutureModel`
  - `ActionEvaluator`
  - `PlanningTrace`
  - `PredictionOutcome`
  - `MultiStepPlanner`
  - state diff + confidence calibration primitives
- `cli/src/planning/empirical-future-model.ts`
  - conservative effects and execution forecasts learned from repeated reconciled local runs
  - deterministic declarations always win
- `cli/src/planning/snapshot.ts`
  - governed conversion from caller-supplied PRESENT/work hypothesis state into a planning snapshot
- `cli/src/planning/runtime-capture.ts`
  - explicit action-boundary capture using foreground PRESENT plus the canonical cached repository index
- `cli/src/planning/store.ts`
  - governed persistence of snapshots, planning traces and prediction outcomes on `IntelligenceEventStore`
- `cli/src/planning/inspection.ts`
  - read-model for action trajectories, decisions, prediction calibration, action success and correction rate
- `cli/src/transitions/types.ts` + `writer.ts`
  - canonical trajectory spine, including optional `stateBeforeId` / `stateAfterId` references
- `cli/src/lib/tail-significance.ts`
  - consequence-aware preservation scoring for unusual/important memory events
- `cli/src/memory-gate.ts`
  - failed outcomes retained as sparse consequence signals; they are not automatically promoted into learned rules
- `cli/src/planning/benchmark.ts`
  - deterministic planning regression benchmark

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

The component scores remain inspectable. The weighted aggregate is intentionally simple and should be calibrated against observed outcomes rather than treated as permanent policy.

`DecisionPolicy` sits after ranking. A blocking evidence gap can deliberately select an investigation over a superficially higher-scoring execution action. User preference/approval gaps ask the user; unresolved evidence gaps defer rather than guess.

## Confidence and learning

Planning confidence uses shared bands: `high`, `medium`, `low`, `unknown`. Reasons are stored alongside the band. Signals include freshness, supporting observations, contradictions, deterministic transitions, prior similar transitions, horizon and external dependencies.

The empirical future model only promotes stable effects from repeated correlated local runs (minimum three examples and 80% consistency by default). It learns semantic effects such as a repeated blocker-clearing transition or repository dirty-state change, not volatile values like commit hashes. Execution success/failure remains a separate forecast rather than being fabricated as world state.

## Tail-event preservation

Tail handling operates at two layers:

1. Write/promotion boundary: failed outcomes survive the memory gate; corrections and durable decisions already survive through the existing learning gates.
2. Retrieval boundary: surprise, consequence, correction, failure, decision, state-transition and unresolved-blocker metadata can add a bounded retrieval-utility boost.

Importance never increases epistemic confidence.

## Closed feedback loop

The transition spine and planning store jointly represent:

```text
state_before
  → candidate actions
  → chosen action
  → predicted state/effects
  → real action
  → observed state
  → verified outcome
  → prediction reconciliation
  → future empirical evidence
```

Prediction reconciliation preserves both the original forecast and observed reality. `insufficient_evidence` outcomes stay in the dataset but are excluded from the prediction-correctness denominator. This gives Flyd calibration data without pretending an unmodeled effect was a wrong prediction.

## Operational visibility

The world-model foundation is exposed through developer/dogfood commands rather than remaining an invisible library:

```bash
flyd future
flyd future --goal "ship the active task"
flyd future --json

flyd trajectory
flyd trajectory --repo flyd --limit 10
flyd trajectory --json

flyd decisions
flyd decisions --limit 10
flyd decisions --json
```

`flyd future` is an explicit INVOKED planning boundary. It captures the current foreground/repository work state, uses empirical history when enough evidence exists, evaluates legitimate candidates through the existing harness decision policy, persists the structured trace, and **does not execute** the chosen action.

`flyd trajectory` reconstructs recent action → observed-outcome runs from the canonical transition events, including repository/task references and before/after planning snapshot links.

`flyd decisions` shows recent structured planning decisions plus the feedback metrics that matter for learning: resolved vs unresolved predictions, scorable correctness, supervised action success, user-correction rate, and confidence calibration buckets.

These commands do not introduce a new planner authority, storage layer, or repository scanner.

## Current integration boundary

- transition capture is live in overlay, CLI chat and supervised harness paths;
- live coding-harness decisions can choose blocker investigation before resume/execute;
- foreground state is live and secondary repository context reuses the bounded canonical work index;
- snapshot/trace/prediction persistence uses the canonical intelligence spine;
- deterministic and empirical `FutureModel` implementations share one contract;
- transition records link to planning snapshots without duplicating trajectory ownership;
- `flyd eval planning` exercises deterministic regression scenarios;
- `flyd future`, `flyd trajectory`, and `flyd decisions` expose the live loop for dogfooding and debugging.

A caller that has multiple legitimate candidate actions can use these primitives before handing the selected action to the existing authority layer. Flyd does not manufacture fake alternatives merely to force planning into a path that currently has one proposed action.

## Evaluation

Run:

```bash
cd cli
npm test -- src/planning/__tests__/world-model.test.ts src/planning/__tests__/runtime-capture.test.ts src/planning/__tests__/decision-policy.test.ts src/planning/__tests__/execution-guard.test.ts src/planning/__tests__/harness-trajectory.test.ts src/planning/__tests__/harness-learning.test.ts src/planning/__tests__/empirical-future-model.test.ts src/planning/__tests__/inspection.test.ts
npm run lint
npm run build
node dist/entry.js eval planning
node dist/entry.js future --json
node dist/entry.js trajectory --limit 5 --json
node dist/entry.js decisions --limit 5 --json
```

## Deliberate limits

- No neural world model.
- No autonomous execution added by planning.
- No bypass of grants, permissions or approval requirements.
- No ambient PRESENT persistence.
- No duplicate world-model, trajectory store, or repository scanner.
- No opaque chain-of-thought persistence; planning traces contain structured decision inputs, predictions, scores, alternatives and uncertainty only.
- LLM/semantic prediction remains a future `FutureModel` implementation behind the existing interface; current uncertain predictions fall back to deterministic/empirical evidence rather than inventing effects.
