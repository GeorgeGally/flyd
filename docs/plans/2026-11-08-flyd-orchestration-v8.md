# Flyd Orchestration — Plan v8 (final)

Status: Final; approved by George 2026-11-08. Not implemented.
Date: 2026-11-08
Authority: `docs/product/flyd-personal-intelligence-prd.md` wins on conflict.
Replaces: `2026-11-08-flyd-autonomous-orchestration-v7.md`.
Keeps: `2026-10-30-flyd-chief-of-staff-split-plan.md` as the plan of record for Phases 0–5. v8 replaces its Phase 6 and adds two phases after it, plus one more held until George names a real trigger.

## Why v7 is replaced

v7 plans a durable task graph, event sourcing with correlation and causation IDs, idempotent dispatch, restart reconciliation, an independent reviewer layer, a learning-by-demonstration runtime and an interruption budget. Most of that already exists inside each domain. The rest isn't justified by real use yet.

- **FirstMate already is the Chief of Staff pattern for code.** It is one point of contact with a crew working in parallel worktrees. It wakes on events at no token cost, keeps all state on disk so restarts lose nothing, has scout tasks for research reports, and escalates only real decisions (`~/Documents/firstmate`, README and VISION).
- **Flyd's command layer already has the durable parts.** That covers the idempotent FirstMate inbox (`command/firstmate.ts`, `--request-id`), the staff chaser (`command/fleet-monitor.ts`) and session relaunch on Claude only (Codex is kept for images), capped at 3 identical failures (`FLYD_FIRSTMATE_RUNTIMES`). It also covers Design Mate's Creative Director review (≤3 rounds, ≤2 send-backs) and Librarian's fact checker.
- **The split plan already designs the rest.** It has `Objective.after` (runId → runIds it waits for), release by reconciliation, the revision-checked mutation helper (Phase 2) and replay by request ID for Librarian and Design Mate. It also rules out a new workflow engine, a permanent CoS session, an interruption cap and new approval gates.
- **v7 contradicts a locked decision.** Its Phase 7 adds quiet hours and interruption budgets, but on 2026-10-30 George decided there would be no interruption cap.
- **v7 tests the hardest case first.** Its first test runs parallel branches, a crash, a mid-flight change and a flawed result at once.
- **v7 mirrors Squad's feature list** (triggers, teach-by-demo, a Needs-you queue) rather than starting from what Flyd is missing.

## What is actually missing

1. **Delivery.** The split plan's Phase 1 (`runtime/delivery.ts`, `cos.report`, `flyd.delivered`) isn't built yet; none of those files exist on `main` at a38bb52. It is still George's main complaint and still comes first.
2. **Cross-domain joins.** The split plan's Phase 6 chains runs *in order*. It doesn't run research and design in parallel and then join them into one brief for FirstMate.
3. **Stale results after a correction.** When George changes a requirement mid-flight, nothing stops a result produced under the old requirement from being delivered as if it were current.
4. **Waiting work that needs George.** There is no way to snooze a question. Nothing guarantees that waiting work carries a question he can answer.
5. **Recovering from failure.** A failed run always goes to George, even when the CoS could reasonably fix it itself.

Everything else in v7 waits until real use shows it is needed.

## Phases

Split-plan Phases 0–5 run unchanged and in order, with delivery first. v8 begins after them.

### Phase 6 — Chains with parallel joins (replaces split-plan Phase 6)

Build on `Objective.after` and the Phase 2 mutation helper. Add no new store and no graph engine.

