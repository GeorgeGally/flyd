# Flyd Chief of Staff — Orchestration Plan v6

Status: Proposed. No implementation claimed.
Date: 2026-10-30
Supersedes: `2026-10-30-chief-of-staff-orchestration-v5.md`
Authority: `docs/product/flyd-personal-intelligence-prd.md` wins where this plan conflicts with it.

## Why v6

v5 specified a new coordination layer: objectives, assignments, leases, wake claims, budgets. About half of that already exists in `cli/src/command/` and `cli/src/intelligence/`. v6 starts from what the code does today. It proves the existing parts with tests, fixes the one concrete defect found, and builds only the capability that is actually missing: work in one run starting work in another.

## What already exists (verified against `main` at f2b2582)

| v5 asks for | Already in the code |
|---|---|
| Durable delegated work that survives restart | `DomainRun` JSON per run in `~/.flyd/command/runs/`, written atomically (temp file + rename) by `command/store.ts`. `advanceDesignRun` saves every step, so a restart resumes from the last one. |
| Automatic parent continuation | `command/scheduler.ts` `commandTick()` syncs FirstMate, Librarian and Design Mate runs every 15 s. On a terminal status, `notifyRun` → `decideRun` → `processFirstmateChange` runs the executive decision step. |
| Executive accountability with authority | `intelligence/executive/decision-step.ts` persists each decision as an event in the SQLite spine (`persistExecutiveDecision`), with `authorityForStaffRun` and the autonomy level from `tool-policy.ts`. |
| Send-back and review loops | `deliverBossNote` returns work to its boss once per note. Design Mate caps itself at `MAX_ROUNDS = 3` and `MAX_SENDBACKS = 2`. |
| Steering primitives | `DomainMessageKind`: `correction`, `decision`, `priority_change`, `question`, `cancel`, delivered through `command/messages.ts`. |
| Parent linkage | `DomainRequest.parentRequestId`; `command/followup.ts` dispatches a follow-up run carrying its parent's brief, report and evidence. |
| Budgets and limits | Executive cycle: `dailyInterruptionBudget` (3), quiet hours, cooldown, kill switch. `lib/claude-spend.ts`: monthly Claude cap and cost ledger. |
| One voice to George | `lib/reaches-george.ts` and `council/chief-of-staff.ts` filter what reaches him. |
| Idempotent event spine | `intelligence/event-store.ts`: SQLite WAL, idempotency key, correlation and causation ids, authority grant id, budget key. |

## What is actually missing

1. **Proof.** No test drives a design or knowledge run through `commandTick` → completion → executive decision → notice across a simulated restart. Delegation durability is assumed, not tested.
2. **A lost-update defect (to be confirmed by test).** `sendRunMessage` writes the whole run object it was handed (`saveDomainRun(withPending)`). If a caller holds a stale copy while Design Mate's `save()` advances the run on disk, the message write can overwrite the newer `phase` or `status`. `save()` in `design-mate.ts` re-reads before merging; `messages.ts` does not.
3. **Three stores with no stated owner.** Domain runs are JSON files, executive decisions are SQLite events, and `flyd code` sessions and repository-action jobs use Postgres or fall back silently to memory (`runtime/cli-chat-kernel.ts`, `work-intelligence/repository-action-job.ts`). That fallback does not affect delegation, but it is unrecorded and contradicts the AGENTS.md rule against depending on Postgres.
4. **Dependencies between runs.** Follow-ups are started by George. Nothing starts a run because another run finished. "Design picks a direction, then the build starts and gets reviewed" works today only inside Design Mate; nothing crosses domains on its own.

## Phases

Each phase has one exit test. If a phase's test cannot be written against the current code in a few days, stop and record why before continuing.

### Phase A — Prove what exists

**Work**
- Integration test (vitest, `FLYD_COMMAND_DIR` and `FLYD_DIR` pointed at temp dirs, model calls stubbed through `DesignMateDeps.complete` and the `decideRun` `complete` argument): dispatch a design run, advance it partway, discard all in-memory state, run `commandTick` again, and assert it finishes, records exactly one executive decision event, and sends exactly one notice.
- Same test for a Librarian run.
- Duplicate test: run `commandTick` twice on a completed run and assert no second decision or notice. This covers `notified` and `deliverBossNote`.
- Lost-update test: start from run state S, advance it on disk to S′, then call `sendRunMessage` with S, and assert S′'s `phase` and `status` survive.

