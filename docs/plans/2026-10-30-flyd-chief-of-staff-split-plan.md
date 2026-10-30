# Flyd and the Chief of Staff — Split Plan

Status: Proposed. No implementation claimed.
Date: 2026-10-30
Supersedes: `2026-10-30-chief-of-staff-orchestration-v6.md` (its Phases A–C are absorbed below as Phases 2 and 6) and `-v5.md`.
Authority: `docs/product/flyd-personal-intelligence-prd.md` wins on conflict. Amends `docs/product/flyd-command-architecture-prd.md` §1, §6 and §12 (see Phase 5).

## Goal

Give Flyd a Chief of Staff that runs all delegated work, so Flyd can be an attentive personal assistant instead of a manager.

- **Flyd** listens, knows George, does quick personal things itself, hands anything bigger to the Chief of Staff in one step, and tells George what came back, at a moment and in a way that suits him.
- **The Chief of Staff (CoS)** owns everything after the handoff: choosing the team, writing the brief, dispatching, chasing, reviewing and sending work back, applying George's corrections, chaining steps, deciding when work is done, and handing Flyd one report per piece of work.

One voice still holds: George only ever talks to Flyd. The CoS never speaks to him directly.

**Delivery comes first.** George's main complaint today is how finished work reaches him: too many words, unclear, and prose where a picture, a decision card or a document would do. Delivery is Phase 1. It ships on today's work, before any CoS plumbing, and is held to the Delivery standard below.

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
| Shape of delivered work | The window leads with an interpreted prose summary of a staff reply, staff words behind "more" (`conversation-view/server.ts` L380–393). Steps/options can be extracted from reply text (`summaries.ts` `replyArtefact`), and Flyd's own window answers can be reshaped into diagnosis/comparison (`commands/view.ts` L84–87). Nothing chooses a picture, decision card, comparison or document for finished delegated work, and notifications are text lines. | `conversation-view/`, `runtime/agenda.ts` |
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