**Work**
- **No fixed number of runs per objective.** A run may wait on several runs (`after[runId] = [a, b]`). Its dependencies must name runs in the same objective, with no cycles. Intake that breaks this rule becomes a `blocked` report.
- **Plan only what is known now.** Intake plans the runs it can brief now. When a join completes, the CoS may add the next runs to the objective, with the joined results in hand. A twelve-step plan written before any research comes back goes stale, so a long objective grows layer by layer rather than being planned up front.
- **Limit runs active at once, not runs in total.** Release counts the CoS-dispatched runs that are active across all objectives and holds the rest `queued` when the limit is reached (`FLYD_COS_MAX_ACTIVE`, default 3). This is enforced in code at release. A FirstMate run counts as one, because FirstMate schedules its own crew under its own limits. Flyd doesn't second-guess that.
- Release by reconciliation, as in the split plan. A run is dispatched when it is `queued`, every dependency is `completed`, it has no receipt and the active limit has room. Its own ID is the request ID. Nothing new wakes it: `commandTick` (and the `hand_off` kick) already runs it.
- **The join.** Before dispatching a run with more than one dependency, the CoS writes its brief from the dependencies' retained results in one `quickQuery`. The brief carries George's exact words, the synthesis and links to each dependency's layered result. Summaries never become the only copy that survives, per AGENTS.md.
- **Corrections invalidate only what they affect.** `Objective` gets `revision`. Each run records `validFor`, the objective revision its result still holds for.
  - A `tell_work` correction bumps the revision. As in Phase 4, the CoS resolves which run the correction targets.
  - Code invalidates that run and every run downstream of it. Every other run gets `validFor` moved to the new revision and keeps its result. Correcting an implementation detail targets the FirstMate run, so finished research and design stay valid with no model judgment involved.
  - A correction that changes what was researched or designed targets that upstream run instead, and its downstream runs are re-run.
  - Invalidated runs that are queued get the new brief. Active ones get the correction through `sendRunMessage`. Completed ones are re-queued with their retained result attached as prior work.
  - When a result arrives with `validFor` older than the current revision, it is retained and never delivered.
  - **Delivery rule, enforced in code:** `cos.report done` may be written only when every run the result depends on is valid for the current revision.
  - If the CoS can't tell which run a correction targets, it raises one `decision` report rather than invalidating everything.
- **Duplicate prevention is not exactly-once execution.** Dispatch writes the run as `dispatching` before calling the executor.
  - On restart, any run still `dispatching` is reconciled, never blindly retried. For FirstMate, the same request ID is sent again. `fm-inbox.sh note --request-id` claims the ID atomically, so a note that was already accepted comes back as `replay` with its existing note ID, and Flyd records that receipt. For Librarian and Design Mate, this uses the split plan's Phase 2 request-ID replay.
  - An executor that can't answer for a request ID leaves the run `unknown`. The CoS asks the executor where it stands (as the fleet monitor does) before doing anything else.
  - Side effects inside an executor, such as a pushed branch or an opened PR, are the executor's to keep single. FirstMate owns PR and delivery state (command PRD §5). The CoS never re-dispatches to cause a side effect a second time.
- **Acceptance.** Before writing `cos.report done`, the CoS checks the final result against the objective's `done_when`. Domain review stays where it is: FirstMate verifies code and the Creative Director reviews design. Add no generic reviewer layer.
- **Adapt before escalating.** This changes the split plan's "nothing retries on its own". George wants Flyd to answer most of these itself.
  - When a run fails, the CoS may try **one** alternative: re-brief the same team with the failure evidence, hand the work to another team, or drop the path if `done_when` doesn't need its result.
  - At a join, the CoS may also cancel queued runs that the joined results make pointless.
  - It never re-dispatches a run in `unknown` state, and never retries anything that may have caused an outside side effect.
  - If the alternative also fails, or no alternative exists, the objective goes to a `decision` report.
  - Every adaptation is recorded on the objective with its reason, so `work_status` can explain it. Code caps it at one per run.

**Exit**
- Librarian and Design Mate run at the same time. Their results are joined into one brief, which goes to FirstMate, and George gets exactly one delivery.
- Kill Core after the parallel dispatch, after one dependency completes, and after the join dispatch. Each time, every executor accepts each run once and George gets one delivery.
- **Uncertain dispatch:** kill Core after `fm-inbox.sh` saved the note but before Flyd recorded the receipt. On restart the run is reconciled through `replay`, there is still one note in FirstMate's inbox, and the run carries its receipt. Repeat with a fake executor that cannot answer for the request ID: the run goes to `unknown` and is not re-sent.
- Correct an implementation detail after research and design have finished. Research and design aren't re-run and keep their results. Only the FirstMate run is redone, and the delivered result matches the latest revision.
- Correct something that changes the research question. The Librarian run and everything downstream of it are re-run; the Design Mate run is re-run only if it depends on the research.
- A one-team objective still takes the one-run path.
- With the active limit set to 1, the same parallel objective runs one run at a time and still finishes with one delivery.
- A join that adds runs after it completes dispatches each added run exactly once, including after a crash.
- A run that fails once gets one alternative and the objective still completes. A run that fails twice produces one `decision` report and no third attempt.
- Dogfood three real objectives that span domains.

### Phase 7 — Waiting work that needs George

**Work**
- **Snooze.** A `decision`, `credential` or `blocked` report can be set aside until a time George picks (this evening, tomorrow morning, a chosen time). Until then the CoS doesn't raise it again and carries on with any part of the objective that doesn't depend on it. `work_status` still lists it as snoozed, with the time it comes back.
- **Stuck objectives are mostly Flyd's to settle.** When an objective has made no progress for a day, the CoS settles it from George's known policy and what the objective is waiting on:
  - *nudge* the owner, through the fleet monitor's existing chase;
  - *park* it, if it is waiting on something outside Flyd's control;
  - mark it *ongoing*, if it is meant to run continuously.

  It records which it chose. Only when it can't tell does George get a one-tap decision (Nudge / Park / It's ongoing). Staff silence on its own still never reaches him.
