# Flyd and the Chief of Staff — Split Plan

Status: Proposed. No implementation claimed.
Date: 2026-10-30
Supersedes: `2026-10-30-chief-of-staff-orchestration-v6.md` (its Phases A–C are absorbed below as Phases 1 and 6) and `-v5.md`.
Authority: `docs/product/flyd-personal-intelligence-prd.md` wins on conflict. Amends `docs/product/flyd-command-architecture-prd.md` §1, §6 and §12 (see Phase 5).

## Goal

Give Flyd a Chief of Staff that runs all delegated work, so Flyd can be an attentive personal assistant instead of a manager.

- **Flyd** listens, knows George, does quick personal things itself, hands anything bigger to the Chief of Staff in one step, and tells George what came back, at a moment and in a way that suits him.
- **The Chief of Staff (CoS)** owns everything after the handoff: choosing the team, writing the brief, dispatching, chasing, reviewing and sending work back, applying George's corrections, chaining steps, deciding when work is done, and handing Flyd one report per piece of work.

One voice still holds: George only ever talks to Flyd. The CoS never speaks to him directly.

## Where things stand today (verified against `main` at bd2f4f4)

Flyd *is* the chief of staff today, in identity and in code.

| Concern | Today | Where |
|---|---|---|
| Identity | Default voice opens "You are Flyd, George's chief of staff… FirstMate… the researchers and every background job are your staff." | `cli/src/lib/soul.ts` L12–15, `SOUL.md` |
| Command role | "Flyd decides who should own the work, gives that domain the right context and authority, supervises…" | `docs/product/flyd-command-architecture-prd.md` §1 |
| Choosing the team and writing the brief | Done inside Flyd's chat turn. On a `delegate` route only the matching `start_*` tool is visible; the chat model writes `outcome` and `done_when`. | `runtime/turn-plan.ts` L105–122; `runtime/assistant-tools.ts` L284–398 |
| Delegation substrates | Four, each with its own entry point: domain runs (`dispatchCodingDomain`, `dispatchKnowledgeDomain`, `dispatchDesignLab`), background jobs (`startBackgroundJob`), crew tasks (`dispatchCrewTask`, the FirstMate fallback), and LIVE `task_plan` → `AgentTask`. | `command/`, `runtime/background-jobs.ts`, `crew/crew.ts`, `runtime/live-task-intake.ts` |
| Corrections to running work | A Jev fast path inside the chat turn calls `sendDomainMessage` before Flyd replies. | `runtime/conversation-responder.ts` L1148–1172 |
| Staff status | `domain_work` and `crew` tools stay visible on ordinary `answer` turns. | `turn-plan.ts` L93–97; `assistant-tools.ts` L405–460 |
| Review of finished work | Backstage already: `commandTick` → `notifyRun` → executive decision step (a one-shot `quickQuery` "You are Flyd, George's chief of staff…"). Skipped entirely for `view`, `flyd` and `self-improvement` runs. | `command/scheduler.ts`; `intelligence/executive/firstmate-decision.ts` L114–131 |
| Telling George | Three separate composers, none of them Flyd's conversation runtime: the notice line from the decision step; `AnswerInterpreter` in the conversation window; and Flyd's chat model, only when George asks and Flyd calls `domain_work`. Finished domain runs never reach the morning brief. | `command/scheduler.ts` L74–111; `conversation-view/interpret.ts`; `runtime/session-briefing.ts` |
| Interruption budget, quiet hours, kill switch | Built in `ExecutiveCycle`, but **never instantiated outside tests**. Nothing in production enforces them. Only the monthly Claude spend cap (`lib/claude-spend.ts`) is live. | `intelligence/executive/executive-cycle.ts` |
| LIVE and mobile | No delegation tools. | `realtime-session.ts` L187–199; `runtime/mobile-capabilities.ts` |

So the split has two halves. One is moving management *out* of Flyd's turn: team choice, brief writing, correction routing, staff status. The other is moving delivery *into* Flyd: today Flyd doesn't know what was delivered to George or when, which is the opposite of attentive.

## Responsibilities after the split

| Flyd | Chief of Staff |
|---|---|
| Conversation, voice, memory, taste, George's profile | Intake: choose team(s), write the brief and done-when, open an objective |
| Quick personal tools (see Boundary) | Dispatch to all substrates: FirstMate, Librarian, Design Mate, background jobs, crew fallback |
| Hand off bigger work in one call, carrying George's exact words and what Flyd knows | Monitor, chase silent staff, recover failures |
| Pass George's corrections to the CoS in one call | Apply corrections to the right run; resolve which work George means |
| Answer "how's X going?" from CoS state | Executive review: accept, send back (existing caps), escalate |
| Decide **when and how** to tell George: surface, timing, attention budget, quiet hours | Chain steps (dependencies) and decide when an objective is done |
| Deliver every report in Flyd's voice, with personal context | Produce **one report per objective**: outcome, decision needed, blocker, or credential request |