All CoS state lives under `~/.flyd/command/`, behind the Phase 2 mutation helper. Decisions and reports are events in the SQLite spine. There is no new store engine and no permanent model session.

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
  shape: "words" | "picture" | "decision" | "comparison" | "diagnosis" | "steps" | "document" | "landed";
  artefacts: string[];           // refs to screenshots, lab pages, dossiers, diffs the shape needs
  urgency: "now" | "today" | "whenever";
}
```

Whoever writes the report proposes `shape` from the Delivery standard table (the Phase 1 adapter today, the CoS later). Flyd's delivery re-checks it with the same rules and may only fall back to `words` when an artefact the shape needs is missing.

The `kind` values are SOUL's "What reaches George" list. Anything else stays inside the CoS.

## Delivery standard (Flyd owns it)

Every delivery has the same shape:

1. **Lead line.** One sentence, at most 120 characters, outcome first: "The pricing comparison is done: Stripe is cheapest at your volume." No preamble, no restating the request, no narrating what the staff did, no staff names, ids, paths or branches. This is the existing `for-george.ts` rule (`LINE_CHARS = 120`) and the chief-of-staff standard, now applied to every delivery.
2. **At most two more lines**, only when they change what George does next.
3. **One artefact whenever the result has a shape.** For structured results, words are the fallback, not the default.

Choosing the artefact, deterministic rules first, in this order:

| The result is… | Delivered as | Built from |
|---|---|---|
| Visual work: a design lab, a build, a UI change | Picture card: the pick large, alternatives as thumbnails, one line on why | Design Mate lab shots, `reply-shots.ts`, `cards.ts` |
| A choice only George can make | Decision card: the question, options as buttons, the recommendation marked | decision cards (`choices.ts`; answers via `commands/view.ts` `resolveDecision`) |
| Alternatives weighed on criteria | Comparison form | `ManifestationPlan` `comparison` (`semantic.ts`, `answer-form.ts`) |
| A failure, or why something happened | Diagnosis form: expected / observed / cause / evidence / next | `ManifestationPlan` `diagnosis` |
| Steps, or a list of more than 3 items | Steps/options artefact | `replyArtefact` (`summaries.ts` L225) |
| A report longer than the lead plus two lines (`MAX_CHARS` = 360) | Document page: summary on top, evidence and sources below | Compose dossier surface (`evidence/compose-surface.ts`) |
| Code landed | One line plus a link to the change | landed-line rule in `for-george.ts` |
| Anything that fits in the lead plus two lines | Words only | — |

Only when no rule decides does delivery ask the existing presentation predicates (`reply_artefact_kind`, `answerForm`). Unsure means words.

Per surface:

- **Notification:** the lead line only. Tapping it opens the conversation window on the artefact. A notification never carries the body.
- **Conversation window:** the lead line under George's original message, with the artefact in place. The full report and the staff's own words stay behind "more".
- **Next chat turn and morning brief:** the lead line plus a link to the artefact.

Delivery also decides **when**, using `ExecutiveCycle`'s attention budget, quiet hours, cooldown and kill switch, wired in for the first time. `irreversible` and `credential` reports are never deferred. Each report gets exactly one `flyd.delivered` event, so delivery is idempotent across restarts and surfaces, and every delivered report joins Flyd's context for the next turn.

## Phases

Everything after Phase 1 runs behind `FLYD_COS=1` until Phase 5. With the flag off, behaviour is today's plus Phase 1's delivery. Each phase ends in an exit test. If one cannot be written against the code in a few days, stop and record why.

### Phase 0 — Baseline and the means to compare

**Why first:** nothing measures delivery or attentiveness yet. The chat evals can't swap tools or prompt, and they have no vent, think-out-loud or delivery cases.

**Work**
- `evals/chat/run.ts`: add `--tools <profile>` and `--soul <path>` flags that pass through the responder's existing dependency injection (`conversation-responder.ts` L101–121). Profiles: `current` and `split`.
- Add about 12 companion cases to `cases.json`, all judged: vent (4), think-out-loud (4), decide-personal (2), and "how's my work going?" with seeded objectives (2).
- Add a judge rubric for attentiveness: does it pick up what George actually meant, use relevant personal context without decorating, and keep machinery out of sight.
- Delivery cases: about 15 fixtures of finished work, built from real `DomainResult` shapes: a design lab with three versions and a pick, a long research report, code landed, a decision with three options, a failure, a comparison, a seven-item status. Each case asserts the shape the Delivery standard table requires, a lead line of at most 120 characters, visible text no longer than the lead plus two lines, no staff names, and a judged clarity score.
- **Real examples:** George supplies 5–10 recent deliveries he found poor (screenshots or pasted text). Each becomes a case. They are the real test; the fixtures only cover the rules.
- Record a baseline on the pinned chat model: delivery pass rate, companion mean judge score, delegate-case pass rate, p50/p95 delegate-turn latency.

**Exit:** a baseline file committed under `docs/evals/` with the four numbers, reproducible with one command.

### Phase 1 — Delivery, on today's work

Ships first: it is George's main complaint, and it doesn't need the CoS.

**Work**
- `runtime/delivery.ts` with one entry point, `deliver(report)`, used by all three of today's paths: `notifyRun`'s notice (`command/scheduler.ts`), the conversation window's lead for a staff reply (`conversation-view/server.ts` `interpret`, replacing the `AnswerInterpreter` prose), and the next-turn context.
- An adapter `reportFromRun(run, decision?)` turns a finished `DomainRun`, plus its executive decision when there is one, into a `CosReport`. It picks `shape` from the Delivery standard table using `DomainResult.artifacts`, `specialistOutputs`, lab files and length. It works without a decision, so `view`-sourced runs, which skip executive review today, still get a properly shaped delivery.
- Renderers for each shape, reusing what exists (cards, decision cards, manifestation forms, `replyArtefact`, Compose dossier). The one gap is the picture card for a finished lab or build, which needs a layout that shows the pick large with alternatives as thumbnails.
- Notifications carry the lead line only and open the window on the artefact.
- Wire `ExecutiveCycle` (budget 3 a day, 45-minute cooldown, quiet hours, kill switch); `irreversible` and `credential` are never deferred. Undelivered `whenever` reports go into the morning brief.
- One `flyd.delivered` event per report; delivered reports join Flyd's next-turn context.

**Exit**
- Delivery cases pass at 90% or better, every real-example case passes, and judged clarity averages 8 or higher.
- One report produces exactly one delivery across window, notification and brief, including after a restart between report and delivery.
- A `whenever` report raised during quiet hours waits; an `irreversible` one does not.
- The next chat turn can answer "what did it say?" without a tool call.

### Phase 2 — Safe foundations (v6 Phases A and B)

**Work**
- Restart and duplicate tests through `commandTick` for design, Librarian and `view`-sourced runs (fixtures as in v6 Phase A).
- Add `revision` to `DomainRun`. Every write goes through one mutation helper in `command/store.ts`: per-run exclusive lock file with a stale timeout, read current, apply the change as a function, bump revision, then temp + rename. `sendRunMessage` uses it for both writes. The same helper serves `Objective`.
- Dispatch replays by request id for Librarian and Design Mate, matching FirstMate's `fm-inbox.sh note --request-id`.
- Silent Postgres fallbacks (`runtime/cli-chat-kernel.ts`, `work-intelligence/repository-action-job.ts`) become a visible line in `flyd doctor` and the Core log.

**Exit:** a two-process test (Core scheduler and `flyd view`) loses no update; `grep saveDomainRun` shows only the helper; dispatch replay tests pass for all three teams.

### Phase 3 — CoS intake, dispatch and native reports

**Work**
- New module `cli/src/command/cos/` with `intake.ts`, `dispatch.ts` and `tick.ts`. `cos/tick.ts` is called from the existing `commandTick`, and `hand_off` kicks it immediately rather than waiting up to 15 s.
- `intake.ts`: one `quickQuery` (JSON) over `words`, `flydNotes`, the referenced recent turns, USER.md and the work model. It returns team(s), brief, done-when and project. It reuses the routing knowledge in `turn-plan.ts` (Jev `domain` hint when available) instead of writing a second router.
- `dispatch.ts`: adapters to the existing entry points, with no behaviour change inside them: `dispatchCodingDomain` (FirstMate) with crew fallback, `dispatchKnowledgeDomain`, `dispatchDesignLab`, and `startBackgroundJob` for the life domain. `refuseLeakedLaunch` (`assistant-tools.ts` L175–180) runs here.
- An intake that fails or is refused becomes a `blocked` report. It never fails silently.
- With `FLYD_COS=1`, a `delegate` route shows Flyd only `hand_off`.
- The CoS writes `cos.report` itself, once per objective, replacing the Phase 1 adapter for objective-backed work. Intermediate runs settle silently; the `view`/`flyd` review bypass ends for objectives.

**Exit**
- Restart during intake resumes, and exactly one run is dispatched.
- Each team's delegate eval cases pass under `--tools split`.
- Brief-quality check: a judge comparing CoS briefs against today's chat-written briefs on the same 10 delegations finds them no worse on a majority.
- p50 delegate-turn latency is no worse than baseline.
- Phase 1 delivery cases still pass with CoS-written reports.

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
| Delivery shape | Delivery and real-example cases | ≥ 90% fixtures, 100% real examples, from Phase 1 |
| Delivery length | Visible characters before "more" | ≤ lead + 2 lines (360) on every delivery |
| Companion quality | Phase 0 judged cases | +0.5 mean by Phase 5 |
| Supervision per objective | George's own messages (`DomainMessage` without `from: "flyd"`) on an objective's runs between handoff and delivery | Trending to 0 |
| Accepted without rework | Delivered `done` reports with no follow-up fix run | Majority after Phase 6 dogfood |
| Interruptions | `flyd.delivered` notifications per day | ≤ budget (3) except `irreversible`/`credential` |
| Missed or duplicate deliveries | `cos.report` without exactly one `flyd.delivered` | 0 |
| Delegate-turn latency | Eval runner p50/p95 | ≤ baseline |

## Risks

- **Context loss at handoff.** Today the model that writes the brief has the whole conversation in view; the CoS gets what Flyd hands it. Mitigation: exact words always travel; `flydNotes` and turn refs give intake the conversation; the Phase 3 brief-quality gate checks it.
- **A second persona drifting.** The CoS's prompts are backstage and never reach George unfiltered: every report passes through Flyd's delivery and the existing checks.
- **Naming collision.** `council/chief-of-staff.ts` is the output standard, not this CoS. Rename it to `council/standard.ts` in Phase 3 to keep agents from confusing the two.
- **Scope.** Seven phases is a lot. Phase 1 fixes the main complaint on its own; later phases are shippable behind the flag, and Phase 0's numbers can stop the work early if the split doesn't help.

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

4. **Your worst deliveries.** Send 5–10 recent deliveries that annoyed you (screenshots or paste). They become the Phase 0 test cases and decide whether Phase 1 actually fixed it.

## Corrections to v6

- v6 listed the interruption budget, quiet hours and cooldown as existing budgets. They are built but not wired; only the monthly spend cap is enforced.
- v6 was built to add dependencies between runs. George's goal is the Flyd/CoS split; dependencies are now Phase 6 of that.
