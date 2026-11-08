# Flyd Autonomous Orchestration — Implementation Plan v7

Status: Proposed; not implemented.  
Date: 2026-11-08  
Repository: GeorgeGally/flyd  
Product authority: `docs/product/flyd-personal-intelligence-prd.md` wins on conflict.  
Predecessor: `docs/plans/2026-10-30-flyd-chief-of-staff-split-plan.md`. This plan **extends and revises its orchestration roadmap**, retaining its one-voice boundary, delivery-first requirement, authority and privacy rules. The earlier Chief-of-Staff v6 is superseded by the split plan, not reinstated here.

## Goal and expected user experience

Flyd should accept a complex objective once, coordinate specialists across domains and over time, recover from interruption, adapt to corrections, verify the result and deliver one coherent outcome. The user talks only to Flyd. The Chief of Staff (CoS) owns delegated outcomes; First Mate, Design Mate, Librarian and existing tools perform execution.

Example: “Research the feature, have the design team explore options, implement the best direction, independently review it, fix failures and tell me when ready.” The system should run research and design concurrently, synthesize their evidence, launch implementation when dependencies are satisfied, reject poor results, rework within budget and deliver an artefact with evidence. It must not require repeated “continue” prompts.

### Non-goals

- Do not replace First Mate or duplicate its internal orchestration.
- Do not build a new general agent framework, context graph database, dashboard or persistent model session.
- Do not invent a second authoritative task state store when existing AgentTask/DomainRun machinery can be extended.
- Do not run a large multi-agent workflow for simple personal tasks.
- Do not let agents silently perform irreversible actions without scoped authorization.

## Architecture and ownership

```text
Flyd (conversation, voice, memory, intent, personal tools, delivery)
   | hand_off / tell_work / work_status
Chief of Staff (objective ownership, graph planning, coordination,
                review, recovery, escalation, completion)
   | task adapters, idempotent dispatch, events and receipts
   +-- First Mate (coding and execution, its own internal orchestration)
   +-- Design Mate (creative/design)
   +-- Librarian (research/evidence)
   +-- existing domain runs / background jobs / crew
   |
Flyd delivery (semantic workspace, decisions, artefacts, notifications)
```

The CoS owns **cross-domain dependencies and the objective lifecycle**. Each executor owns its **internal execution attempts**. Only one authority may transition a given record. CoS never assumes that an external side effect occurred exactly once merely because a dispatch was retried.

Retain the split plan's `hand_off(words, notes, urgency?)`, `tell_work(message, objectiveId?, kind?)`, `work_status(objectiveId?)` and CoS→Flyd `CosReport` boundary. Maintain Flyd's direct quick-personal-tool permissions and no direct code modifications.

## Phase 0 — Audit current code and prove the gaps

**Work**
1. Inspect current main, not only the October snapshots: `cli/src/command/`, `cli/src/runtime/`, `cli/src/intelligence/`, `cli/src/conversation-view/`, First Mate integration, Design Mate, Librarian, scheduler and event store.
2. Map existing `Objective`, `DomainRun`, `AgentTask`, background-job, crew, event and routine records; identify which is authoritative at each layer.
3. Trace delegate → child finishes → parent wakes → synthesis → delivery; repeat with restart, duplicate completion and mid-flight correction.
4. Build a code-referenced reuse/extend/build matrix. Check the prior plan's suspected stale-write race and the actual production wiring of quiet hours/interruption budgets.
5. Inspect First Mate's *actual* supported scheduling, parallelism, delegation, resumability, cancellation and idempotency before proposing replacement primitives.

**Exit:** documented capability matrix, failing integration tests for real gaps, and signed-off ownership contract. No new infrastructure merely because a feature has a new name.

## Phase 1 — Delivery contract plus durable orchestration foundation

**Work**
1. Preserve the split plan's **delivery-first** principle: ship a minimal objective-level report path immediately, so users get useful results while engine work proceeds. Reports must be deduplicated and linked to objective and evidence.
2. Reuse the existing SQLite event spine and durable records; extend them with objective/task graph references only as needed. Do not create a competing task database.
3. Implement durable task nodes with: stable ID, objective ID, owner adapter, dependencies, status, plan revision, attempt IDs, input refs, output refs, permission grant, cost/attempt budget and completion evidence.
4. Implement dependency graph validation (unknown nodes, cycles), bounded concurrency, atomic state transitions, idempotent dispatch and reconciliation after restart.
5. Persist dispatch intent before execution, reconcile uncertain attempts via executor receipts/status, and distinguish “unknown outcome” from “safe to retry.”
6. Ensure cancellation and pause propagate to queued work; active external work is best-effort cancelled and reconciled.