### Boundary: what Flyd still does itself

Default. Each line is reversible.

- **Flyd keeps:** `web_search`, `read_url`, `recall`, `remember`, `reminders`, `calendar_events`, `schedule`, `todos`, `work_model`, `speaking_style`, `mac`, `flyd` (news, briefing), `consult_specialist` (the coach is a conversation aid, not delegated work), email/Drive/WhatsApp reads and drafts, and read-only code tools (`read_file`, `grep`, `list_files`, `git_log`) for answering questions.
- **Goes to the CoS:** `start_coding_task`, `start_knowledge_task`, `start_design_task`, `pass_on_question`, `background_task`, `domain_work`, `crew`, and code changes (`edit_file`, `write_file`, mutating `bash`). See Decisions needed, item 1.
- **Unchanged for now:** LIVE `task_plan` → `AgentTask`. See Decisions needed, item 2.

## Contracts

All CoS state lives under `~/.flyd/command/`, behind the Phase 1 mutation helper. Decisions and reports are events in the SQLite spine. There is no new store engine and no permanent model session.

### Objective (new, `~/.flyd/command/objectives/<id>.json`)

```ts
interface Objective {
  id: string;                     // obj-<ulid>
  revision: number;
  createdAt: string; updatedAt: string;
  origin: { surface: "chat" | "view" | "agenda"; sessionId?: string; turnId?: string };
  words: string;                  // George's exact words; never rewritten
  flydNotes: string;              // what Flyd knew and judged at handoff (project, people, taste, urgency)
  contextRefs: string[];          // turn/receipt/memory refs Flyd attached
  status: "intake" | "working" | "needs_george" | "done" | "failed" | "cancelled";
  runs: string[];                 // DomainRun / background job / crew task ids, in plan order
  after?: Record<string, string[]>; // runId -> runIds it waits for (Phase 6)
  reportIds: string[];
}
```

`DomainRequest` gains `objectiveId`. Every existing domain-run rule still applies: original words survive, compression is reversible, and authority narrows downward.

### Flyd → CoS tools (replacing the management tools in Flyd's tool set)

- `hand_off(words, notes, urgency?)` writes an `Objective` in `intake` and returns `{ objectiveId }` once it is durable. It **does not** wait for intake. Flyd's reply then says concretely what will happen ("I've set the research going; you'll get the comparison back"), within the chief-of-staff standard's no-placeholder rule.
- `tell_work(message, objectiveId?, kind?)` covers corrections, decisions, priority changes and cancels. The CoS resolves which objective and run the message is for. If it can't, it raises a `needs_george` report rather than guessing. This replaces the in-turn fast path at `conversation-responder.ts` L1148–1172.
- `work_status(objectiveId?)` is read-only: objectives, their stage, and retained results for follow-up questions (command PRD §9: "Flyd answers from the retained DomainResult"). This replaces `domain_work` and `crew` for Flyd.

### CoS → Flyd: Report (event kind `cos.report`)

```ts
interface CosReport {
  id: string; objectiveId: string;
  kind: "done" | "decision" | "blocked" | "credential" | "irreversible";
  outcome: string;               // L0: one line, outcome first
  detail: string;                // L1: what matters and why
  recommendation?: string; options?: string[];
  evidenceRefs: string[];        // L2: DomainResult, artefacts, screenshots
  urgency: "now" | "today" | "whenever";
}
```

The `kind` values are SOUL's "What reaches George" list. Anything else stays inside the CoS.

### Flyd delivery (new `runtime/delivery.ts`, owned by Flyd)

Flyd takes each report and decides:
- **Surface:** an in-window reply under the originating message, a notification, the next conversation turn, or the morning brief.
- **Timing:** using `ExecutiveCycle`'s attention budget, quiet hours, cooldown and kill switch, wired in for the first time.
- **Wording:** Flyd's voice and George's context, passed through the existing `chief-of-staff.ts` checks.

It writes one `flyd.delivered` event per report, so delivery is idempotent across restarts and surfaces. This replaces the three composers in the "Telling George" row above.

## Phases

Everything runs behind `FLYD_COS=1` until Phase 5. With the flag off, today's behaviour is untouched. Each phase ends in an exit test. If one cannot be written against the code in a few days, stop and record why.

### Phase 0 — Baseline and the means to compare

**Why first:** the goal is attentiveness, and nothing measures it yet. The chat evals can't swap tools or prompt, and they have no vent or think cases.

