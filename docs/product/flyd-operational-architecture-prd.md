# Flyd Operational Architecture PRD

**Status:** Proposed product/architecture authority  
**Date:** 11 September 2026  
**Scope:** Work awareness, repository intelligence, delegation, supervision, recovery, project knowledge  
**Objective:** Establish a coherent long-term architecture rather than layering more state systems onto Flyd.

---

## 1. Executive Summary

Flyd already contains most of the hard capabilities required for reliable delegated work:

- repository discovery and Git observation
- a Present/work-hypothesis model
- worker adapters
- agent tasks and assignments
- explicit task grants
- isolated Git worktrees
- worker process supervision
- independent verification
- integration and rollback
- personal-intelligence events
- transition/outcome capture
- project state files
- memory and retrieval

The principal weakness is no longer missing capability.

It is **multiple overlapping representations of the same reality**.

Examples include:

- several Git inspection paths
- multiple task concepts
- two delegation contracts
- work-index tasks versus runtime tasks
- `PROJECT.md` state versus Present Model state
- runtime outcomes versus intelligence transitions
- PostgreSQL, SQLite and filesystem persistence with unclear long-term ownership

The goal of this project is therefore:

> **Give every kind of truth exactly one canonical owner and make Flyd continuously reconcile those truths into a trustworthy understanding of the present.**

Flyd should become more capable by becoming simpler internally.

---

## 2. Product Principle

Flyd is a personal intelligence capable of acting.

It is not primarily a coding orchestrator.

FirstMate is useful because it has developed strong operational discipline around agent execution, but Flyd should adopt those principles inside a broader intelligence architecture rather than become FirstMate.

FirstMate defines itself narrowly as the layer between one person's intent and the agents carrying it out. Flyd's active product authority is broader: a local-first personal intelligence whose interfaces share one runtime and one model of the user's world.

Therefore:

- **FirstMate contributes execution discipline.**
- **Flyd retains intelligence ownership.**

---

## 3. Design Goals

Flyd must eventually satisfy six properties.

### 3.1 Continuous understanding

Flyd should know what the user is working on before being asked.

### 3.2 Reliable delegation

A user should be able to state an outcome once and look away.

### 3.3 Reality-grounded supervision

Recorded state must continuously reconcile against observable Git, process, worktree and verification reality.

### 3.4 Restart indifference

Restarting Flyd must not lose, duplicate or unnecessarily terminate valid work.

### 3.5 Explicit knowledge placement

Personal knowledge, project knowledge, task state and external evidence must not leak into one another.

### 3.6 Architectural singularity

There should be one canonical mechanism for each major concern.

Not:

```text
Git awareness A
Git awareness B
Git awareness C
```

but:

```text
Repository Intelligence
       ↓
all consumers
```

---

## 4. Canonical Architecture

The long-term architecture should contain six clearly separated systems.

```text
                           FLYD CORE
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
          INTENT          EXECUTION        INTELLIGENCE
          & POLICY         RUNTIME           MEMORY
             │                │                │
             │          tasks / grants         │
             │          assignments            │
             │          workers                │
             │          artifacts              │
             │          verification           │
             │                │                │
             │                ▼                │
             │           RECONCILER            │
             │                ▲                │
             │                │                │
             │           OBSERVERS             │
             │      git/process/CI/worktree    │
             │                │                │
             └────────────────┼────────────────┘
                              ▼
                       PRESENT MODEL
                    fact + observation
                        + inference
                              │
                              ▼
                    Mac / Voice / CLI
```

Supporting all of these:

```text
PROJECT KNOWLEDGE
AGENTS.md + canonical project docs
```

---

## 5. The Six Canonical Owners

### 5.1 Intent & Policy

Owns:

- what the user asked for
- whether Flyd should act
- authority
- consequence policy
- attention policy
- intervention decisions
- task shaping

It does not execute work itself.

### 5.2 Execution Runtime

Owns operational work.

Canonical objects:

```text
Task
Assignment
Grant
Worker
WorkerCommand
Artifact
Verification
Integration
Decision
```

Flyd already has a strong version of most of this through `AgentTask`, `TaskAssignment`, `TaskGrant`, `WorkerSession`, `WorkerCommand` and `TaskArtifact`.

These become the canonical operational vocabulary.

There must not be a second parallel delegation/task model.

### 5.3 Observers

Own observation of external/local reality.

Examples:

```text
RepositoryObserver
ProcessObserver
WorktreeObserver
CIObserver
ForegroundObserver
```

Observers answer factual questions.

They do not interpret meaning.

Example:

