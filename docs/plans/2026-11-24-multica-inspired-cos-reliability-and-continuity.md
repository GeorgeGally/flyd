# Flyd × Multica — CoS Reliability and Cross-Domain Continuity Plan

**Date:** 2026-11-24  
**Status:** Proposed implementation plan; no code implementation or on-Mac validation claimed.  
**Authority:** `docs/product/flyd-personal-intelligence-prd.md`, `AGENTS.md`, `docs/product/flyd-command-architecture-prd.md`.  
**Source:** https://github.com/multica-ai/multica (patterns evaluated, not code imported).  
**Baseline:** Flyd default branch inspected via GitHub on 2026-11-24; representative files and contracts listed below. Recheck changed files and current head immediately before implementation.

## 0. Desired result

George speaks to Flyd once. Flyd hands substantial work to its Chief of Staff (CoS), which coordinates existing domain teams; work survives process and worker failures; corrections reach the right *current* execution; dependent teams resume automatically when verified prerequisites land; and Flyd returns a concise, evidence-grounded artifact or decision, not a project-management update.

**This is not a Multica integration.** Borrow execution hygiene, runtime identity, steering receipts, evidence-led reviews and reusable playbooks. Do not replace FirstMate, create a second CoS, introduce a Kanban homepage, resurrect Rails, or let an agent's own claims become proof of success.

**Success scenario:** George says “Research whether this would improve Flyd, prototype the best approach, and implement it.” CoS retains one objective with three dependent outcomes (knowledge → design → coding), records verified evidence at each transition, handles an in-flight correction without throwing away unaffected work, recovers after Core restart, and produces one Flyd-facing result with actual artifact, verification and caveats. The user is interrupted only for an actual policy/authority question.

## 1. Evidence and reuse audit

| Concern | Existing authority / concrete code | Assessment; action |
|---|---|---|
| Objective ownership and durable lifecycle | `cli/src/command/cos/{objectives,types,tick,plan}.ts`; file-locked `mutateObjective`, statuses, claims, reports | **Reuse.** One CoS objective remains authority. No new WorkItem database or second task scheduler. |
| Cross-domain graph and dispatch | `cos/plan.ts`: `planProblem`, `releasable`, `downstreamOf`, `planRequestId`, attempt and revision logic | **Exists.** Validate full research→design→coding flow and provider reconciliation rather than reimplement graph algorithms. |
| Retry/unknown side effects | `PlannedRunState.unknown`; bounded reconciliation; FirstMate durable inbox; AgentRun DSL narrowly scoped recovery | **Reuse and protect.** Never auto-retry an unknown effect, silently refresh authority, or make DSL a workflow engine. |
| Targeted corrections | `cos/types.ts`: `pendingCorrections` and `briefRevision`; `command/messages.ts`: `sendRunMessage`; `conversation-responder.ts` | **Partial.** Domain message `deliveredAt` can mean accepted/persisted, not read/applied. Knowledge manager may consume on a later wake; other domains can be unsupported. Add distinct acknowledgment and application evidence with honest states. |
| FirstMate canvas and artifact review | `docs/plans/2026-11-21-rounds-firstmate-work-canvas.md`; `conversation-view/firstmate-inbox.ts` | **Coordinate, don't duplicate.** Reuse its task-generation/versioned artifact provenance and review routing; avoid separate artifact index. Plan status is not proof of installed implementation. |
| Existing learning | `docs/product/flyd-routine-artefacts.md`, `AGENTS.md` Skillify/outcome rules | **Extend through governed learning only.** No second skills store; repeated requests are not proof that a procedure works. |
| One voice, UI and evidence | `conversation-view/semantic.ts`, `runtime/delivery.ts`, `evidence/`, `cos.report` | **Reuse.** CoS produces canonical structured evidence; Flyd chooses a manifestation per answer, not per fixed semantic type. |
| Authorization and initiative | `runtime/tool-policy.ts`, initiative mandate and source-erasure contracts | **Hard boundary.** A completed research run confers no authority to implement; every downstream effect must be covered by the originating user request or a separate appropriate grant. |
| Agent/runtime separation | FirstMate transport and DomainRun; local/remote runtime infrastructure | **Only fill proven gaps.** Treat executor runtime and generation as provenance, not a new agent registry. |
| Monitoring | `command/fleet-monitor.ts`, work-canvas SnapshotGate, CoS tick | **Reuse one observation source.** No second full-snapshot polling loop or always-on provider calls. |