**Work**
- `evals/chat/run.ts`: add `--tools <profile>` and `--soul <path>` flags that pass through the responder's existing dependency injection (`conversation-responder.ts` L101–121). Profiles: `current` and `split`.
- Add about 12 companion cases to `cases.json`, all judged: vent (4), think-out-loud (4), decide-personal (2), and "how's my work going?" with seeded objectives (2).
- Add a judge rubric for attentiveness: does it pick up what George actually meant, use relevant personal context without decorating, and keep machinery out of sight.
- Record a baseline on the pinned chat model: companion mean judge score, delegate-case pass rate, p50/p95 delegate-turn latency.

**Exit:** a baseline file committed under `docs/evals/` with the three numbers, reproducible with one command.

### Phase 1 — Safe foundations (v6 Phases A and B)

**Work**
- Restart and duplicate tests through `commandTick` for design, Librarian and `view`-sourced runs (fixtures as in v6 Phase A).
- Add `revision` to `DomainRun`. Every write goes through one mutation helper in `command/store.ts`: per-run exclusive lock file with a stale timeout, read current, apply the change as a function, bump revision, then temp + rename. `sendRunMessage` uses it for both writes. The same helper serves `Objective`.
- Dispatch replays by request id for Librarian and Design Mate, matching FirstMate's `fm-inbox.sh note --request-id`.
- Silent Postgres fallbacks (`runtime/cli-chat-kernel.ts`, `work-intelligence/repository-action-job.ts`) become a visible line in `flyd doctor` and the Core log.

**Exit:** a two-process test (Core scheduler and `flyd view`) loses no update; `grep saveDomainRun` shows only the helper; dispatch replay tests pass for all three teams.

### Phase 2 — CoS intake and dispatch

**Work**
- New module `cli/src/command/cos/` with `intake.ts`, `dispatch.ts` and `tick.ts`. `cos/tick.ts` is called from the existing `commandTick`, and `hand_off` kicks it immediately rather than waiting up to 15 s.
- `intake.ts`: one `quickQuery` (JSON) over `words`, `flydNotes`, the referenced recent turns, USER.md and the work model. It returns team(s), brief, done-when and project. It reuses the routing knowledge in `turn-plan.ts` (Jev `domain` hint when available) instead of writing a second router.
- `dispatch.ts`: adapters to the existing entry points, with no behaviour change inside them: `dispatchCodingDomain` (FirstMate) with crew fallback, `dispatchKnowledgeDomain`, `dispatchDesignLab`, and `startBackgroundJob` for the life domain. `refuseLeakedLaunch` (`assistant-tools.ts` L175–180) runs here.
- An intake that fails or is refused becomes a `blocked` report. It never fails silently.
- With `FLYD_COS=1`, a `delegate` route shows Flyd only `hand_off`.

**Exit**
- Restart during intake resumes, and exactly one run is dispatched.
- Each team's delegate eval cases pass under `--tools split`.
- Brief-quality check: a judge comparing CoS briefs against today's chat-written briefs on the same 10 delegations finds them no worse on a majority.
- p50 delegate-turn latency is no worse than baseline.

### Phase 3 — Reports and Flyd delivery

**Work**
- The CoS turns each executive decision (the existing `decideRun` → `processFirstmateChange`) into a `cos.report` instead of a notice. Within an objective, intermediate runs settle silently; the CoS reports once, when the objective is done or needs George. That ends the `view`/`flyd` bypass for objectives.
- `runtime/delivery.ts` as specified above. Wire `ExecutiveCycle` budgets for real, with the defaults already in the code: 3 interruptions a day, 45-minute cooldown. `irreversible` and `credential` reports are never deferred by budget.
- The conversation window shows the report under the originating message via the existing desk, replacing the `AnswerInterpreter` pass for objective-backed exchanges. Delivered reports join Flyd's context for the next turn, so it can say "the research came back; here's what matters".
- Undelivered `whenever` reports go into the morning brief.

**Exit**
- One report produces exactly one delivery across window, notification and brief, including after a restart between report and delivery.
- A `whenever` report raised during quiet hours waits; an `irreversible` one does not.
- The next chat turn after a delivery can answer "what did it say?" without a tool call.

### Phase 4 — Steering and status move to the CoS

**Work**
- Replace the in-turn fast path with `tell_work`. The CoS resolves the target objective and run (Jev `domain` and `commandKind` as hints, then the active-objective list), delivers through `sendRunMessage`, and raises `needs_george` only when two or more objectives genuinely match.
- `work_status` replaces `domain_work` and `crew` in Flyd's tool set. `crew land` and `discard` stay George-approved, via a CoS `decision` report.
- Remove management tools from Flyd's `answer` and `act` routes under `FLYD_COS=1`.

**Exit**
- Correction cases: delivered to the right run; ambiguous cases raise exactly one question; unrelated messages are not forwarded.
- A follow-up question answered from retained results makes no new dispatch.

