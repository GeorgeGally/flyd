# Flyd Chief of Staff — Autonomous Team Orchestration Plan v5

Status: Superseded by 2026-10-30-chief-of-staff-orchestration-v6.md; no implementation claimed.
Date: 2026-10-30
Supersedes: docs/plans/2026-10-30-chief-of-staff-orchestration-v4.md
References: v3 conversation plan; v4 committed plan; subsequent Flyd architecture review; OpenMausBot job-scoped delegation lessons.

## Goal

Give Flyd the ability to hand off responsibility for complex work to a Chief of Staff, remain fully available as a personal assistant, and receive completed, verified work from autonomous specialist teams without requiring the user to supervise them.

This is not primarily an agent-count feature. It closes the gap between delegation and accountable completion.

## Expected product outcomes

1. **Flyd stays free:** background work never occupies the conversational execution slot.
2. **Chief of Staff owns outcomes:** objectives have durable accountability, success criteria, authority and budgets.
3. **Teams continue automatically:** meaningful completions and blockers trigger parent continuation without user prompts.
4. **Natural steering:** corrections propagate through affected dependencies without discarding compatible work.
5. **Recovery and efficiency:** interruptions, duplicates, model limits and uncertain external side effects are handled without losing acknowledged work or uncontrolled retries.
6. **One coherent experience:** Flyd presents decisions and verified deliverables through semantic interfaces, not agent chats.

### Illustrative acceptance scenario

User asks Flyd to explore three interface directions, choose or request selection as authorized, implement the strongest, visually review it and fix discrepancies. Flyd immediately remains available. User changes the aesthetic midway. Chief of Staff steers affected design/engineering work, preserves compatible artifacts, survives restart, and Flyd eventually presents the verified result without a follow-up prompt.

## Architectural boundaries

- **Flyd:** intent, conversation, memory, personal judgment, user interaction and semantic presentation.
- **Chief of Staff:** event-driven executive accountable for objective planning, delegation, priority, cross-team judgment, verification and synthesis. Not a permanent model session.
- **Coordination layer:** deterministic durable objectives, assignments, dependency graph, events, revision control, continuation claims, idempotency, leases and recovery. Extend existing mechanisms; do not build a second operating system.
- **Team leads:** specialist autonomy, internal iterations and quality control within bounded authority.
- **Workers:** execute individual assignments and produce evidence.

FirstMate is an Engineering executor, not the orchestrator. Design Team is the first-class proving ground.

## Repo architecture reconciliation

Inspect the actual Flyd conversation → responder → team dispatch → completion → continuation → delivery path. Candidate reuse:

- `cli/src/runtime/session-kernel.ts`: persisted session events, checkpoints and agent-result semantics.
- `cli/src/runtime/run-store.ts`: PostgreSQL run lifecycle and revision guards.
- `cli/src/intelligence/event-store.ts`: SQLite WAL canonical personal event spine, idempotency, correlation/causation, authority and budget metadata.
- `cli/src/conversation-view/flyd-desk.ts` and `flyd-source.ts`: user-facing exchange history, polling snapshots and delivery path.
- `cli/src/command/types.ts`: domain request parent linkage, correction and lifecycle.
- `cli/src/command/design-mate.ts`, `design.ts`: existing creative team, version generation, critique, review semantics.
- `cli/src/command/firstmate.ts`: engineering transport.
- `cli/src/command/scheduler.ts`: domain sync and reconciliation.
- `cli/src/runtime/agenda-tick.ts`: background scheduling and model backoff.
- `cli/src/commands/view.ts`: currently FirstMate-specific decision resolution; generalize for objective-owned decisions.
- `cli/src/runtime/capability-resolver.ts`: conversational specialist routing, not a durable execution capability registry.

**Do not preselect PostgreSQL.** Phase 00 must choose one authoritative coordination lifecycle after evaluating local Mac runtime, server execution, offline use, transactional boundaries, SQLite event spine and PostgreSQL runs. Existing JSON/file artifacts require stable references and reconciliation; no cross-store atomicity assumption. Document systems to extend versus retire.