**Exit:** all four tests exist. The first three pass against current code. The fourth either passes, or fails and is fixed in Phase A by making `sendRunMessage` re-read and merge the way `design-mate.ts` `save()` does.

### Phase B — Name the owner of each store

**Work**
- ADR in `docs/architecture/`: domain runs stay JSON for now, with read-merge-write as the only write path. Executive decisions and objective-level facts live in the SQLite event spine. Postgres is confined to `flyd code` sessions and repository-action jobs. Record whether those two should move to SQLite, and why.
- Replace both silent Postgres fallbacks with a logged, visible degradation (one line in `flyd doctor` plus the Core launch log). Don't throw; the CLI must keep working without Postgres.
- Route every `saveDomainRun` caller through one read-merge-write helper in `command/store.ts`, and keep the Phase A lost-update test green.

**Exit:** ADR merged, `flyd doctor` reports run-store durability, and `grep saveDomainRun` shows only the helper writing whole runs.

### Phase C — Dependencies between runs

The one new capability.

**Work**
- Add `DomainRequest.after?: { runId: string; when: "completed" }[]`, a list of blocking dependencies. Nothing else in the request changes.
- In `commandTick`, a queued run whose dependencies have all completed is dispatched with each parent's result attached, the way `followup.ts` builds `parentContext` today. A run whose dependency failed or was cancelled moves to `needs_decision` and goes through the existing executive decision step. It does not retry on its own.
- Dispatch is idempotent: record a `domain.dependency_released` event in the spine with idempotency key `release:<runId>` before dispatching, and skip any run whose key already exists.
- Flyd (the conversation responder) can create a pair in one turn, e.g. a knowledge run followed by a coding run that uses its findings.
- Authority: a dependent run inherits its parent's `source` and never widens the autonomy level. Push, publish, send and delete still ask George through `tool-policy.ts`.
- Budgets: none added. Dependent runs count against the existing interruption budget and Claude spend cap.

**Exit:** integration test in which a Librarian run completes, the dependent coding run dispatches exactly once (including after a simulated restart between completion and dispatch), and George receives one notice for the pair, not two. Then dogfood: three real two-step objectives used by George before anything in Deferred starts.

## Deferred, with the trigger that would justify each

| Item from v5 | Start only when |
|---|---|
| Event-driven wake instead of the 15 s poll | George reports dependent work feeling slow, or a measured poll-to-dispatch delay hurts a real objective. Until then, drop v5's 5-second target: it contradicts the scheduler. |
| Mid-flight steering across a dependency chain | A real Phase C pair needs a correction that `correction` / `priority_change` on the individual runs could not handle. |
| Design Mate builds routed through FirstMate (v5 Phase 06) | Evidence that FirstMate builds meaningfully better than Design Mate's own Designers. Design Mate already builds and commits picked versions in George's project. |
| Leases, fencing, outbox and inbox | A second writer exists. Today one Core process owns `~/.flyd/command`; the PRD allows only one canonical writable owner. |
| Moving domain runs into the event spine | The Phase B ADR concludes the JSON store is blocking something specific. |
| Grandchildren, parallel fan-out, tree cancellation | Phase C pairs are in regular use and a real objective needs more than two steps. |

## Product measure

Infrastructure tests prove correctness, not value. Track, in `flyd scorecard` or the executive decision record: **two-step objectives George accepts without asking for rework.** If after the Phase C dogfood he would rather start each step himself, stop here.

## Non-goals

- No new coordination engine, objective store or budget system alongside the existing ones.
- No new approval gates (AGENTS.md: ask George before adding any).
- No permanently running Chief of Staff model session.
- No agent-chat surface. George only talks to Flyd.

## Open question for George

v5 put FirstMate in charge of engineering for design builds. Design Mate's Designers already build and commit picked versions. Should design builds stay with Design Mate, or is there a quality reason to hand them to FirstMate?
