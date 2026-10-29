# Flyd Chief of Staff — Agent Orchestration Implementation Plan v4

Status: Approved architecture proposal; not yet implemented.
Date: 2026-10-30

## Goal

Build a system in which Flyd delegates complex objectives to a Chief of Staff, remains fully available as a personal assistant, and receives verified results from autonomously coordinated specialist teams. Work must continue without prompting, survive restarts, accept mid-flight corrections, and return coherent outcomes through Flyd.

## Expected outcomes

1. **Flyd stays responsive:** background objectives do not block conversations or unrelated requests.
2. **Autonomous teamwork:** Chief of Staff plans and owns outcomes; Design Team, Engineering/FirstMate and future teams own execution.
3. **Automatic continuation:** durable completion, failure and blocker events wake the appropriate parent without user prompting.
4. **Natural steering:** user corrections propagate selectively through dependencies, preserving compatible progress.
5. **Reliable recovery:** restarts, duplicate events and unknown external side effects do not lose acknowledged objectives or blindly repeat consequential actions.
6. **One Flyd experience:** meaningful progress, decisions and deliverables appear in semantic interfaces rather than exposing agent machinery.

## Architectural boundaries

- **Flyd:** conversation, memory, interpretation of user intent, personal judgment and presentation. Hands off an objective immediately after durable acceptance.
- **Chief of Staff:** accountable executive for planning, delegation, prioritization, cross-team decisions, verification and synthesis. Event-driven, not a permanently running LLM.
- **Durable workflow engine:** generic assignments, events, dependency evaluation, revision control, wake claims, leases, idempotency, outbox/inbox and recovery. No creative judgment.
- **Team leads:** autonomous specialist decisions and internal iterations within delegated authority and budgets.
- **Workers:** individual assignments and evidence.

Do not confuse existing `cli/src/council/chief-of-staff.ts` (outgoing communication standards) or the background Council with the new execution coordinator.

## Existing systems to reuse

- `cli/src/runtime/run-store.ts`: PostgreSQL durable run lifecycle and revision guards.
- `cli/src/runtime/session-kernel.ts`: checkpoint and waiting-state concepts; do not park the main conversation.
- `cli/src/conversation-view/flyd-desk.ts`: user-facing conversation and objective handoff.
- `cli/src/command/types.ts`: domain request, `parentRequestId`, corrections and lifecycle semantics.
- `cli/src/command/design-mate.ts`: Creative Director, Design Mate, designers, versions, screenshot critique and iterative improvement.
- `cli/src/command/firstmate.ts`: engineering backend, never the orchestrator.
- `cli/src/command/scheduler.ts`: domain synchronization; keep reconciliation, add durable completion-to-parent wake.

Current domain runs and Design Mate state are stored separately in JSON/filesystem; coordination must not assume cross-store atomic transactions. Existing `source === "view"` notification suppression is not a durable parent-continuation acknowledgement.

## Core model

- **Objective:** id, originating conversation, intended outcome, success criteria, constraints, authority grant, cost/time budget, revision, status and delivery destination.
- **Assignment:** id, objective id, parent id, capability, owner, dependencies, criteria, requested/acknowledged/produced revision, lifecycle.
- **Execution:** assignment id, backend, external run id, checkpoint, lease/fencing state, idempotency key, evidence/artifact refs.
- **Event:** unique id, objective/assignment, type, revision, payload, receipt and processing state.

Use one authoritative transactional PostgreSQL coordination store. Store dispatch intents and events durably; external worker files and artifacts remain separate with stable references and reconciliation. Reuse existing run-store primitives; do not introduce a competing full runtime.

## Execution semantics

1. Flyd interprets intent and persists an objective with an idempotent handoff.
2. Chief of Staff plans bounded assignments and delegates by capability.
3. The workflow engine records dispatch intents before invoking team adapters.
4. Team leads execute and iterate independently; significant results and blockers publish durable events.
5. Inbox ingestion deduplicates events, evaluates dependencies and claims the appropriate parent continuation.
6. Deterministic transitions do not invoke a model; Chief of Staff invokes one only for planning, judgment, replanning or synthesis.
7. Chief of Staff can delegate, request targeted rework, wait, escalate a genuine user decision or complete.
8. Worker completion, executive continuation and user-facing delivery each have independent durable acknowledgement.
9. Reconciliation repairs missed wakes, expired leases and unknown execution outcomes without blindly replaying external side effects.

## Team contract

Each team adapter exposes capabilities and `dispatch(assignment)`, `steer(executionId, revision)`, `cancel(executionId)` and `reconcile(executionId)`; completions arrive as durable events. Team leads can create bounded child assignments and handle local iteration without Chief of Staff micromanagement. Delegation cannot expand inherited permissions.