## OpenMausBot-inspired semantics to implement, not copy wholesale

- Job-scoped parent/child delegation and dependency trees.
- Worker turn settled vs assignment completed vs objective verified and delivered.
- Automatic parent resumption when *required* dependencies settle; detached work does not block completion.
- Versioned job snapshots and wait-for-change subscriptions.
- Idempotent dispatch and completion handling.
- Tree cancellation with authority-aware descendant handling.
- Exportable objective outcome with evidence and artifact manifest.

Do not import OpenMausBot's multi-bot/channel UX or entire runtime. Validate semantics against Flyd's own end-to-end tests.

## Minimal coordination contract

- **Objective:** ID, conversation, brief, success criteria, authority, constraints, budget, revision, delivery destination, status.
- **Assignment:** ID, objective/parent IDs, owner, capability, dependencies (blocking/nonblocking), criteria, revision, status.
- **Execution:** assignment ID, adapter, external run ID, idempotency key, checkpoint, lease/fence, evidence and artifact refs.
- **Event:** ID, objective/assignment, type, revision, payload, durable receipt and processing state.

Distinct durable acknowledgements for worker completion, parent continuation and user-facing delivery. Track requested, acknowledged and produced steering revisions. Team adapter contract: capabilities; dispatch, steer, cancel, reconcile; durable completion reporting. Delegation cannot expand inherited authority.

## Phases — goals, implementation, expected outcomes and exit gates

### Phase 00 — Reconcile existing architecture

**Goal:** Establish one accurate execution and persistence architecture before building.

**Work:** Trace real conversation-to-delivery code; inventory SQLite, PostgreSQL, domain JSON and Design Mate artifacts; evaluate Mac/server/offline ownership; map approvals, model backoff, retries and notifications; select coordination authority and record architectural decisions; build integration test harness.

**Expected:** No competing source of truth, explicit ownership and clear extension points.

**Exit:** Sequence diagram, justified storage ADR, reuse/retire map and runnable Flyd→Design test harness. Stop if completion ownership cannot be explained.

### Phase 01 — Prove automatic parent continuation

**Goal:** One delegated Design Team assignment finishing automatically advances its parent.

**Work:** Minimal objective/child; existing Design Mate dispatch; durable idempotent completion receipt; parent wake claim; deterministic next action; restart and duplicate-completion tests.

**Expected:** No user prompt or ephemeral callback needed for progress.

**Exit:** Integration test: Flyd delegates → Design Team completes → event persisted → parent wakes → next action scheduled, including crash recovery.

### Phase 02 — Durable objective ownership

**Goal:** Chief of Staff owns objectives independently of conversational turns.

**Work:** Minimal objective/assignment/execution/event model in chosen store; idempotent handoff; event-driven executive decisions; persisted dispatch intent; independent completion/continuation/delivery acknowledgements.

**Expected:** Flyd remains responsive and objectives survive closed conversations and restarts.

**Exit:** Accepted objective continues after restart while Flyd serves unrelated conversation.

### Phase 03 — Autonomous Design Team

**Goal:** Preserve existing creative intelligence while adding durable resumability.

**Work:** Checkpoints at direction, concepts, build/render, screenshot, critique, acceptance; revision-tagged artifacts; independent parallel concepts; local critique/rework; explicit autonomous-selection versus user-selection policy; reconcile `labAwaitingReview()`.

**Expected:** Real multi-direction design projects finish with verified screenshots/artifacts without unnecessary regeneration.

**Exit:** Three-direction project survives restart and returns reviewed results through Chief of Staff.

### Phase 04 — Multi-agent dependency orchestration

**Goal:** Support parallel and nested work with correct job completion semantics.

**Work:** Dependency graph, bounded child delegation, required/nonblocking edges, versioned snapshots, wait-for-change, cancellation and exportOutcome; coalesced parent wakes; idempotent event processing.