**Audit limitation:** Above is a source-and-contract inspection of selected files on GitHub, not execution of an installed Mac build, complete test suite, or every branch of CoS tick. Every claimed gap gets a failing behavior test first. If a behavior already passes, close that subtask with evidence rather than build parallel machinery.

**Multica references:** README, CLI_AND_DAEMON.md, apps/docs/content/docs/daemon-runtimes.mdx and LICENSE in multica-ai/multica. Runtime discovery, work-centered histories, live steering and skills are patterns to adapt; their implementation and deployment model are not adopted. License is custom with commercial restrictions; *no Multica code/assets vendored* without separate license review.

## 2. Architecture decisions

1. **Authoritative record:** `Objective` and its existing `PlannedRun` graph govern CoS work. `DomainRun`/FirstMate/task runtime remain source of truth about their own attempts. Add narrow references and receipts only; do not duplicate run state in an independent ledger.
2. **Identity:** `objectiveId + runKey + attempt + briefRevision` is the semantic delivery target; provider receipt additionally carries external task identity, worker spawn generation (if available), and artifact revision. Never match by title, time or repository alone.
3. **Events and effects:** Persist requested steering *before* delivery; outcome receipts distinguish queued, transport accepted, worker acknowledged, applied and rejected/superseded. On unknown effect reconcile by exact idempotency key; no blind replay.
4. **Continuation:** CoS wake via existing tick and event lifecycle. A dependency is releasable only after the run's current-revision result is reviewed and satisfies required evidence/acceptance; no new parent scheduler.
5. **Evidence:** A `cos.report` includes typed artifact/evidence references and verification status. The original wording, raw specialist output and provenance remain accessible backstage. A model summary is never the sole record.
6. **Interface:** Flyd chooses its manifestation for the *particular answer*; semantic kind is context, not a fixed layout selector. Keep activity/progress quiet, preserve useful quota/status readouts, make needs-you/actions real.
7. **Security:** User corrections may narrow/revise work; a purported worker or retrieved document may not expand permissions. Execute only with existing policy/consent/mandate checks.
8. **Privacy and erasure:** Preserve source attribution and consent scope; erasure/revocation removes dependent derived work/materialized surfaces; never copy untrusted evidence into personal memory by default.

## 3. Implementation phases

### Phase 0 — Prove the missing behaviors (no architecture work)

**Inspect:** `cos/{tick,plan,intake,objectives,types}.ts`; `command/{messages,store,firstmate,fleet-monitor}.ts`; `runtime/conversation-responder.ts`; `conversation-view/{semantic,server,firstmate-inbox}.ts`; existing tests and the Rounds work-canvas state.

**Deliver:**
- Trace 3 representative end-to-end objective histories: single-team coding, knowledge→design→coding, and correction while a worker is running.
- A trace table with exact producer/consumer, receipt ID, durable path, restart recovery and user-visible state per transition.
- Regression fixtures for unsupported domain delivery, crash after provider accepts but before local receipt, stale worker generation, and source erasure.
- Compare FirstMate's actual inbox/snapshot/ack guarantees with Flyd's assumptions. Distinguish interface behavior that is only planned from code that is running.

**Gate P0:** Each gap has an executable failing test or is marked “already implemented” with a passing test and file reference. Do not continue a feature on assumptions.

### Phase 1 — Steering and acknowledgment integrity (highest priority)

**Existing modules to extend:** `command/messages.ts`, `command/cos/tick.ts`, `command/cos/types.ts`, relevant domain transport/manager adapters. Do not replace `sendRunMessage` or the FirstMate inbox.

**Narrow addition:** A versioned correction receipt keyed to `objectiveId/runKey/attempt/briefRevision/correctionRevision` with:
- immutable original user text, scope, target and recorded provenance;
- delivery states `queued | accepted | acknowledged | applied | rejected | unknown | superseded` (transport acceptance does not imply model comprehension or actual change);
- provider-specific external receipt, timestamp and worker-generation fingerprint where supplied;
- correction outcomes from *worker evidence*, not inferred from messages merely disappearing.