### Phase 5 — Flyd's identity and the cutover

**Work**
- Rewrite the default voice in `lib/soul.ts` and `SOUL.md`: Flyd is George's personal intelligence and companion. Work he hands over goes to the Chief of Staff, and Flyd tells him what matters when it comes back. Keep the prime directives and the "What reaches George" list, which now describe report kinds.
- George's private `~/.flyd/SOUL.md` is his. Flyd never edits it; Phase 5 ships a suggested diff for him to apply or reject.
- Amend the command PRD: §1 (the CoS sits between Flyd and the domain bosses), §6 (routing happens at CoS intake; Flyd's route is just "hand off"), §12 (the cross-domain command graph is owned by the CoS). Update the AGENTS.md command-hierarchy guardrail to match.
- The companion prompt loses management instructions (`conversation-responder.ts` L366 "work like a brilliant chief of staff…" moves to CoS intake).
- Make `FLYD_COS=1` the default; keep `FLYD_COS=0` as a kill switch for two weeks, then delete the old paths.

**Exit:** a Phase 0 rerun under `split` with the new SOUL shows:
- companion mean judge score up by at least 0.5;
- delegate cases at or above baseline;
- p50 delegate-turn latency at or below baseline;
- zero backstage-name leaks in judged output.

If companion quality doesn't improve, ship the split for its correctness gains, but record that attentiveness didn't move and look elsewhere for it.

### Phase 6 — Chains owned by the CoS (v6 Phase C)

**Work**
- Intake may plan an ordered set of runs for one objective. The CoS pre-creates them all, then releases each by reconciliation: a run that is `queued`, has every dependency `completed` and has no receipt is dispatched with its own id as the request id. Audit events are written after the receipt and are never read as a gate.
- A dependency that failed or was cancelled sends the objective to a `decision` report. Nothing retries on its own.

**Exit:** crash injected after the parent completes, after dispatch, and after the receipt: each time, the child dispatches exactly once and George receives one delivery. Then dogfood three real two-step objectives.

## Measures

| Measure | Source | Target |
|---|---|---|
| Companion quality | Phase 0 judged cases | +0.5 mean by Phase 5 |
| Supervision per objective | George's own messages (`DomainMessage` without `from: "flyd"`) on an objective's runs between handoff and delivery | Trending to 0 |
| Accepted without rework | Delivered `done` reports with no follow-up fix run | Majority after Phase 6 dogfood |
| Interruptions | `flyd.delivered` notifications per day | ≤ budget (3) except `irreversible`/`credential` |
| Missed or duplicate deliveries | `cos.report` without exactly one `flyd.delivered` | 0 |
| Delegate-turn latency | Eval runner p50/p95 | ≤ baseline |

## Risks

- **Context loss at handoff.** Today the model that writes the brief has the whole conversation in view; the CoS gets what Flyd hands it. Mitigation: exact words always travel; `flydNotes` and turn refs give intake the conversation; the Phase 2 brief-quality gate checks it.
- **A second persona drifting.** The CoS's prompts are backstage and never reach George unfiltered: every report passes through Flyd's delivery and the existing checks.
- **Naming collision.** `council/chief-of-staff.ts` is the output standard, not this CoS. Rename it to `council/standard.ts` in Phase 2 to keep agents from confusing the two.
- **Scope.** Six phases is a lot. Each is shippable behind the flag, and Phase 0's numbers can stop the work early if the split doesn't help.

## Non-goals

- No new coordination engine, workflow engine or budget system; `ExecutiveCycle` is wired, not rebuilt.
- No permanent CoS model session; it runs on ticks and events.
- No new approval gates (AGENTS.md).
- The CoS never speaks to George directly, and no surface for it is added.
- No change to LIVE or mobile capability ceilings.

## Decisions needed from George

1. **Code edits in chat.** The default moves `edit_file`, `write_file` and mutating `bash` from Flyd to the CoS (coding team), leaving Flyd read-only on code. That makes even a one-line fix a handoff. Keep the default, or let Flyd make small single-file edits itself?
2. **LIVE tasks.** LIVE `task_plan` creates an `AgentTask` outside the command layer. Leave it (default), or route LIVE work through `hand_off` in a later phase?
3. **Interruption budget.** Wiring `ExecutiveCycle` means a real cap of 3 interruptions a day, plus quiet hours, for the first time. Are those the numbers, and what are your quiet hours?

## Corrections to v6

- v6 listed the interruption budget, quiet hours and cooldown as existing budgets. They are built but not wired; only the monthly spend cap is enforced.
- v6 was built to add dependencies between runs. George's goal is the Flyd/CoS split; dependencies are now Phase 6 of that.
