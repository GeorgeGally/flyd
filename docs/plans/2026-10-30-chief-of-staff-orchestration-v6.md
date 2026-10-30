# Flyd Chief of Staff — Orchestration Plan v6

Status: Superseded by `2026-10-30-flyd-chief-of-staff-split-plan.md` (Phases A–C live on there as Phases 1 and 6). No implementation claimed.
Date: 2026-10-30
Supersedes: `2026-10-30-chief-of-staff-orchestration-v5.md` as the build plan. v5's end state still stands as the direction (see "End state").
Authority: `docs/product/flyd-personal-intelligence-prd.md` wins where this plan conflicts with it.

## Why v6

v5 specified a new coordination layer: objectives, assignments, leases, wake claims, budgets. A good share of the machinery it asked for already exists in `cli/src/command/` and `cli/src/intelligence/`. v6 starts from what the code does today. It proves the existing parts with tests, fixes the defects found, and builds one vertical slice: two runs in sequence, delivered to George once. Objective-level ownership, steering and wider collaboration come after that slice shows what is actually missing. The product goal does not shrink; the build order does.

## What already exists (verified against `main` at f2b2582)

| v5 asks for | Already in the code |
|---|---|
| Durable delegated work that survives restart | `DomainRun` JSON per run in `~/.flyd/command/runs/`, written atomically (temp file + rename) by `command/store.ts`. `advanceDesignRun` saves every step, so a restart resumes from the last one. |
| Executive review of finished work | `command/scheduler.ts` `commandTick()` syncs FirstMate, Librarian and Design Mate runs every 15 s. For a terminal status, `notifyRun` → `decideRun` → `processFirstmateChange` runs the executive decision step. **Limit:** `notifyRun` skips that step entirely for runs whose `source` is `view`, `flyd` or `self-improvement` and only marks them notified. Runs George starts from the conversation window (`conversation-view/firstmate-inbox.ts` sets `source: "view"`) get no executive review on completion. |
| Executive accountability with authority | `intelligence/executive/decision-step.ts` persists each decision as an event in the SQLite spine (`persistExecutiveDecision`), with `authorityForStaffRun` and the autonomy level from `tool-policy.ts`. |
| Send-back and review loops | `deliverBossNote` returns work to its boss once per note. Design Mate caps itself at `MAX_ROUNDS = 3` and `MAX_SENDBACKS = 2`. |
| Steering primitives | `DomainMessageKind`: `correction`, `decision`, `priority_change`, `question`, `cancel`, delivered through `command/messages.ts`. |
| Parent linkage | `DomainRequest.parentRequestId`; `command/followup.ts` dispatches a follow-up run carrying its parent's brief, report and evidence. Follow-ups are started by George, never by a finished run. |
| Idempotent dispatch to FirstMate | `fm-inbox.sh note --request-id` replays a note already held for the same request id (`command/firstmate.ts`). Librarian and Design Mate dispatch have not been checked for the same property. |
| Budgets and limits | Executive cycle: `dailyInterruptionBudget` (3), quiet hours, cooldown, kill switch. `lib/claude-spend.ts`: monthly Claude cap and cost ledger. |
| One voice to George | `lib/reaches-george.ts` and `council/chief-of-staff.ts` filter what reaches him. |
| Idempotent event spine | `intelligence/event-store.ts`: SQLite WAL, idempotency key, correlation and causation ids, authority grant id, budget key. |

## What is actually missing

1. **Proof.** No test drives a design or knowledge run through `commandTick` → completion → executive decision → notice across a simulated restart. Delegation durability is assumed, not tested.
2. **Unsafe writes to domain runs.** `sendRunMessage` writes the whole run object it was handed (`saveDomainRun(withPending)`), then awaits FirstMate and writes `withPending` again. That second write is stale by construction. There is also more than one writer process: Core's command scheduler, and the separate `flyd view` process (`commands/view.ts` calls `sendRunMessage`). Re-reading before writing fixes the in-process case only; it does not stop two processes interleaving between read and write.
3. **Three stores with no stated owner.** Domain runs are JSON files, executive decisions are SQLite events, and `flyd code` sessions and repository-action jobs use Postgres or fall back silently to memory (`runtime/cli-chat-kernel.ts`, `work-intelligence/repository-action-job.ts`). That fallback does not affect delegation, but it is unrecorded and contradicts the AGENTS.md rule against depending on Postgres.
4. **Dependencies between runs.** Nothing starts a run because another run finished. "Design picks a direction, then the build starts and gets reviewed" works today only inside Design Mate; nothing crosses domains on its own.
5. **One delivery for multi-run work.** Each run settles and notifies on its own. There is no notion of "this group of runs is one piece of work for George," so a chain would reach him as several results, or (for `view`-sourced work) as none.