Implement dispatch through existing CoS `pendingCorrections`. Run-specific messages should carry stable revision-specific idempotency keys; existing `messageId` hashes only `run + kind + body`, so identical words on successive artifact revisions must remain distinguishable. Keep backward-compatible DomainRun reads and idempotent migration for old pending messages.

For FirstMate, use its supported targeted inbox/reply mechanism; if worker generation is stale, do **not** steer a replacement—create a clearly attributed follow-up or hold for confirmation. For Librarian and Design Team, implement a manager-wake inbox consumption receipt; absent a supported live interrupt, UI must say “queued for next safe checkpoint,” not “applied.”

**Tests:** duplicate correction submitted twice, same text across revisions, worker restarts mid-correction, unknown provider receipt, cancellation races, stale generation, one correction affecting only downstream runs, correction delivered while completion arrives. A correction must never be silently dropped or reported “applied” without evidence.

**Gate P1:** 100% of test steering messages have a durable and truthful terminal or pending state across restart; no duplicate external effects in replay fixtures.

### Phase 2 — Verified cross-domain continuation

**Extend:** `cos/{plan,tick,types}.ts`, existing team result adapters, current CoS reports. **Do not introduce another DAG engine.**

Add a per-run **acceptance envelope** referencing:
`objectiveId`, `runKey`, `attempt`, `briefRevision`, `domainRunRef`, `resultRefs`, `artifactRevisionRefs`, checks `passed/failed/uncertain`, and reviewer/verification provenance. Store only bounded metadata and stable evidence references on objective; bulky evidence remains in the existing authorized source.

On result settlement:
1. Verify source/attempt/revision and current authoritative worker outcome.
2. Check `doneWhen` against evidence using deterministic checks where possible; judgment can advise, never grant authorization or manufacture refs.
3. Apply existing review/rehandoff policy; only reviewed and accepted current-revision outputs unlock `releasable`.
4. Carry upstream evidence and unresolved caveats to downstream brief *without truncating away originals*.
5. CoS schedules next ready run through its existing dispatcher; parent resumes on event/tick after restart. Avoid polling external systems twice.
6. Keep one authoritative objective report; partial/failure outcomes remain explicit; corrections invalidate only affected dependency closure via `downstreamOf`.

**Tests:** multi-team chain with restart at every boundary, parallel siblings, partial research, failed design, missing source, duplicate completion, outdated briefRevision, downstream artifact correction, cycle rejection, unknown effect and exact-once report delivery.

**Gate P2:** End-to-end knowledge→design→coding synthetic replay completes from one original request without user nudges, retains all evidence links, and produces one CoS report; unverified run never unlocks a dependent effect.

### Phase 3 — Execution identity and recovery adapters

**Reuse:** `command/types.ts`, FirstMate transport, fleet monitor, task runtime where applicable. Do not invent “agent employee” objects.

Define optional narrow `ExecutionIdentity`: `domain`, `transport`, `runtimeId`, `machineId` (opaque), `externalTaskId`, `spawnGeneration`, `attempt`, `capabilityProfile`, `lastObservedAt`. Only attach values actually supplied by a trusted transport. Never infer ownership by CLI presence or process name.

Introduce an **adapter capability matrix** (supports targeted feedback, checkpoint acknowledgment, cancel, resume, artifact manifest, reconciliable idempotency key). Unsupported features remain explicit. Registry is a read model of existing transports, not a scheduler or self-provisioning agent pool.

At restart: reconcile canonical request IDs and external snapshots; validate generation and freshness; differentiate `not_observed`, `unavailable`, `unknown` and `finished`; keep remote Second Mate observations read-only until its routing contract explicitly supports writes.

**Tests:** laptop sleeps, daemon restart, provider outage, duplicate snapshot, old worker reused task ID, runtime missing, snapshot freshness expiration. Zero unsolicited remote execution.

**Gate P3:** A disappeared executor cannot silently cause a duplicate task, and a task's identity cannot silently jump generations.

### Phase 4 — Evidence-led review and adaptive delivery

**Reuse:** `cos.report`, Evidence Engine provenance, verification types, existing semantic workspace/manifestation plan, and Rounds FirstMate work-canvas *if its implementation exists*.