**Exit:** three-node workflow (two parallel nodes → one dependent node) survives process death at dispatch, completion and dependency release; no duplicate *user-visible* delivery; external side effects remain protected by receipts and authority checks.

## Phase 2 — Adaptive planning and specialist coordination

**Work**
1. Convert objective + explicit success criteria into the **smallest useful** directed acyclic task graph; support direct single-executor plans.
2. Route tasks to existing First Mate, Design Mate, Librarian or other supported adapters based on capabilities, cost, permissions and availability.
3. Define compact typed handoff briefs: goal, done-when, constraints, relevant memory/evidence, expected output and review criteria. Avoid leaking unrelated private context.
4. Allow parallel branches, joins, shared evidence references and plan revisions. The CoS synthesizes branch outputs before downstream dispatch.
5. Persist why an agent was chosen and enough provenance to explain or rerun decisions.

**Exit:** research and design execute concurrently, are synthesized into a grounded implementation brief, and the correct execution system receives it. A simple objective still takes the simple path.

## Phase 3 — Automatic wake, continuation and mid-flight steering

**Work**
1. Persist child-completion events, wake the objective owner and release eligible downstream nodes without a user prompt.
2. Make event handling idempotent and restart-safe; use periodic reconciliation as fallback to missed notifications.
3. Support `correction`, `priority_change`, `question`, `cancel` and `pause/resume` through `tell_work`.
4. Apply steering to graph revisions; update queued briefs, interrupt or supersede active attempts when supported, and quarantine late results from superseded revisions.
5. Track blockers and escalation; automatically continue after an approval or missing input is resolved.

**Exit:** change direction while two tasks are active; obsolete results cannot overwrite new intent; the graph finishes without “continue,” including after restart.

## Phase 4 — Independent review, critique and bounded rework

**Work**
1. Evaluate output against the **objective's acceptance criteria**, not the executor's self-reported success.
2. Prefer deterministic checks (tests, types, lint, file diff, provenance) before model judgment; use an independent reviewer when judgment is needed.
3. Record pass/fail evidence and targeted repair instructions; rework only failed branches.
4. Cap attempts, token/spend budgets and wall-clock time; escalate when limits or irreversible decisions are reached.
5. Ensure reviewer independence where possible; a worker's own assertion cannot be the sole completion proof.

**Exit:** intentionally defective output is rejected, repaired and independently verified; an unrepairable case terminates with a clear blocker rather than looping forever.

## Phase 5 — Persistent responsibilities and event-driven autonomy

**Work**
1. Add a thin responsibility/monitoring layer **only if** existing objectives and schedules cannot represent ongoing ownership. Prefer an extension/reference to objective records over a new database.
2. Connect event adapters for available integrations (e.g. Gmail, GitHub, webhooks) and schedules to the same CoS intake path.
3. Gate every trigger: relevance → existing responsibility/objective → deduplication → authority → budget → execution or absorb.
4. Batch low-value signals; define review cadence, stop conditions and escalation thresholds.
5. Avoid creating a new agent for every email or webhook.

**Exit:** a relevant event advances an existing responsibility and produces a material update; duplicate/noisy events do not multiply tasks or notifications.

## Phase 6 — Reusable skills and learning by demonstration

**Work**
1. Extend existing `RoutineArtefacts` rather than introducing an unrelated skill runtime.
2. Capture approved tool-action traces and, where supported, browser demonstrations. Redact secrets, sensitive fields and irrelevant personal data.
3. Parameterize inputs, record required permissions and verification steps, and provide a dry-run/review before activation.
4. Version skill revisions and test them against a small golden set before promotion; capture corrections as candidate changes rather than silently rewriting procedures.
5. Keep workflow execution under existing CoS/executor ownership.

**Exit:** teach once, approve, replay safely with changed inputs; a corrected skill passes regression tests and can be rolled back.

## Phase 7 — Needs You, cross-device handoff and generative delivery

**Work**
1. Create one logical queue for approvals, decisions, credentials, blockers and irreversible-action requests, linked to objective and exact suspended node.
2. Replying to an item resumes the original workflow through durable state, not a new chat-only task.
3. Support secure, scoped, short-lived authentication or screen handoff without placing secrets in conversation, logs or learned skills.
4. Let Flyd select presentation based on the semantic outcome: decision, comparison, picture, steps, document, landed result. Avoid a fixed dashboard for every task.
5. Apply quiet hours, interruption budgets, deduplication and explicit delivery receipts.