```text
HEAD = abc123
branch = main
dirty = true
PID 5512 exists
worktree changed 34 seconds ago
test command exited 1
```

Observers should be reusable infrastructure.

Consumers must not independently reimplement these observations.

### 5.4 Reconciler

The Reconciler compares recorded operational state against observed reality.

Example:

```text
Runtime says:
worker = running

Observer says:
process missing
worktree intact
uncommitted changes exist

Reconciler derives:
worker execution interrupted
work preserved
resume candidate
```

It owns **operational truth correction**.

This is the architectural role most strongly inspired by FirstMate.

### 5.5 Intelligence Memory

Owns durable meaning about the person and their world.

Its canonical representation remains provenance-bearing events and projections, as defined in the Personal Intelligence PRD.

This includes things such as:

```text
verified outcome
user correction
preference
persistent goal
important learned pattern
accepted/rejected intervention
meaningful work outcome
```

It does not need every operational mutation.

For example:

```text
PID changed
retry queued
worker heartbeat
worktree path
```

do not belong in personal intelligence.

The correct bridge is: operational machinery stays operational while a meaningful verification or outcome may emit a personal-intelligence transition.

### 5.6 Present Model

The Present Model is Flyd's synthesized understanding of now.

It is not a primary store.

It combines three epistemic classes.

#### Fact

Examples:

```text
open task exists
decision is unresolved
verification passed
task landed
```

#### Observation

Examples:

```text
Bloom has uncommitted changes
worker is alive
Obj0 HEAD changed yesterday
Bloom is foreground
```

#### Inference

Examples:

```text
Bloom appears to be the user's primary current project
Obj0 is probably dormant
the likely next action is X
```

These categories must remain distinguishable.

This directly follows Flyd's existing requirement that observed fact, inferred belief, user intention and verified outcome remain separate.

---

## 6. Major Architectural Consolidations

### 6.1 One Delegation Model

Flyd currently has two.

#### Older model

`cli/src/delegation.ts` defines:

```text
DelegationEnvelope
goal
finishCondition
completionContract
grant
DelegationCompletion
```

#### Newer runtime

The runtime defines:

```text
AgentTask
TaskAssignment
TaskGrant
WorkerSession
WorkerCommand
TaskArtifact
```

and has real orchestration, worktrees, process ownership, verification and integration.

The newer runtime is the stronger architecture.

#### Decision

**Retire `DelegationEnvelope` as an independent execution model.**

Do not expose the old dormant DELEGATED pipeline directly to the Mac adapter.

Instead:

```text
user intent
    ↓
ExecutionIntent
    ↓
AgentTask
    ↓
TaskAssignment(s)
    ↓
TaskGrant
    ↓
Worker Runtime
```

Existing completion/handoff semantics should be migrated into the runtime where valuable.

---

## 7. One Repository Intelligence Layer

Today repository state is obtained through several paths.

At least:

```text
cli/src/work/git-observer.ts

cli/src/work/work-hypothesis/engine.ts
  live git commands

cli/src/work-intelligence/current-work.ts
  live git commands

runtime repository inspection
```

This must converge.

### Target

Create one canonical repository observation service.

Conceptually:

```ts
RepositoryState {
  repoId
  root

  head
  branch
  upstream?

  dirty
  stagedFiles
  modifiedFiles
  untrackedFiles

  worktrees

  recentCommits
  lastMeaningfulChangeAt

  observedAt
}
```

Support depths:

```text
snapshot
activity
diff
semantic
```

Consumers ask this service for state rather than executing Git themselves.

---

## 8. Fix Existing Git Observation Correctness

Current Git observation has a logic defect.

`computeFingerprint()` creates a hash over Git metadata, HEAD, branch and status.

`observeAllRepos()` compares this hash with `repo.lastSeenHead`.

But `lastSeenHead` is populated with the repository HEAD SHA.

Those are different semantic values.

So:

```text
fingerprint != HEAD
```

almost permanently.

Add an explicit:

```text
last_observation_fingerprint
```

rather than overloading `last_seen_head`.

This is exactly the sort of duplicate/ambiguous field semantics this PRD aims to eliminate.

---

## 9. PROJECT.md Should Stop Being Live Runtime State

Flyd currently stores:

```text
current objective
current state
active threads
open loops
blockers
important recent decisions
next actions
```

inside `PROJECT.md`.

It then automatically mutates some of those fields based on Git activity.

This mixes repository documentation with Flyd's current belief.

Those should be separated.

### End State

#### AGENTS.md

Contains durable project-native knowledge:

```text
architecture
commands
conventions
constraints
known gotchas
important invariant decisions
```

#### Flyd Project Projection

Contains dynamic current state:

```text
objective
active work
blockers
open loops
recent activity
likely next actions
```

#### PROJECT.md

Either:

- becomes a user-maintained strategic project document; or
- is retired.

Flyd should not continually commit its changing interpretation of active work into the user's repository.

---

## 10. Operational Decisions Become First-Class

An unresolved decision can disappear beneath later worker status unless decisions are folded independently.

Flyd should model decisions explicitly.

```ts
interface OperationalDecision {
  id: string;
  taskId: string;

  question: string;
  context: string;

  status:
    | "open"
    | "resolved"
    | "superseded"
    | "cancelled";

  requestedAt: string;

  resolution?: string;
  resolvedAt?: string;
}
```

A decision remains open until a corresponding resolution event occurs.

Worker chatter cannot overwrite it.

---

## 11. Restart Is a Reconciliation Problem

Current Flyd recovery contains useful process-identity safety mechanisms.

However, if a worker survives a Core restart but its previous supervisor observation is outside the short lease, recovery can terminate the process and mark the worker interrupted.

This should change.

### Recovery hierarchy

```text
1. rediscover
2. identify
3. reattach
4. reconcile
5. continue
```

Only then:

```text
6. terminate / replace
```

when required.

A healthy worker should not die merely because its supervisor restarted.

---

## 12. Supervisor Architecture

The supervisor must not continuously use an LLM.

Use deterministic mechanics for:

```text
process alive?
process belongs to worker?
worktree changing?
worker produced output?
verification pending?
authority expired?
decision open?
integration landed?
```

Only call intelligence when meaning is required.

Examples:

```text
worker claims complete
but verification failed

→ intelligence may decide retry strategy
```

or:

```text
worker blocked on architectural choice

→ intelligence determines whether it can resolve
→ otherwise user decision
```

---

## 13. Supervisor State Machine

Recommended classification:

```text
HEALTHY
WAITING_EXTERNAL
WAITING_DECISION
POSSIBLY_STALE
INTERRUPTED
VERIFYING
INTEGRATING
LANDED
FAILED
UNKNOWN
```

Supervisor action:

```text
NOOP
RECHECK
REATTACH
VERIFY
RESUME
RETRY
REPLACE
ASK_FLYD
ASK_USER
CLEANUP
```

These are separate concepts.

State is not action.

---

## 14. Worker Infrastructure

Keep the current worker abstraction.

The existing adapter already supports:

- capability declaration
- detection
- non-interactive assignment
- activity callbacks
- runtime timeout
- inactivity timeout
- authority checks
- process-group control
- external session IDs

Do not create another worker abstraction.

Add adapters as needed:

```text
Codex
Flyd-native
OpenCode
Claude Code
```

The task contract must remain harness-independent.

---

## 15. Verification

Keep the current verifier.

It already performs strong checks including:

- controlled verification environment
- network restrictions
- worktree scoping
- escaping-symlink detection
- deterministic patch capture
- command output hashing
- mutation detection between worker completion and verification

Build around it rather than replacing it.

Maintain explicit stages:

```text
worker_reported
verified
integrated
landed
deployed
```

"Done" is presentation language, not canonical state.

---

## 16. Scout and Ship

Adopt these as **task intents**, not competing task models.

```text
SCOUT
Understand something.

SHIP
Change something.
```

A Scout typically:

```text
readOnly = true
artifact = investigation report
```

A Ship typically:

```text
isolated worktree
verification required
integration path required
```

Both become ordinary `AgentTask`s beneath the UX.

---

## 17. Project Knowledge

Adopt the strongest memory-routing principle from FirstMate: knowledge useful to contributors of one project belongs with that project; task-specific knowledge belongs with the task.

For Flyd:

```text
Personal knowledge
→ Personal Intelligence

Project-native durable knowledge
→ AGENTS.md / canonical docs

Task-local state
→ Execution Runtime

Current external claims
→ Evidence layer

Current project understanding
→ Present projection
```

Never automatically dump all learned information into `AGENTS.md`.

---

## 18. AGENTS.md Maintenance

Flyd should eventually maintain project agent-readiness.

Good promotion candidates:

```text
build/test commands
architecture boundary
persistent failure gotcha
required workflow
known dangerous operation
canonical directory ownership
```

Bad candidates:

```text
current task
temporary blocker
today's branch
worker status
speculation
personal information
```

Promotion must be:

```text
inspect
→ compare
→ classify
→ deduplicate
→ propose/apply
```

not blind append.