## Phases

Each phase has one exit test. If a phase's test cannot be written against the current code in a few days, stop and record why before continuing.

### Phase A — Prove what exists

**Work**
- Integration test (vitest, `FLYD_COMMAND_DIR` and `FLYD_DIR` pointed at temp dirs, model calls stubbed through `DesignMateDeps.complete` and the `decideRun` `complete` argument): dispatch a design run, advance it partway, discard all in-memory state, run `commandTick` again, and assert it finishes, records exactly one executive decision event, and sends exactly one notice.
- Same test for a Librarian run.
- Same test for a `view`-sourced run, asserting today's behaviour (no executive decision, marked notified) so Phase C changes it deliberately, not by accident.
- Duplicate test: run `commandTick` twice on a completed run and assert no second decision or notice. This covers `notified` and `deliverBossNote`.
- Stale-write test: start from run state S, advance it on disk to S′, then call `sendRunMessage` with S, and assert S′'s `phase` and `status` survive.
- Dispatch replay test for Librarian and Design Mate: dispatch the same request id twice and record whether a second run or job is created.

**Exit:** all six tests exist. The first four pass against current code. The last two record the truth, pass or fail; failures are fixed in Phase B.

### Phase B — Safe writes and named store owners

**Work**
- Add a `revision` number to `DomainRun`. Replace direct `saveDomainRun` calls with one mutation helper in `command/store.ts`: take a per-run lock file (`runs/<id>.lock`, created exclusively, with a stale-lock timeout), read the current run, apply the caller's change as a function of that current run, bump `revision`, write via temp + rename, release. A caller never passes a whole run to write.
- `sendRunMessage` uses the helper for both its writes, so the post-await write applies to the current run, not `withPending`.
- Make Librarian and Design Mate dispatch replay by request id if Phase A showed they don't, matching FirstMate.
- ADR in `docs/architecture/`: domain runs stay JSON behind the mutation helper; executive decisions and multi-run facts live in the SQLite event spine; Postgres is confined to `flyd code` sessions and repository-action jobs. Record whether those two should move to SQLite, and why.
- Replace both silent Postgres fallbacks with a logged, visible degradation (one line in `flyd doctor` plus the Core launch log). Don't throw; the CLI must keep working without Postgres.

**Exit:** a two-process test (two child processes hammering messages and phase changes at one run) loses no update. `grep saveDomainRun` shows only the helper. The Phase A stale-write and replay tests pass. ADR merged.

### Phase C — Two runs in sequence, delivered once

The first vertical slice of the Chief of Staff capability.

**Work**
- Add `DomainRequest.after?: { runId: string; when: "completed" }[]`, a list of blocking dependencies, and `DomainRequest.objectiveId?: string`, which groups runs that are one piece of work for George. Nothing else in the request changes.
- When Flyd creates a chain, it creates every run record up front in `queued` status with its final id. Dispatch never creates a run; it only advances one that already exists.
- **Release by reconciliation, not by a skip-marker.** On every `commandTick`, a run that is `queued`, has all dependencies `completed`, and has no `transport.externalId` is dispatched with its own id as the request id and each parent's result attached (the way `followup.ts` builds `parentContext`). Because dispatch replays by request id (Phase B), a crash between dispatch and recording the receipt makes the next tick redeliver to the same request rather than lose or duplicate it. A `domain.dependency_released` event is appended *after* the receipt, for audit only. Nothing reads it to decide whether to dispatch.
- A run whose dependency failed or was cancelled moves to `needs_decision` and goes through the executive decision step. It does not retry on its own.
- **Delivery is per objective, not per run.** Within an objective, intermediate runs settle silently. When the last run in the objective reaches a terminal status, the executive decision step runs once over the whole chain's results, whatever the original `source` was, and produces at most one notice or one in-window reply. This is the one place the `view`/`flyd` bypass in `notifyRun` is overridden, and the Phase A `view` test is updated to match.
- Authority: a dependent run never widens its parent's autonomy level. Push, publish, send and delete still ask George through `tool-policy.ts`.
- Budgets: none added. Chains count against the existing interruption budget and Claude spend cap.

