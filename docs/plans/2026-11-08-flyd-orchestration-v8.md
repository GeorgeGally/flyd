# Flyd Orchestration — Plan v8

Status: Proposed; not implemented.
Date: 2026-11-08
Authority: `docs/product/flyd-personal-intelligence-prd.md` wins on conflict.
Replaces: `2026-11-08-flyd-autonomous-orchestration-v7.md`.
Keeps: `2026-10-30-flyd-chief-of-staff-split-plan.md` as the plan of record for Phases 0–5. v8 changes only its Phase 6 and adds three small phases after it.

## Why v7 is replaced

v7 plans a durable task graph, event sourcing with correlation and causation IDs, idempotent dispatch, restart reconciliation, an independent reviewer layer, a learning-by-demonstration runtime and an interruption budget. Most of that already exists inside each domain. The rest isn't justified by real use yet.

- **FirstMate already is the Chief of Staff pattern for code.** It is one point of contact with a crew working in parallel worktrees. It wakes on events at no token cost, keeps all state on disk so restarts lose nothing, has scout tasks for research reports, and escalates only real decisions (`~/Documents/firstmate`, README and VISION).
- **Flyd's command layer already has the durable parts.** That covers the idempotent FirstMate inbox (`command/firstmate.ts`, `--request-id`), the staff chaser (`command/fleet-monitor.ts`) and session relaunch with runtime fallback across claude, codex and opencode, capped at 3 identical failures (`FLYD_FIRSTMATE_RUNTIMES`). It also covers Design Mate's Creative Director review (≤3 rounds, ≤2 send-backs) and Librarian's fact checker.
- **The split plan already designs the rest.** It has `Objective.after` (runId → runIds it waits for), release by reconciliation, the revision-checked mutation helper (Phase 2) and replay by request ID for Librarian and Design Mate. It also rules out a new workflow engine, a permanent CoS session, an interruption cap and new approval gates.
- **v7 contradicts a locked decision.** Its Phase 7 adds quiet hours and interruption budgets, but on 2026-10-30 George decided there would be no interruption cap.
- **v7 tests the hardest case first.** Its first test runs parallel branches, a crash, a mid-flight change and a flawed result at once.
- **v7 mirrors Squad's feature list** (triggers, teach-by-demo, a Needs-you queue) rather than starting from what Flyd is missing.

## What is actually missing

1. **Delivery.** The split plan's Phase 1 (`runtime/delivery.ts`, `cos.report`, `flyd.delivered`) isn't built yet; none of those files exist on `main` at a38bb52. It is still George's main complaint and still comes first.
2. **Cross-domain joins.** The split plan's Phase 6 chains runs *in order*. It doesn't run research and design in parallel and then join them into one brief for FirstMate.
3. **Stale results after a correction.** When George changes a requirement mid-flight, nothing stops a result produced under the old requirement from being delivered as if it were current.
4. **Waiting work that needs George.** There is no way to snooze a question. Nothing guarantees that waiting work carries a question he can answer.

Everything else in v7 waits until real use shows it is needed.

## Phases

Split-plan Phases 0–5 run unchanged and in order, with delivery first. v8 begins after them.

### Phase 6 — Chains with parallel joins (replaces split-plan Phase 6)

Build on `Objective.after` and the Phase 2 mutation helper. Add no new store and no graph engine.

**Work**
- Intake may plan up to four runs for one objective. A run may wait on several runs (`after[runId] = [a, b]`). Its dependencies must name runs in the same objective, with no cycles. Intake that breaks this rule becomes a `blocked` report.
- Release by reconciliation, as in the split plan. A run is dispatched when it is `queued`, every dependency is `completed` and it has no receipt. Its own ID is the request ID. Nothing new wakes it: `commandTick` (and the `hand_off` kick) already runs it.
- **The join.** Before dispatching a run with more than one dependency, the CoS writes its brief from the dependencies' retained results in one `quickQuery`. The brief carries George's exact words, the synthesis and links to each dependency's layered result. Summaries never become the only copy that survives, per AGENTS.md.
- **Revision guard.** `Objective` gets `revision`. Each run records the objective revision it was dispatched under. A `tell_work` correction bumps the revision. Queued runs get the new brief. A run already active gets the correction through `sendRunMessage`. When a result arrives stamped with an older revision, it is retained but never delivered. The CoS decides whether to re-run it, or raises a `decision` report if it can't tell.
- **Acceptance.** Before writing `cos.report done`, the CoS checks the final result against the objective's `done_when`. Domain review stays where it is: FirstMate verifies code and the Creative Director reviews design. Add no generic reviewer layer.
- A failed or cancelled dependency still sends the objective to a `decision` report. Nothing retries on its own, as in the split plan.

**Exit**
- Librarian and Design Mate run at the same time. Their results are joined into one brief, which goes to FirstMate, and George gets exactly one delivery.
- Kill Core after the parallel dispatch, after one dependency completes, and after the join dispatch. Each time, every run dispatches exactly once and George gets one delivery.
- Change a requirement while FirstMate is working. The old-revision result is retained and not delivered, and the delivered result matches the new requirement.
- A one-team objective still takes the one-run path.
- Dogfood three real objectives that span domains.

### Phase 7 — Waiting work that needs George