## Steering

Flyd resolves a conversational correction to the right objective. Chief of Staff increments the objective revision, evaluates affected assignments and their downstream dependencies, and chooses continue, amend, targeted rework, safe stop/cancel or reevaluation of completed output. Track requested, acknowledged and produced revisions separately. Old-revision results require compatibility verification before acceptance. Preserve unaffected work and reusable artifacts.

## Design Team first

Preserve existing Creative Director / Design Mate / designer workflow. Add checkpoints for concept direction, build, screenshot, critique and acceptance; make parallel directions independently trackable and resumable. Creative Director owns design quality and local critique/rework. Chief of Staff owns overall success and cross-team handoff. Restarting must not regenerate completed work unnecessarily.

First demonstration: ask Flyd for three distinct interface directions, steer the brief while running, restart the runtime, allow automatic creative review and targeted rework, and receive verified deliverables without prompting.

## Engineering and cross-team proof

Integrate FirstMate as an equal executor after Design Team. Prove Design → Engineering → Design visual review → Engineering rework → Chief of Staff verification → Flyd presentation. Do not hard-code FirstMate into the generic coordinator.

## Authority, budgets and completion

Honor existing permissions for purchases, external communication, publishing, deletion and other consequential actions. Reversible work proceeds autonomously within authority. Bound recursion, concurrency, cost, retries and iteration. Apply diminishing-return criteria. If a limit is reached, report best available work and shortcomings instead of looping indefinitely. External side effects with unknown outcomes must be reconciled, not blindly retried.

## Implementation releases and exit gates

### R1 — Contracts and failing end-to-end tests
Trace actual Flyd conversation → Design Mate → completion path. Define ownership, schema, authority and adapter contracts. Add tests reproducing missing automatic continuation. **Exit:** failing test captures current user-visible gap.

### R2 — Durable workflow engine
Implement authoritative objective/assignment/execution/event persistence, transactional dispatch outbox, completion inbox, idempotent wake claims, dependencies, leases and recovery. **Exit:** assignments survive restart and duplicate delivery yields one logical continuation.

### R3 — Chief of Staff executive and Flyd integration
Implement planning, delegation, event-driven executive decisions, verification, synthesis and independent durable result delivery. Keep conversation responsive. **Exit:** objective finishes and reaches Flyd without a follow-up prompt.

### R4 — Design Team integration
Implement executor adapter, resumable stage checkpoints, parallel concepts, review dependencies and automatic targeted rework. **Exit:** multi-direction design objective completes autonomously through Chief of Staff.

### R5 — Mid-flight steering
Implement revision history, impact analysis, acknowledgement, stale-result checks, safe cancellation and preservation of compatible work. **Exit:** changed brief is adopted without restarting unaffected assignments.

### R6 — Engineering and cross-team work
Add FirstMate adapter and artifact/criteria handoff. **Exit:** Design → Engineering → Design review completes with one verified result.

### R7 — Reliability, semantic UI and rollout
Fault injection, bounded budgets, permission tests, outcome-first semantic UI, feature-flag rollout and removal of redundant paths. **Exit:** all user-facing acceptance tests pass in real Flyd runtime.

## Acceptance tests

- Flyd remains conversationally available while multiple objectives run.
- Nested parallel assignments retain correct parent ownership and dependencies.
- Design review automatically starts after required child results.
- A mid-flight change reaches affected work and preserves unaffected work.
- Crash after dispatch does not create duplicate logical work.
- Crash after child completion but before parent wake still leads to continuation.
- Triple delivery of the same completion yields one logical continuation.
- Unknown external side effects are reconciled before retry.
- Cross-team artifact handoff and design review trigger targeted rework.
- Cost/iteration limits stop runaway loops with useful best-available output.
- Finished work appears in Flyd without another user prompt.

Proposed validation targets (not current performance claims): zero lost acknowledged objectives and duplicate consequential side effects in fault-injection tests; all accepted terminal events eventually processed; normal local event-to-continuation scheduling under five seconds excluding model time; no background-induced conversation blocking.

## Explicit non-goals

No permanently running Chief of Staff model, mandatory agent chat network, separate orchestrator per team, central micromanagement of every creative iteration, unnecessary approval bureaucracy or conventional project-management dashboard.

## Definition of done

Flyd accepts a substantial design-and-build objective, delegates it to Chief of Staff, remains available, handles a natural mid-flight correction, and later presents verified work completed through Design Team and Engineering—without chasing agents or requiring another user prompt. The workflow survives interruptions and operates within delegated authority.
