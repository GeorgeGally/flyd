# Flyd Operational Truth Ownership

**Status:** Architecture contract  
**Authority:** Companion to `docs/product/flyd-operational-architecture-prd.md`

Flyd may have multiple stores and projections, but every semantic fact must have exactly one canonical owner. Other systems may cache, project, observe, or summarize that fact; they must not become competing authorities.

## Ownership table

| Truth | Canonical owner | Current implementation | Consumers / projections | Migration direction |
|---|---|---|---|---|
| User intent and requested outcome | Intent / policy layer | Core resolution + runtime task creation | execution runtime, Present, intelligence | keep one intent-to-task path |
| Task lifecycle | Execution Runtime | `cli/src/runtime/task-store.ts` + runtime types | Present, UI, intelligence outcomes | canonicalize on `AgentTask` |
| Assignment lifecycle | Execution Runtime | `TaskAssignment` | supervisor, verifier, Present | keep |
| Authority / capability grant | Execution Runtime | `TaskGrant` | workers, verifier, supervisor | keep; UX presets compile to grants |
| Worker lifecycle | Execution Runtime | `WorkerSession` | reconciler, Present | keep |
| Worker controls | Execution Runtime | `WorkerCommand` | supervisor / adapters | keep |
| Artifacts | Execution Runtime | `TaskArtifact` + artifact files | verifier, UI, intelligence outcomes | keep one metadata authority |
| Verification | Execution Runtime | result verifier + assignment/task state | Present, intelligence outcome bridge | keep independent from worker claims |
| Integration / landed state | Execution Runtime reconciled with Git | integrator + repository evidence | Present, intelligence outcomes | reconcile rather than trust status |
| Open operational decision | Execution Runtime | currently fragmented / implicit | Present, UI | introduce first-class `OperationalDecision` |
| Repository existence / identity | Repository Intelligence | work-index repository registry | Present, runtime | keep one registry |
| Current repository snapshot | Repository Intelligence | Git observer + cached repository observation | Present, work hypothesis, runtime | all consumers use observer API |
| Git history / source | Git repository itself | Git | observer, verifier, runtime | repository remains external authority |
| Process liveness / identity | Observer / Reconciler | recovery + process inspection | supervisor | observation, never worker self-report |
| CI state | Observer / Reconciler | partial / provider-specific | supervisor, verification | add canonical observer |
| Personal durable meaning | Intelligence Runtime | `IntelligenceEventStore` | memory / policy / Present | keep event-sourced |
| User corrections and accepted/rejected outcomes | Intelligence Runtime | transitions / directives | policy, memory | keep |
| Present understanding | Present Model | work hypothesis + related projections | Mac, voice, CLI | projection only; no independent authority |
| Durable project-native knowledge | Repository | `AGENTS.md` + canonical docs | workers / Flyd | promote selectively |
| Live project belief (objective/blockers/next action) | Present / project projection | currently partly `PROJECT.md` | UI / reasoning | move out of auto-mutated repo docs |
| External current claims | Evidence Engine | evidence bundles | reasoning / Present where relevant | never silently become memory |
| Supervisor heartbeats / wake cursors / fingerprints | Operational runtime state | work-index/runtime fields | supervisor / observers | ephemeral or rebuildable only |

## Rules

### 1. Canonical owner versus observer

An observer can establish facts about external reality, but it does not own the underlying external object.

Example:

```text
Git repository owns HEAD.
RepositoryObserver owns Flyd's latest observation of HEAD.
Execution Runtime owns whether a task is considered integrated.
Reconciler compares these and corrects execution state when they disagree.
```

### 2. Canonical owner versus projection

Present is never an authority. It is a read model assembled from canonical state, observations, and explicit inferences.

A Present query must not silently mutate task state, Git state, project documentation, or worker state.

### 3. No permanent dual authority

During migration, the same fact may temporarily be dual-written. One side must be explicitly marked legacy/projection and there must be a retirement path.

### 4. Meaningful operational outcomes may cross into intelligence

Execution details stay operational. Consequential outcomes may be recorded as intelligence events.

Good bridge events:

- task verified
- task failed after retries
- user rejected intervention
- architectural constraint discovered and accepted
- work landed

Bad bridge events:

- PID changed
- heartbeat observed
- retry timer moved
- worktree path allocated

### 5. Repository Intelligence is the only general Git observation path

High-level subsystems must not independently shell out for basic repository state such as branch, HEAD, dirty state, or uncommitted-file count.

Deep Git operations remain valid when semantically required, but they should be exposed as Repository Intelligence capabilities rather than reimplemented ad hoc.

## Known duplicate truths to retire

1. `DelegationEnvelope` / `DelegationCompletion` versus runtime `AgentTask` / `TaskGrant` / `WorkerSession`.
2. Work-index tasks versus runtime delegated tasks.
3. Multiple independent Git reads in work-hypothesis, current-work, and runtime paths.
4. Dynamic `PROJECT.md` state versus Flyd's own live project understanding.
5. Completion claims versus verifier/integrator/repository evidence.

## Architectural test for new work

Every new stateful feature must answer:

1. Who owns this truth?
2. What is merely observing it?
3. What projections consume it?
4. How is disagreement reconciled?
5. Does it survive restart?
6. Does it belong in personal intelligence?

If question 1 has two answers, stop and consolidate before shipping.