**Work**
- **Snooze.** A `decision`, `credential` or `blocked` report can be set aside until a time George picks (this evening, tomorrow morning, a chosen time). Until then the CoS doesn't raise it again and carries on with any part of the objective that doesn't depend on it. `work_status` still lists it as snoozed, with the time it comes back.
- **Every wait carries a question.** An objective in `needs_george` must have a report George can answer. If it has none, the CoS writes one ("X is waiting on you for Y"), so nothing sits waiting silently.
- **Replying resumes the original objective** through its record. A reply never starts a new task in the chat.
- **Plain run statuses in `work_status`**, shown only when George asks:
  - *interrupted, retrying*
  - *picked up* (a retry finished it)
  - *replaced* (a newer revision took over)
  - *reported twice* (one result kept)
  - *still finishing* (gone quiet; the chaser is on it)

**Exit:** George snoozes a decision and nothing is raised again before the chosen time. The other branches of that objective finish in the meantime. His later reply resumes the same objective and produces one delivery.

### Phase 8 — Triggers (only when George names a real one)

Don't start this phase until George asks for a specific trigger, such as a GitHub event or an email rule.

**Work**
- A trigger opens or advances an objective through the same CoS intake. It never creates a new agent.
- Hard limits, enforced in code:
  - a maximum number of runs per day, with events beyond it kept but not run;
  - an optional list of payload fields, so the CoS gets only those fields;
  - a trigger stays off until George turns it on.
- Trigger payloads are untrusted evidence and never become memory, under the existing AGENTS.md connector rule. They are not learned from. Any wiki change goes through the governed approval pipeline.

**Exit:** a duplicate or noisy event doesn't create a second objective or delivery, and an event beyond the daily cap is kept and not run.

## Enforced in code vs instructions only

Every guarantee in the CoS work must say which kind it is. Squad's docs are honest about this: approvals, draft-first and its decision budget are instructions only. Its enforced controls are app access levels, tool switches, send caps, card approvals and pause. Flyd's plans should be equally clear.

| Guarantee | Kind | Where |
|---|---|---|
| Flyd never changes code | Code: tools removed from Flyd's tool set | split plan Phase 4 |
| Push, publish, send, delete or pipe-to-shell ask George | Code | `runtime/tool-policy.ts` |
| One delivery per report | Code | `flyd.delivered` event, split plan Phase 1 |
| A run dispatches once | Code | request ID and receipt |
| Results from an old revision aren't delivered | Code | Phase 6 revision guard |
| Monthly Claude spend cap | Code | `lib/claude-spend.ts` |
| Send-back caps (≤2 Flyd, ≤3 Creative Director) | Code | `command/design-mate.ts` |
| Trigger daily cap, field filter, off by default | Code | Phase 8 |
| Asking George only for real decisions | Instructions | CoS intake prompt, SOUL |
| Timing follows his focus | Instructions plus pure functions | `runtime/attention.ts`, split plan Phase 1 |
| Brief quality | Instructions, judged in evals | split plan Phase 3 gate |

## Lessons from Squad

| Squad | Verdict for Flyd |
|---|---|
| One job, one owner, readable log for each teammate | Already the pattern: FirstMate, Design Mate, Librarian, plus FirstMate's visible crew |
| Account and provider fallback in the middle of a task | Already built: `FLYD_FIRSTMATE_RUNTIMES` relaunch with backoff |
| A brief with goal, context, constraints, decisions that come back, and done-when | Adopt the *decisions* field. The CoS brief lists which calls come back to George and which are settled by his known policy (command PRD: "whether a coding decision can be resolved from George's known policy") |
| Snooze on Needs you; every waiting task has a question | Adopt (Phase 7) |
| Stuck task triage: Nudge / Park it / It's fine | Open question (below). It conflicts with "staff silence never reaches George" |
| Run statuses (Interrupted, Picked up, Replaced, Reported twice) | Adopt as `work_status` vocabulary, shown only when asked (Phase 7) |
| Trigger caps, field filter, suggested triggers off by default | Adopt if Phase 8 happens |
| Inbound email and trigger text never learned as memory | Already a Flyd rule (AGENTS.md connectors). Restated in Phase 8 |
| Memory that learns after every turn and recalls before every turn | Reject. It is the eager storing and over-connection Flyd exists to refuse |
| Teach a task by demonstration | Reject for now. Squad's users are ops teams repeating browser chores, and nothing shows George needs it. Revisit only if a real repeated procedure turns up |
| Daily send caps, a decision budget | Don't add without George. AGENTS.md says no new approval gates without asking him, and he ruled out an interruption cap |
| Mission board dashboard | Reject. Delivery is semantic (split plan), and `work_status` answers status questions |

## Dropped from v7

- Durable task-node schema, execution-attempt records, correlation and causation IDs. Phase 6 uses `Objective`, `DomainRun`, request IDs and receipts.
- The generic independent reviewer and the bounded-rework engine. Domain review already exists, and the CoS checks `done_when`.
- Reusable skills from demonstration (v7 Phase 6).
- Quiet hours and interruption budgets (v7 Phase 7).
- Event adapters for Gmail and webhooks in general. Phase 8 waits for a named trigger.

## Open questions for George

1. **Stuck objectives.** Staff silence never reaches you today. Should an *objective* with no progress for a day reach you as a one-tap decision (Nudge / Park / It's ongoing), or should it stay silent?
2. **Send caps.** If staff ever send outbound email or messages on their own, do you want a daily cap enforced in code, or is today's "send asks George" policy enough?
3. **Parallel limit.** Is four runs per objective the right ceiling for Phase 6, or should it be lower until the dogfood runs?

## First backlog

1. Split-plan Phase 0 baseline, then Phase 1 delivery. Neither is built yet.
2. Split-plan Phases 2–5 as written.
3. Phase 6: write failing tests for the parallel join, the three crash points and the stale revision; then add `revision`, multi-dependency release and the join brief.
4. Dogfood three real objectives that span domains before starting Phase 7.

No implementation is claimed by this document.