Provide a bounded `WorkEvidenceSummary` read projection derived from canonical references (never a competing store): outcome, verification, artifact/version, changes, unresolved risk, next action and human decision *only if genuinely required*. Synthesize one user-facing Flyd message per objective, but allow lightweight progress if George explicitly asks.

UI: choose between a visual artifact stage, comparison, concrete decision surface, or short text based on content. A report must work without the canvas and must not create a mandatory board. If user can inspect an artifact, deep-link to its verified revision. “Needs you” count and destination derive from the same semantic objects. No fake watching buttons. Quota/usage readouts remain when useful. Screenshots/HTML use the already defined work-canvas isolation requirements; untrusted content never runs with privileged webview authority.

**Tests:** missing artifact, misleading success summary, reviewer rejected, choice without actionable option, repeated notification, source erasure, stale count/destination mismatch, inaccessible deep link, unsafe preview.

**Gate P4:** In representative output evaluations users can distinguish verified complete, partial, blocked and unknown from the primary surface without inspecting internal logs; links resolve to the exact evidence version.

### Phase 5 — Governed procedure learning

**Reuse:** existing Skillify / verified-outcome pipeline, `docs/product/flyd-routine-artefacts.md`, repository policy registry, event store, erasure model.

Capture a **candidate recipe** only from a repeated workflow with independent verified outcomes (not merely repeated requests or accepted submissions): preconditions, scoped inputs, safe steps, evidence expectations, measured outcomes, limitations and provenance. Deduplicate against existing routines/skills. Replay against historical holdouts and adversarial failure cases. Promote only through the existing policy/governance pathway with version, rollback, test set and source-erasure compatibility. Initially suggestion-only, not a new autonomous executor.

**Tests:** one successful task does not promote, multiple same failures do not promote, adverse result retracts confidence, stale recipe blocked, permissions never inherited from prior execution, source erased, rollback after regression.

**Gate P5:** One tested cross-domain procedure is suggested with proven value and can be disabled/reverted without affecting existing work. No autonomous new authority.

## 4. Cross-cutting invariants and failure handling

- **Single ownership:** CoS objective is the parent; DomainRun/FirstMate owns execution; evidence engine owns source verification; the UI is a projection. No duplicate work-record authority.
- **At-most-once effect attempts:** Persist before dispatch, use deterministic IDs, reconcile ambiguous receipts before retry. Never interpret HTTP timeout as failure to execute.
- **Monotonic provenance:** Attempt/generation/revision are explicit. Stale results are retained as history but never unlock dependencies or overwrite current output.
- **Least interruption:** CoS resolves routine internal ambiguity; human interruptions only for real missing authority, meaningful irreversible choices or genuinely unresolved effects.
- **Fail closed on permissions, not on all progress:** CoS may continue independent authorized work even when one child is blocked; it must not silently broaden scope.
- **Cancellation/steering race:** Cancellation invalidates pending future dispatch; accepted external action may require reconciliation and cannot be claimed undone.
- **Privacy:** No secrets in receipts or provider logs; bounded metadata, explicit source scopes, erasure propagation, no silent personal-memory persistence.
- **Performance:** Reuse existing ticks/SnapshotGate; no new cron worker, per-turn background model, or unconstrained polling. Add metrics for latency, duplicate suppression, stale corrections, unresolved receipts and missed wakeups.
- **Backward compatibility:** Versioned optional fields; tolerate pre-plan historical objectives; staged readers before writers; every migration reversible or safely one-way documented.
- **Feature control:** gated opt-in for steering receipt changes and reviewed continuation, shadow comparison first. Retain existing `FLYD_COS` cutover; do not fork a second CoS switch tree.

## 5. Rollout and evaluation

**Sequence:** P0 truth audit → P1 steering → P2 continuation → P3 identity → P4 delivery → P5 learning. P2 may start in test fixtures while P1 is implemented, but no runtime change ships before its gates.