**Exit:** integration tests in which a Librarian run completes and the dependent coding run dispatches exactly once, with a simulated crash injected at each point: (1) after the parent completes, before dispatch; (2) after dispatch, before the receipt is saved; (3) after the receipt, before the audit event. George receives exactly one delivery for the objective in each case, including when the chain began from the conversation window. Then dogfood: three real two-step objectives used by George.

### After Phase C

Expand toward the end state one step at a time, each step justified by a gap the dogfooded slice actually showed. The triggers below say what counts as that evidence.

## Deferred, with the trigger that would justify each

| Item from v5 | Start only when |
|---|---|
| Objective-level ownership beyond a linear chain (a durable objective record with success criteria and authority) | A dogfooded chain needed a decision about the whole objective that per-run executive decisions could not make. |
| Mid-flight steering across a chain | A real chain needed a correction that `correction` / `priority_change` on the individual runs could not handle, or that had to reach runs not yet started. |
| Event-driven wake instead of the 15 s poll | George reports chains feeling slow, or a measured poll-to-dispatch delay hurts a real objective. v5's 5-second target is dropped: it contradicts the scheduler. |
| Design Mate builds routed through FirstMate (v5 Phase 06) | Dropped: George decided design builds stay with Design Mate. Reopen only if he asks. |
| Leases and fencing | The Phase B lock-plus-revision helper proves insufficient under a real workload, e.g. a server-hosted Core writing alongside the Mac one. |
| Moving domain runs into the event spine | The Phase B ADR concludes the JSON store is blocking something specific. |
| Parallel fan-out, grandchildren, tree cancellation | Linear chains are in regular use and a real objective needs more than a sequence. |

## End state (direction, not build plan)

v5's definition of done remains the destination: Flyd accepts a substantial design-and-build objective, hands accountability to the Chief of Staff, stays available, accepts a mid-flight correction, survives a restart, coordinates teams through review and rework, and presents one verified result or a real decision request. v6 builds the smallest slice of that which can be dogfooded. It does not commit to v5's phases or data model for the rest.

## Product measure

Infrastructure tests prove correctness, not value. For each objective, record two numbers from data that already exists:

- **Accepted without rework:** the objective's final delivery was accepted and no follow-up run was started to fix it.
- **Supervision:** the count of George's own messages (a `DomainMessage` without `from: "flyd"`) on the objective's runs between creation and delivery.

Success is accepted objectives with supervision at or near zero. An objective George accepted only after repeated nudging counts as a supervision failure, not a success. If after the Phase C dogfood he would rather start each step himself, stop here.

## Non-goals

- No new coordination engine or budget system alongside the existing ones. The objective id groups runs; it is not a second store.
- No new approval gates (AGENTS.md: ask George before adding any).
- No permanently running Chief of Staff model session.
- No agent-chat surface. George only talks to Flyd.

## Decided

- **Design builds stay with Design Mate** (George, 2026-10-30). Its Designers keep building and committing picked versions in George's project. FirstMate is used when a task needs broader engineering, not inserted into design work.

## Revision notes (2026-10-30, same day)

A review of the first v6 draft found three faults, all confirmed against the code and fixed above:

1. The draft overstated automatic continuation and missed that `notifyRun` skips executive review for `view`/`flyd`/`self-improvement` runs. Under the draft's rule that a dependent run inherits its parent's `source`, a chain started from the conversation window would have delivered nothing. Fixed by per-objective delivery.
2. The draft's release rule (record `dependency_released`, skip dispatch if it exists) loses the dependent run if Core crashes between recording and dispatching. Fixed by pre-created runs, dispatch that replays by request id, and reconciliation from run state; the event became audit-only.
3. The draft assumed a single writer and proposed read-merge-write. `flyd view` is a second writer process, and `sendRunMessage` writes stale state after an await. Fixed by a lock-plus-revision mutation helper and a two-process test.

It also widened the product measure to count supervision, and restored v5's end state as the stated direction.