---

## 19. Persistence End State

Architectural neatness is desirable here.

The target does not have to be one database.

It does require one canonical owner.

### Execution DB

Canonical for:

```text
tasks
assignments
grants
workers
worker commands
artifacts
verification
integration
operational decisions
```

Whether this ultimately remains PostgreSQL or moves to SQLite is an implementation decision.

For a single-user local-first product, SQLite is likely attractive long-term.

But migration should follow semantic consolidation rather than precede it.

### Intelligence DB

Canonical for:

```text
personal events
belief evidence
outcomes
corrections
policy learning
durable user/world meaning
```

### Repository

Canonical for:

```text
source
Git history
AGENTS.md
project documentation
```

### Ephemeral/runtime state

Canonical only for short-lived supervision details:

```text
poll cursors
heartbeat timestamps
observer fingerprints
wake deduplication
temporary leases
```

---

## 20. Store Retirement Rule

Every current store must eventually be classified:

```text
KEEP
MIGRATE
PROJECT
RETIRE
```

Known candidates include:

```text
intelligence.sqlite
work-index.sqlite
runtime PostgreSQL
job JSON store
outcome journal
PROJECT.md
transition store
conversation/archive stores
```

Do not maintain the same semantic fact indefinitely in two places.

Temporary dual-write during migration is acceptable.

Permanent dual authority is not.

---

## 21. Present Model v2

Present Model becomes the primary answer to:

```text
What am I working on?
What changed?
What's blocked?
What needs me?
What finished?
What is Flyd doing?
```

Model:

```ts
interface PresentWorkModel {
  facts: PresentFact[];
  observations: PresentObservation[];
  inferences: PresentInference[];

  activeWork: WorkSummary[];
  blockedWork: WorkSummary[];
  openDecisions: DecisionSummary[];
  recentOutcomes: OutcomeSummary[];
  projects: ProjectSummary[];

  generatedAt: string;
}
```

It should normally be immediately available.

A user query must not trigger a cold scan of every repository merely to construct basic situational awareness.

---

## 22. Present Reads Are Pure

Reading the Present Model may not:

```text
start workers
merge work
answer decisions
modify repositories
rewrite task state
```

Observation and action remain distinct.

---

## 23. Product Integration

The current repository still describes DELEGATED as dormant and the Mac adapter does not implement it.

There is little value in having excellent orchestration that Flyd itself cannot naturally invoke.

Once the execution architecture is consolidated:

```text
Mac / Voice / CLI
        ↓
     intent
        ↓
Flyd determines:
 answer / act / scout / ship
        ↓
Execution Runtime
```

Delegation becomes a normal manifestation of Flyd intelligence.

It should not require phrases like:

```text
"delegate this"
"spawn an agent"
```

The old delegation intent detector currently does this sort of regex matching.

That should disappear from the end-state UX.

Flyd decides whether delegation is the appropriate implementation of an intent.

---

## 24. Migration Plan

### Phase A — Architecture Inventory

Before changing storage, map every current representation of:

```text
task
worker
repository
project
decision
outcome
artifact
authority
Present state
knowledge
```

For each record:

```text
current owner
future owner
consumers
writers
migration path
```

**Exit:** every important semantic object has one declared future owner.

### Phase B — Repository Intelligence

Build/choose the single canonical `RepositoryObserver`.

Migrate all Git consumers onto it.

Fix current fingerprint semantics.

**Exit:** no high-level subsystem independently reconstructs basic repository truth.

### Phase C — Execution Model Consolidation

Make runtime:

```text
AgentTask
TaskAssignment
TaskGrant
WorkerSession
TaskArtifact
```

the canonical execution model.

Migrate useful semantics from:

```text
DelegationEnvelope
DelegationCompletion
legacy work-index task concepts
```

Retire duplicate delegation execution types.

**Exit:** one task lifecycle.

### Phase D — Reconciler

Implement desired-state × observed-state reconciliation.

Cover:

```text
workers
worktrees
Git
verification
integration
decisions
```

**Exit:** runtime can detect disagreement with reality without model reasoning.

### Phase E — Recovery

Change restart behavior to reattach-first.

Test:

```text
Core restart; worker survives
machine restart; worker does not
external merge while Core offline
worker dies leaving worktree
worker completes while supervisor offline
```

**Exit:** restart causes no unnecessary work loss.

### Phase F — Present Model v2

Move basic work understanding to continuously maintained projections.

Remove cold Git crawling from the ordinary status path.

Separate:

```text
fact
observation
inference
```

**Exit:** "What am I working on?" returns immediately and reliably.