**Test pyramid:**
- Pure graph/state/property tests: cycle, revision invalidation, dependency closure, exact-once transitions.
- Integration tests with fake FirstMate/Librarian/Design transports and durable scratch stores: crash/restart boundaries, inbox receipt ambiguities, duplicate notifications.
- Contract tests against pinned supported FirstMate APIs and snapshot versions; zero unsupported remote writes.
- Golden user-journey replays: 1-team success, 3-team success, correction, rejection, cancel, revoked source, uncertain dispatch.
- Security tests: prompt-injected evidence, unauthorized downstream implementation, raw path/token leakage, source erasure, malicious artifact preview.
- Installed-Mac acceptance: verify the **actually running Core**, enabled flags, real FirstMate inbox/reply, resumed team, voice correction, notification semantics and safe webview rendering. Unit tests alone do not equal deployment.

**Release metrics (record measured baseline in P0; do not invent historical figures):**
- percentage of corrections with accurate queued/accepted/applied state;
- missing/duplicate child transitions per objective;
- median and p95 verified dependency→next-dispatch latency;
- false “done”/false “needs you” rate;
- outcome-to-first-useful-result latency;
- reversions caused by promoted recipes;
- extra provider calls/CPU from new observers (target no new polling loops).

**Progression:** `shadow` (record decisions, no effect changes) → `canary` on user-authored reversible objectives → `on` after test and Mac gates. Rollback disables new readers/writers and leaves existing durable receipts intact for later reconciliation. Unknown-effect recovery must remain conservative in every mode.

## 6. Explicitly out of scope

- Embedding Multica server, daemon, UI, database, or source code.
- Replacing FirstMate, the Design Team, the existing CoS or AgentRun bounded-recovery subroutine.
- Building a new task board, duplicate artifact canvas, general worker registry, separate memory store or skills marketplace.
- Auto-installing/upgrading runtimes or granting downstream work a new execution authority.
- Treating a model's success summary as verification, or treating transport acceptance as proof feedback was applied.
- Calling planned work “shipped” before code, tests and installed-Mac validation.

## 7. Implementation tickets in order

1. **AUDIT-1:** Trace current `cos.tick` cross-domain flow and link all evidence/receipts; mark existing behavior with test proof.
2. **STEER-1:** Versioned correction receipt adapter around `sendRunMessage`; migration and idempotency.
3. **STEER-2:** FirstMate generation-aware acknowledgment and native manager-checkpoint semantics.
4. **CHAIN-1:** Verified result acceptance contract using existing CoS graph and report.
5. **CHAIN-2:** Resume/reconcile events and dependency invalidation after corrections.
6. **EXEC-1:** Optional executor identity + capability declarations; snapshot/fleet integration.
7. **DELIVER-1:** Evidence projection and user-facing manifestation with truthful links/decisions.
8. **LEARN-1:** Verified candidate recipe through current Skillify and rollout path.
9. **RELEASE-1:** Replay bench, load/performance regression, security review, installed-Mac pilot and rollback drill.

Each ticket must contain a failure reproduction, code owner, modified canonical files, migration notes, negative tests, verification transcript and rollback plan. Mark anything found pre-existing as verified-and-closed, not rebuilt.

## 8. Adversarial architecture review

**Strongest objection:** This risks overengineering semantics around machinery already working. P0 and the phase gates are mandatory precisely to avoid that; ship no new schema without a demonstrated behavior gap. Second objection: acknowledgment may be impossible for some transports. Do not fabricate it—show accepted/queued until checkpoint or independent effect verification. Third objection: stricter evidence can stall useful work. Preserve parallel authorized siblings and use explicitly bounded uncertain/partial states; only high-impact dependent effects require verified prerequisites. Fourth objection: more records could become a project-management product. Keep all operational metadata backstage; Flyd's primary experience remains the result. Fifth objection: the existing Rounds plan overlaps artifact presentation. Integrate via its eventual canonical index, not another screenshot/history store.

## 9. Definition of done

A cold restart, duplicate receipt, stale worker, overlapping user correction, missing artifact, or untrusted source cannot cause Flyd to claim false completion, run an unintended duplicate effect, or lose the original intent. A genuine 3-team objective can finish without manual babysitting, and Flyd shows the right result in the right form with traceable evidence. All test gates and the actual on-Mac pilot are recorded with commit IDs and measured results.

**Next implementation action:** Run P0 audit and add failing end-to-end fixtures before touching architecture.
