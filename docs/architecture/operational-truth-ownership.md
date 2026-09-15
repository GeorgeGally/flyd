# Flyd Operational Truth Ownership

**Status:** Implemented architecture contract  
**Authority:** Companion to `docs/product/flyd-operational-architecture-prd.md`  
**Implementation milestone:** 14 September 2026

Flyd may have multiple stores and projections, but every semantic fact has exactly one canonical owner. Other systems may cache, project, observe, or summarize that fact; they must not become competing authorities.

## Ownership table

| Truth | Canonical owner | Implementation | Consumers / projections | Disposition |
|---|---|---|---|---|
| User intent and requested outcome | Intent / policy layer | Core resolution + `RuntimeTaskRequest` | execution runtime, Present, intelligence | canonical; legacy manifest magic-phrase delegation is inert |
| Executable task lifecycle | Execution Runtime | `AgentTask` in `cli/src/runtime/task-store.ts` | Present, UI, intelligence outcomes | canonical |
| Project/manual todo | Work projection | `ProjectTodo` in `cli/src/work/task-store.ts` | hypothesis, CLI planning surfaces | planning-only; never execution authority |
| Assignment lifecycle | Execution Runtime | `TaskAssignment` | supervisor, verifier, Present | canonical |
| Authority / capability grant | Execution Runtime | `TaskGrant` | workers, verifier, supervisor | canonical |
| Worker lifecycle | Execution Runtime | `WorkerSession` | reconciler, Present | canonical |
| Worker controls | Execution Runtime | `WorkerCommand` | supervisor / adapters | canonical |
| Artifacts | Execution Runtime | `TaskArtifact` | verifier, UI, intelligence outcomes | canonical metadata authority |
| Verification | Execution Runtime | result verifier + assignment state | Present, intelligence outcome bridge | canonical; independent of worker claims |
| Integration / landed state | Execution Runtime reconciled with Git | integrator + repository evidence, gated by the task's delivery contract | Present, intelligence outcomes | canonical after repository verification |
| Open operational decision | Execution Runtime | `OperationalDecisionStore` + deterministic runtime-event fold | Present, supervisor, UI | canonical; only explicit decision events close it |
| Repository existence / identity | Repository Intelligence | work-index repository registry | Present, runtime | canonical registry |
| Current repository observation | Repository Intelligence | repository observer/facade + cached observation fingerprint | Present, work hypothesis, current-work | canonical high-level Git observation |
| Git source/history | Git repository itself | Git | observer, verifier, integrator | external authority |
| Process liveness / identity | Observer / Reconciler | process identity + worker reconciler | supervisor | observation; worker self-report is insufficient |
| Personal durable meaning | Intelligence Runtime | `IntelligenceEventStore` | memory, policy, Present | canonical event spine |
| User corrections / meaningful outcomes | Intelligence Runtime | transitions and intelligence events | policy, memory | canonical semantic history |
| Present understanding | Present Model | work hypothesis + runtime-aware composition | Mac, voice, CLI, work-intelligence | projection only; never authority |
| Durable project-native knowledge | Repository | human docs + bounded Flyd-maintained `AGENTS.md` section | workers / Flyd | selective promotion only |
| Live project belief | Present / project projection | Present Model | UI / reasoning | `PROJECT.md` is not live authority |
| External current claims | Evidence Engine | evidence bundles | reasoning / Present | evidence only until promoted by policy |
| Supervisor cursors / fingerprints / observations | Operational runtime/cache | runtime and work-index fields | supervisor / observers | rebuildable operational state |

## Rules

### 1. Canonical owner versus observer

An observer can establish facts about external reality, but it does not own the underlying external object.

```text
Git repository owns HEAD.
Repository Intelligence owns Flyd's latest observation of HEAD.
Execution Runtime owns whether a task is integrated.
Reconciler compares recorded state with reality.
```

### 2. Canonical owner versus projection

Present is never an authority. A Present read must not silently mutate task state, Git state, project documentation, or worker state.

Present preserves epistemic class:

```text
FACT        durable runtime truth such as an open decision
OBSERVATION reconciled external/runtime evidence
INFERENCE   work hypothesis / likely current focus
```

### 3. No permanent dual authority

Compatibility may preserve old names or schemas, but semantic ownership must remain singular.

Examples now enforced:

- `ProjectTodo` may still live in the historical SQLite `tasks` table, but it is not an `AgentTask`.
- `DelegationEnvelope` remains a deprecated type alias only; product routing cannot launch it.
- `PROJECT.md` may be explicitly imported as planning todos, but it is not automatically rewritten and is not runtime truth.

### 4. Meaningful operational outcomes may cross into intelligence

Good bridge events:

- task verified
- work landed
- task failed after meaningful retries
- user accepted/rejected an intervention
- durable project constraint was accepted

Operational-only details such as PID, heartbeat, worktree path, retry cursor, or grant lease stay out of personal intelligence.

### 5. Repository Intelligence is the general Git observation path

High-level subsystems must not independently reconstruct basic Git state such as branch, HEAD, dirty state, or uncommitted-file count.

Deep Git operations inside verifier/integrator remain legitimate execution mechanics because they establish independent evidence rather than competing Present state.

### 6. Intent requests do not carry execution authority

```text
RuntimeTaskRequest
  -> independently observed RepositorySnapshot
  -> AgentTask
  -> orientation
  -> TaskGrant
  -> assignments / workers
  -> verification
  -> integration
```

Authority comes from `TaskGrant`, never from an intent/delegation request.

Runtime integration additionally requires the task's delivery contract, recorded at creation as `context_snapshot.delivery` (`mode` + `mergeAuthority`), to authorize it; a missing or ambiguous contract fails closed and is never guessed.

### 7. Restart is reconciliation

Continuous supervision compares durable worker/task state with process/worktree reality. Surviving workers are preserved when identity is proven. Detached successful work can be re-verified and, when its delivery contract authorizes runtime integration, integrated after restart; otherwise recovery records the integration as blocked. Multi-repository recovery is allowed only when every source repository remains clean on `main` at its recorded assignment base HEAD.

### 8. Project knowledge promotion is bounded

Flyd may promote high-confidence durable project-native knowledge to the generated section of `AGENTS.md`.

Good candidates:

- build/test commands
- architectural boundaries
- durable constraints
- conventions and workflows
- persistent gotchas
- dangerous operations

Task-local or temporary state is rejected. Human-authored AGENTS content is preserved.

## Persistence disposition

Architectural singularity does not require a single database.

| Persistence surface | Disposition | Semantic ownership |
|---|---|---|
| Runtime PostgreSQL | **KEEP** | executable tasks, assignments, grants, workers, commands, artifacts, operational decisions, verification/integration |
| `intelligence.sqlite` | **KEEP** | durable personal/world meaning and provenance-bearing intelligence events |
| `work-index.sqlite` | **KEEP AS PROJECTION/CACHE** | repository registry/observations, work hypothesis support, project/manual todos; never execution authority |
| Git repositories | **KEEP EXTERNAL AUTHORITY** | source, Git history, canonical project docs, AGENTS.md |
| Legacy delegation in-memory completion bridge | **COMPATIBILITY ONLY** | no execution authority; product routing is disabled |
| `PROJECT.md` task import | **COMPATIBILITY / USER-INVOKED** | optional planning input only |
| Work-intelligence job/filesystem receipts | **KEEP WHERE DOMAIN-SPECIFIC** | job scheduling/audit artifacts only; not task or Present authority |

Storage may be consolidated later if it simplifies operations, but there is no remaining architectural requirement to migrate stores merely to reduce database count.

## Migration completion

The consolidation goals from the Operational Architecture PRD are implemented:

1. Repository observations have explicit fingerprint/cache semantics and high-level consumers use Repository Intelligence.
2. `AgentTask` runtime is the sole executable task model; legacy delegation routing is inert.
3. Operational decisions are first-class and cannot be buried by worker chatter.
4. Restart recovery is reattach/reconcile-first.
5. Continuous deterministic supervision runs without model polling.
6. Detached completions are independently re-verified before integration, including safe multi-repository recovery.
7. Present composes facts, observations, and inferences and includes runtime tasks/decisions/workers.
8. Git observation no longer mutates `PROJECT.md`.
9. Work-index tasks are explicitly `ProjectTodo`s and planning-only.
10. Durable project knowledge has a bounded AGENTS promotion mechanism.
11. CI explicitly exercises the operational supervision/recovery/decision invariants.

## Architectural test for new work

Every new stateful feature must answer:

1. Who owns this truth?
2. What is merely observing it?
3. What projections consume it?
4. How is disagreement reconciled?
5. Does it survive restart?
6. Does it belong in personal intelligence?

If question 1 has two answers, stop and consolidate before shipping.