### Phase G — Decisions

Introduce first-class unresolved decisions.

Integrate with Present.

**Exit:** no consequential decision can disappear behind subsequent activity.

### Phase H — Product Delegation

Replace old regex delegation routing with Core reasoning.

Connect Mac/Voice/CLI to the canonical execution runtime.

**Exit:** "Fix the Instagram pull issue" can naturally become delegated execution without saying "spawn an agent."

### Phase I — Project Knowledge

Add project-knowledge promotion.

Move dynamic project state away from automatically rewritten `PROJECT.md`.

**Exit:** `AGENTS.md` carries durable agent knowledge; Flyd carries live project understanding.

### Phase J — Persistence Cleanup

Now consolidate storage.

Possible target:

```text
flyd-runtime.sqlite
flyd-intelligence.sqlite
```

plus repository-native Git/docs.

Retire legacy stores incrementally.

**Exit:** no permanent duplicate truth.

---

## 25. What We Should Explicitly Not Copy From FirstMate

Do not copy:

- shell-script-heavy architecture
- terminal-pane semantics as product primitives
- text-file state merely because it is inspectable
- orchestration-specific UI as Flyd's primary product
- huge always-loaded AGENTS instructions
- fleet metaphors as domain architecture
- excessive runtime state encoded through files

Keep canonical instructions compact and load deeper guidance conditionally.

---

## 26. What We Should Copy

Copy aggressively:

- one human-facing intelligence
- user sees outcomes and decisions, not worker chatter
- restart as non-event
- explicit authority
- unlanded work preservation
- worker claims are not truth
- deterministic mechanics
- event-driven supervision
- explicit open decisions
- read-only status projection
- project-native knowledge in project
- harness/vendor independence
- low-token idle operation

These principles align with Flyd rather than merely imitating FirstMate.

---

## 27. P0 Priorities

The first actual implementation program should be:

### P0.1 Architecture map

No coding spree before ownership is documented.

### P0.2 Repository Observer consolidation

This fixes immediate work-awareness weakness.

### P0.3 Execution model consolidation

Kill the two-delegation-model problem.

### P0.4 Reconciler

Give Flyd deterministic operational truth.

### P0.5 Restart-safe recovery

Make looking away safe.

### P0.6 Present Model v2

Make current understanding immediate.

### P0.7 First-class decisions

Prevent attention loss.

---

## 28. P1

Then:

```text
Mac DELEGATED integration
Scout / Ship intent semantics
multiple worker harnesses
semantic completion checks
CI observation
project knowledge promotion
```

---

## 29. P2

Then:

```text
Stow
storage migration
PROJECT.md retirement
automatic AGENTS curation
broader delegated personal tasks
```

---

## 30. Core Acceptance Scenario

George is working across Bloom, Flyd and Obj0.

He asks Flyd:

> What's happening?

Flyd immediately knows:

```text
Bloom
Active ship task.
Codex worker healthy.
4 files changed.
No decision required.

Flyd
Repository changed this morning.
No delegated task active.

Obj0
Last meaningful activity yesterday.
One unresolved product decision remains.
```

No cross-repository cold scan is needed.

George says:

> Keep going on Bloom.

Flyd sees the existing healthy task and does not start another worker.

Flyd Core restarts.

The worker keeps running.

Flyd reattaches.

The worker claims completion.

Flyd independently verifies the patch and tests.

Verification passes.

The result is integrated.

Repository observation confirms the landing.

The operational task closes.

A meaningful verified outcome enters personal intelligence.

A durable new repository convention is proposed for `AGENTS.md`.

Flyd tells George once:

> Bloom's pull issue is fixed and verified. The scheduler freshness logic was the cause. The changes are landed; nothing needs your attention.

That is the intended system.

---

## 31. Architectural Test

Every new Flyd feature should be answerable with five questions:

1. **Who owns this truth?**
2. **Who observes its real-world counterpart?**
3. **How is disagreement reconciled?**
4. **Does it need to survive restart?**
5. **Does the user actually need to hear about it?**

If two systems answer question 1, the architecture is wrong.

If nobody answers question 3, Flyd cannot be trusted.

If the answer to question 5 is no, Flyd should stay quiet.

---

## 32. Final Product Principle

The desired quality is not "multi-agent."

It is:

> **Flyd understands what is happening, keeps work moving, notices when reality disagrees with its expectations, and asks for attention only when human judgment is genuinely required.**

FirstMate demonstrates that this operating discipline is possible.

Flyd can go further because that discipline can sit underneath a broader personal intelligence instead of being the product itself.