**Exit:** approve a draft on mobile; the suspended workflow resumes, completes and yields one useful artefact, with no repeated prompts or noisy intermediate agent chatter.

## Critical data and event contracts

**Objective**: immutable user words, contextual notes, goal, acceptance criteria, owner, authority, budget, lifecycle status, revision, linked task IDs, report/delivery references.

**Task node**: ID, objective ID, graph revision, dependencies, executor adapter, typed brief, status, active attempt ID, input/output refs, evidence refs, permission scope, retry policy.

**Execution attempt**: executor-native ID, dispatch idempotency key, status, heartbeat/checkpoint, receipts, failure classification, cost and side-effect uncertainty.

**Events**: event ID, objective/task/attempt IDs, correlation/causation IDs, timestamp, plan revision, payload and authority provenance. Event consumers must be idempotent.

**CoS report**: objective ID, kind (`done|decision|blocked|credential|irreversible`), semantic shape (`words|picture|decision|comparison|diagnosis|steps|document|landed`), summary, evidence/artefact refs, urgency, delivery key.

**Invariant:** each objective has one authoritative CoS owner; each task node has one authoritative state owner; every downstream task runs only when its dependencies and permissions are satisfied. A retry is not permission to repeat an uncertain external side effect.

## Vertical-slice acceptance scenario (ship this before broad rollout)

1. Flyd receives a feature objective with testable success criteria.
2. CoS dispatches Librarian and Design Mate in parallel.
3. Kill/restart the parent after dispatch; recover the same graph without duplicate attempts.
4. Collect outputs, synthesize a brief and hand off to First Mate.
5. While implementation runs, user changes a requirement; propagate revision and prevent stale delivery.
6. First Mate returns a deliberately flawed result; independent review fails it.
7. CoS issues targeted rework, verifies fix and delivers one coherent artefact through Flyd.
8. Repeat with duplicate completion events, lost wake notifications, cancellation, budget exhaustion and approval-required side effects.

**Pass condition:** objective reaches a justified terminal state with evidence, no human “continue,” no duplicate user-visible report and no unauthorized external action.

## Milestones and sequencing

- **M0:** Code-referenced gap audit; reuse/extend/build decisions.
- **M1:** Delivery-first contract + durable graph + restart-safe reconciliation.
- **M2:** Real parallel multi-domain handoffs and synthesis.
- **M3:** Automatic wake, continuation, steering and cancellation.
- **M4:** Independent quality gates and bounded rework.
- **M5:** Event-triggered persistent ownership.
- **M6:** Demonstrated, versioned skills.
- **M7:** Cross-device Needs You and polished semantic delivery.

Phases are capability groupings, **not** permission to postpone user-facing delivery until Phase 7. M1 must already deliver a coherent objective report.

## Risks and counterarguments

**Strongest objection:** Flyd already has multiple execution and delegation paths; a new engine could duplicate them and worsen reliability. **Mitigation:** Phase 0 is mandatory; prefer a thin CoS graph/coordination layer that invokes existing executor primitives, and delete or consolidate redundant paths only after proven migration.

**Stale writes and split-brain ownership:** use revision checks, atomic mutations and one authoritative transition path. **Lost wakeups:** persist completion before notification and reconcile periodically. **Runaway agent loops:** enforce cost, depth, attempt and concurrency budgets. **Noisy autonomy:** relevance filters and interruption budgets. **Unsafe actions:** scoped grants, receipts and approval gates. **Poor quality:** independent evidence-backed review.

## First implementation backlog

1. Audit current task/DomainRun/First Mate capabilities and the split-plan implementation status.
2. Write failing integration tests for parallel join, restart, late completion, steering, duplicate delivery and external side-effect uncertainty.
3. Implement minimal objective report/delivery bridge.
4. Add the smallest missing graph/reconciliation primitives using existing storage.
5. Build the vertical slice with real adapters, then expand only where tests prove a gap.

## Completion definition

Flyd becomes the sole conversational interface; the Chief of Staff owns cross-domain outcomes; First Mate and other specialists retain their execution strengths. Complex work advances autonomously across failures and corrections, is independently checked, and reaches the user as a clear, context-appropriate result. No implementation is claimed by this document.