- **Every wait carries a question.** An objective in `needs_george` must have a report George can answer. If it has none, the CoS writes one ("X is waiting on you for Y"), so nothing sits waiting silently.
- **Replying resumes the original objective** through its record. A reply never starts a new task in the chat.
- **Plain run statuses in `work_status`**, shown only when George asks:
  - *interrupted, retrying*
  - *picked up* (a retry finished it)
  - *replaced* (a newer revision took over)
  - *reported twice* (one result kept)
  - *still finishing* (gone quiet; the chaser is on it)

**Exit:** a stuck objective whose owner can be chased is nudged without George hearing about it, and one the CoS can't read reaches him as one decision. George snoozes a decision and nothing is raised again before the chosen time. The other branches of that objective finish in the meantime. His later reply resumes the same objective and produces one delivery.

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
| Staff never send outbound messages without George's explicit permission | Code: CoS-dispatched work has no send capability; a send becomes a `decision` report carrying the draft, and only George's approval of that item sends it | Phase 6, `tool-policy.ts` |
| One alternative per failed run, then escalate | Code | Phase 6 adaptation count |
| One delivery per report | Code | `flyd.delivered` event, split plan Phase 1 |
| An executor accepts a run once | Code: request-ID replay; uncertain runs are reconciled, not retried | `command/firstmate.ts`, Phase 6 |
| Side effects inside an executor happen once | The executor's job, not Flyd's | FirstMate (command PRD §5) |
| Delivery only from results valid for the latest revision | Code | Phase 6 `validFor` check |
| Monthly Claude spend cap | Code | `lib/claude-spend.ts` |
| Active CoS runs at once (default 3) | Code | Phase 6 release, `FLYD_COS_MAX_ACTIVE` |
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
| Stuck task triage: Nudge / Park it / It's fine | Adopt, with the CoS settling most of them itself; George decides only what it can't (Phase 7) |
| Run statuses (Interrupted, Picked up, Replaced, Reported twice) | Adopt as `work_status` vocabulary, shown only when asked (Phase 7) |
| Trigger caps, field filter, suggested triggers off by default | Adopt if Phase 8 happens |
| Inbound email and trigger text never learned as memory | Already a Flyd rule (AGENTS.md connectors). Restated in Phase 8 |
| Memory that learns after every turn and recalls before every turn | Reject. It is the eager storing and over-connection Flyd exists to refuse |
| Teach a task by demonstration | Reject for now. Squad's users are ops teams repeating browser chores, and nothing shows George needs it. Revisit only if a real repeated procedure turns up |
| Daily send caps | Not needed. Nothing is sent without George's explicit permission (decided 2026-11-08) |
| A decision budget | Reject. George ruled out an interruption cap |
| Mission board dashboard | Reject. Delivery is semantic (split plan), and `work_status` answers status questions |

## Dropped from v7

- Durable task-node schema, execution-attempt records, correlation and causation IDs. Phase 6 uses `Objective`, `DomainRun`, request IDs and receipts.
- The generic independent reviewer and the bounded-rework engine. Domain review already exists, and the CoS checks `done_when`.
- Reusable skills from demonstration (v7 Phase 6).
- Quiet hours and interruption budgets (v7 Phase 7).
- Event adapters for Gmail and webhooks in general. Phase 8 waits for a named trigger.

## Decided (George, 2026-11-08)

1. **Stuck objectives.** The CoS settles most of them itself (nudge, park or ongoing). George gets a one-tap decision only when it can't tell (Phase 7).
2. **Sending.** Nothing is sent outbound without George's explicit permission. Staff work turns every send into a decision carrying the draft, and that is enforced in code, so no send cap is needed.
3. **Active limit.** Undecided. Ship `FLYD_COS_MAX_ACTIVE=3` as the default, record queue waits and usage-limit backoffs during the Phase 6 dogfood, and set the default from that data.

## First backlog

1. Split-plan Phase 0 baseline, then Phase 1 delivery. Neither is built yet.
2. Split-plan Phases 2–5 as written.
3. Phase 6: write failing tests for the parallel join, the three crash points and the stale revision; then add `revision`, multi-dependency release and the join brief.
4. Dogfood three real objectives that span domains before starting Phase 7, recording queue waits and usage-limit backoffs to settle the active limit.

No implementation is claimed by this document.