**Expected:** Parent resumes when required children settle; detached work does not block objectives.

**Exit:** Tests cover parallel children, grandchildren, partial failures, duplicate events, exactly one logical continuation.

### Phase 05 — Mid-flight steering

**Goal:** Conversational corrections selectively redirect active work.

**Work:** Resolve objective; immutable revision; downstream impact analysis; adapter steering receipts; requested/acknowledged/produced revisions; stale-result compatibility checks; selective cancellation/rework.

**Expected:** Updated requirements adopted without restarting unaffected work.

**Exit:** Concurrent test demonstrates affected-worker acknowledgement, unaffected progress and stale-output protection.

### Phase 06 — Engineering and cross-team execution

**Goal:** Deliver integrated design-and-build objectives.

**Work:** FirstMate as team-neutral Engineering adapter; objective-based decision routing in `commands/view.ts`; structured design artifacts, criteria and revision handoff; Design→Engineering→Design visual review→Engineering rework→Chief of Staff verification.

**Expected:** No manual transfer of work or context between teams.

**Exit:** Working cross-team deliverable with verified criteria and automatic review/rework.

### Phase 07 — Recovery, authority and efficiency

**Goal:** Dependable, bounded autonomy without unnecessary bureaucracy.

**Work:** Crash and replay recovery at dispatch, worker, completion, continuation and delivery boundaries; lease fencing; external-effect reconciliation; model-backoff integration; authority inheritance, approval for consequential actions, budgets and diminishing-return limits.

**Expected:** Acknowledged work is recoverable; deterministic coordination continues when models are unavailable; no blind duplicate consequential actions.

**Exit:** Fault-injection and permission/budget tests pass.

### Phase 08 — Flyd semantic experience

**Goal:** Results and decisions arrive naturally in the existing conversation.

**Work:** Durable objective delivery through `FlydDesk`/`FlydConversationSource`, deduplicated delivery acknowledgement, semantic surfaces for design comparisons, previews, decisions and final artifacts; backstage details hidden by default.

**Expected:** Idle conversations receive finished outcomes without a user prompt.

**Exit:** Completion appears exactly once after restart, with usable artifacts and natural follow-up.

### Phase 09 — Production validation and rollout

**Goal:** Prove real-world end-to-end behavior and migrate safely.

**Work:** Real adapter tests, concurrent objectives, interruptions, steering, permissions, cost/latency metrics, feature-flagged migration and cleanup of redundant paths.

**Expected:** Chief of Staff becomes reliable execution owner without breaking existing Flyd workflows.

**Exit:** Full design-and-build scenario repeatedly passes with interruption, correction and autonomous delivery.

## Milestones

M1 (P01): automatic parent continuation.
M2 (P02): durable independent objective ownership.
M3 (P03): autonomous resumable Design Team.
M4 (P04): nested/parallel dependency coordination.
M5 (P05): selective mid-flight steering.
M6 (P06): cross-team design/build/review.
M7 (P07–09): robust recovery, semantic delivery and production validation.

## Validation targets (proposed, not measured)

- Zero lost acknowledged objectives in fault-injection tests.
- Zero duplicate consequential external actions in replay tests.
- All accepted terminal events eventually processed in recovery tests.
- Normal local event-to-continuation scheduling under five seconds excluding model execution.
- No background-induced conversational blocking.
- Bounded costs, retries and autonomous iteration.
- No mandatory user intervention for routine team transitions.

## Non-goals

No permanent Chief of Staff model, agent-chat network, second agent OS, team-specific orchestrators, central micromanagement of design iterations, mandatory approval for reversible actions or conventional project-management UI.

## Definition of done

Flyd accepts a substantial design-and-build objective, delegates durable accountability to Chief of Staff, stays conversationally available, accepts a mid-flight correction, survives a restart, coordinates Design Team and Engineering through review/rework, and independently presents a verified result or genuine decision request. One assistant, multiple autonomous teams, one accountable outcome.
