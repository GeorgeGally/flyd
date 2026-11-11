# Flyd Command Architecture PRD

**Status:** Active product/architecture authority  
**Date:** 9 October 2026  
**Scope:** Cross-domain command, domain bosses, specialist delegation, lossless handoffs, routing, escalation, self-improvement  
**Builds on:** `docs/product/flyd-operational-architecture-prd.md`

## 1. Objective

Flyd is George's personal intelligence and companion, and the only voice he hears. Delegated work runs through a Chief of Staff (CoS) that sits between Flyd and the domain bosses (split plan, `docs/plans/2026-10-30-flyd-chief-of-staff-split-plan.md`).

George talks to Flyd. Flyd hands bigger work over in one step (`hand_off`, with his exact words and what Flyd knows). The CoS owns everything after that:

- choosing the team;
- writing the brief;
- dispatching, chasing and reviewing the work;
- applying his corrections;
- deciding when the work is done;
- handing Flyd one report per objective.

Flyd decides when and how George hears it and keeps him at the highest useful altitude.

```text
George
  ↕
Flyd                 companion: conversation, memory, quick personal tools, delivery
  ↕
Chief of Staff       intake, dispatch, review, steering, one report per objective
  ├── FirstMate      coding boss
  ├── Librarian      knowledge boss
  ├── Design Mate    creative boss (with the Creative Director)
  └── Life/Ops       background jobs
        ↓
     specialists
```

While the cutover is pending, the CoS runs behind `FLYD_COS=1`. With it off, Flyd hands work to each domain itself through the `start_*` tools, as before.

Domain bosses are managers, not default workers. Specialists execute bounded work.

## 2. Core rules

1. **One voice.** George talks to Flyd. Domain bosses and specialists remain backstage unless George explicitly opens their surface.
2. **Managers own outcomes.** A domain boss accepts a request, identifies project/context, decomposes, delegates, supervises, verifies, resolves routine questions, and escalates only real decisions.
3. **Specialists execute.** They do not manage George or cross-domain priorities.
4. **Original words survive.** Flyd interpretation is additive. It never replaces George's original instruction in the authority chain.
5. **Compression is reversible.** A short brief never destroys the detailed report, specialist findings, evidence, artifacts, or raw reply.
6. **Authority narrows downward.** George → Flyd → domain boss → specialist.
7. **Truth remains owned once.** FirstMate owns coding execution state; Flyd owns cross-domain command state. Flyd does not duplicate worker internals.
8. **Learning is governed.** Routing/handoff failures feed Flyd's existing self-improvement system; they do not create a second autonomous policy learner.

## 3. Relationship to self-improvement

The October 2026 self-improvement work changes this architecture in four important ways.

### 3.1 No new routing-learning store

Flyd already has an evidence-backed improvement loop in `cli/src/crew/self-improve.ts`. Domain failures, misroutes and information-loss incidents become evidence for that loop.

The improver still prefers durable fixes in this order:

```text
check > tool > context > state > trace > prompt
```

A recurring management failure should therefore fix the Jev predicate, transport, validator, store, or state model before adding another prompt rule.

### 3.2 Repetition is evidence, not authority

The voice rule-of-three work established the correct precedent: repeated observations can strengthen evidence, but repetition alone must not mutate behaviour when the classification is ambiguous or consequential.

For command routing this means:

- repeated misroutes are stronger evidence;
- repeated lost-detail incidents are stronger evidence;
- repeated unnecessary escalations are stronger evidence;
- the self-improver still chooses and tests the fix;
- George still gates self-modifying code changes.

### 3.3 Jev belongs at the fast decision boundary

Jev already selects chat turn shape and skills through the canonical System-1 predicate registry. Domain ownership is another predicate in that same registry, not a separate classifier.

Jev answers the cheap question:

> which domain should own this turn?

Flyd remains responsible for meaning, policy, authority and cross-domain judgment.

### 3.4 Self-improvement uses the same chain of command

A self-improvement that requires code is coding-domain work. When FirstMate is present, Flyd sends the improvement to FirstMate rather than silently bypassing the coding boss.

## 4. Shared command objects

### DomainRequest

```ts
interface DomainRequest {
  id: string
  domain: "coding" | "knowledge" | "creative" | "life"
  originalMessage: string
  intendedOutcome: string
  doneWhen: string[]
  createdAt: string
  source?: "chat" | "self-improvement" | "system"
  project?: { name?: string; root?: string }
  contextRefs?: string[]
  parentRequestId?: string
}
```

The original message is authority-bearing and must be preserved verbatim. Flyd's interpretation and acceptance criteria are additive.

### DomainRun

Flyd persists only the organizational state it owns:

```text
queued
accepted
working
needs_decision
completed
failed
cancelled
```

It records the owner and transport correlation, not every worker heartbeat inside the domain boss.

Core's scheduler and `flyd view` write runs at once, so every write goes through one helper in `cli/src/command/store.ts`. `mutateDomainRun` takes the run's own lock file (a lock left by a dead process is taken over after 10 seconds), reads the run as it is now, applies the change, bumps `revision` and replaces the file (temp + rename). `createDomainRun` records a new run, or returns the one already on record. `updateDomainRun` changes a run on record. `commitDomainRun` saves a run edited from an earlier read by applying only the fields it changed; messages merge by id. As a result, no process's update is lost to another's. `saveDomainRun` (a whole replace) is kept for fixtures.

Dispatch is idempotent by request id for every team. FirstMate replays through its inbox (`fm-inbox.sh note --request-id`). Librarian (`dispatchKnowledgeDomain`) and Design Mate (`dispatchDesignMate`) take an optional `requestId`. Dispatching an id already on record returns that run and starts no second set of specialists or lab.

### DomainResult

```text
L0 brief
L1 recommendation + detailed report
L2 specialist outputs
L3 evidence / artifacts / raw result
```

The stored object carries all levels together.

A domain boss that returns only prose is not rejected. Flyd preserves the full raw reply and marks the result as an unstructured/high-information-loss-risk handoff so the system can improve without losing the work.

## 5. Coding domain: FirstMate

FirstMate is the coding boss.

Flyd must use FirstMate's supported durable machine boundary rather than scraping its chat:

```text
fm-inbox.sh ready
fm-inbox.sh note --request-id <domain-run-id> --json -
fm-inbox.sh receipts ...
fm-inbox.sh reply <note-id> ...
```

The request id is Flyd's DomainRun id, giving idempotent restart-safe correlation.

One channel: `FirstmateDomainTransport` (`cli/src/command/firstmate.ts`) is the only code that runs `fm-inbox.sh` (a test enforces it). Every note is a DomainRun or a message on one: chat and desk requests (`submit`), George's corrections and Flyd's chases on a run (`sendMessage`, the run is the parent), a reply he writes under an earlier desk message (a child run with `parentRequestId`), and Flyd's own notes that belong to no run of his — worker check-ins, closes of overtaken calls, task notes, his answer to a decision whose run is gone (`sendFlydNote`: a `flyd-…` run with `source: "flyd"`, George's words as the original message when it carries any, done_when and the return contract; never announced, never chased as a handoff, never a target for his live corrections). A run's answer is FirstMate's formal reply on any of its notes; the window falls back to FirstMate's own chat only after the receipt shows the note was taken up, and never gives one run's words to another.

Before any request is created, `dispatchCodingDomain` (`cli/src/command/coding.ts`) refuses a run whose project root does not exist or that comes from a test process (`VITEST`/`JEST_WORKER_ID`). A refusal creates no DomainRun and sends no note; it is appended to `refusals.jsonl` in the command dir and returned to the caller, which reports it instead of claiming a handoff.

Flyd does not depend on a session being open for a note to be read. When an inbox note has gone unread, Flyd starts a FirstMate session itself (FirstMate's `bin/fm-session-start.sh`) on Claude (`FLYD_FIRSTMATE_RUNTIMES`, default `claude`; `opencode` may be added, and `codex` is never used because Codex is kept for images only). When Claude is unavailable or hits a usage limit, Flyd waits and retries with backoff rather than falling back to another runtime. Each launch request (a DomainRun, or the unread runless notes) stops after 3 identical launch failures: the DomainRun fails terminally with the attempt count, and runless notes wait for the 30-minute relaunch cap before trying again (`cli/src/command/firstmate.ts`, `cli/src/runtime/repeat-guard.ts`). The session child's environment is stripped of the paid Anthropic API variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`), so the claude CLI runs on the Claude plan rather than the paid API.

This covers every unread inbox note, including notes from the conversation view that belong to no DomainRun. A note unread for over 3 minutes is recorded backstage for the council self-review, and so is a relaunch for a runless note that has backed off to its 30-minute cap. Flyd remembers the helper sessions it launched (`firstmate-helpers.json` in the command dir). When one of them holds FirstMate's fleet lock but has written no output for 15 minutes while a note waits, Flyd stops that session's process group and launches a fresh one. Flyd never stops a session it did not launch.

FirstMate remains authoritative for:

- project choice within its registered fleet;
- worker dispatch;
- worktrees;
- worker supervision;
- coding verification;
- PR/local delivery state;
- coding-level escalation.

Flyd remains authoritative for:

- George's original intent;
- cross-domain priority;
- whether another domain must participate;
- whether a coding decision can be resolved from George's known policy;
- what reaches George;
- retention of the returned layered report.

The FirstMate fleet ledger may later enrich Present/status, but it is not the request/result authority. Durable inbox replies are the canonical handoff result. A reply written as `key: value` lines (`status: completed`, `brief: …`) is read as the structured reply, and a URL, PR or commit it names counts as its evidence. A reply in plain prose is a valid outcome: Flyd's model reads its status (completed, needs decision, failed, still working), and only that reading or a structured reply settles a run. The word-only fallback never decides: prose no model could read keeps the run open and unannounced while Flyd asks the staff once for a one-line JSON status (no second ask until a reply has been read), and the missing layers are noted on the run rather than holding finished work open.

Flyd also watches its coding staff from Core (`cli/src/command/fleet-monitor.ts`, once a minute on the agenda scheduler, `FLYD_STAFF_MONITOR=0` off), read-only: `fm-inbox.sh ready`, `state/home-summary.json` and each worker's status log, beside Flyd's own runs. A handoff with no word back for 2 h, or a worker waiting on a decision, failed or gone quiet for 30 min, gets a note to FirstMate asking where it stands, and another every 6 h it stays unanswered (a note the inbox would not take is tried on the next pass). Staff silence never reaches George (`cli/src/lib/reaches-george.ts`); he is told only when nobody has held FirstMate's lock for 30 min while work is open, and a chase that keeps going unanswered is never given up on. This watch is the only chaser: one open chase per run (none while a note about it sits unread, none when the receipts cannot be read). Notes he sent that FirstMate has not read yet are marked in the window (`cli/src/conversation-view/note-receipts.ts`) and handled by the session launch above, never by a second chase, and never announced to him. A failed domain run goes back to its boss once before George hears it is blocked. The last read is kept in `~/.flyd/command/staff.json`: chat reads it through `domain_work action=staff`, and the conversation view says over the message box only what George has been told and the gate lets reach him. The view and the island follow the session that holds FirstMate's lock (lock pid → `~/.claude/sessions/<pid>.json`), falling back to the newest-written transcript.

## 6. Routing

The chat harness decides turn shape first:

```text
answer | clarify | act | delegate
```

Jev also returns a domain ownership hint:

```text
coding | knowledge | creative | life | general
```

Routing to a team happens at CoS intake (`command/cos/intake.ts`), using the same team guide (`TEAMS` in `runtime/turn-plan.ts`). Flyd's own route for delegated work is just "hand off": with `FLYD_COS=1`, a delegate turn shows only `hand_off`. With the flag off, a confidently delegated turn shows only its domain's handoff, for example the coding handoff for coding. This prevents the model from choosing a generic background job when FirstMate should own the work.

Other domain bosses are introduced only after their manager contract exists.

## 7. Corrections during active work

A later slice should route corrections as first-class commands:

```text
George correction
  ↓
Jev: correction + domain + active run
  ├─ immediate verbatim delivery to domain boss
  └─ parallel Flyd interpretation / learning
```

The domain boss receives George's exact words. Flyd separately decides whether the correction is task-local, project-local, domain policy, or a durable personal preference.

Personal correction evidence must not be copied into external domain logs solely for learning. Source scope and erasure boundaries from the voice-learning architecture still apply.

## 8. Domain boss return contract

A mature domain boss should return:

```json
{
  "status": "completed | needs_decision | failed",
  "brief": "...",
  "recommendation": {
    "action": "...",
    "reasoning": "...",
    "confidence": 0.9
  },
  "detailed_report": "...",
  "decisions_made": [],
  "unresolved_questions": [],
  "risks": [],
  "evidence": [],
  "artifacts": [],
  "specialist_outputs": [],
  "information_loss_risk": "low | medium | high"
}
```

Flyd persists the original raw reply alongside the parsed structure.

## 9. Upward presentation

Flyd chooses how much to show, but does not manufacture a replacement truth.

Routine result:
- L0.

Interesting result:
- L0 plus relevant L1.

Consequential decision:
- L0 plus substantial L1 and evidence pointers.

George can always ask:

- "What exactly did they find?"
- "Show me the evidence."
- "What did the specialist say?"
- "Why are you recommending that?"

Flyd answers from the retained DomainResult instead of re-running the work.

## 10. Escalation

```text
specialist → domain boss
  insufficient context
  conflicting requirements
  verification failure
  task-local decision

domain boss → Flyd
  cross-domain conflict
  strategic change
  authority exceeded
  persistent failure
  meaningful risk
  user preference required

Flyd → George
  high-impact decision
  irreversible consequence
  unknown preference
  strategy choice
  meaningful financial/external commitment
```

The purpose of each layer is to organize complexity for the layer above it without destroying detail.

## 11. First implementation slice

Implemented first because it proves the architecture with a real domain boss:

1. shared DomainRequest/DomainRun/DomainResult contracts;
2. persistent Flyd command store;
3. FirstMate machine transport using idempotent inbox requests and durable replies;
4. original-message preservation;
5. layered/raw result retention;
6. coding handoff through FirstMate when installed;
7. compatibility fallback to the old internal crew only when FirstMate is not installed;
8. installed-but-unhealthy FirstMate is surfaced rather than silently bypassed;
9. Jev domain predicate in the canonical System-1 registry;
10. five-minute backstage result reconciliation;
11. domain-work inspection tool for lossless follow-up;
12. domain failures/unstructured returns feed the existing self-improvement evidence loop;
13. Flyd self-improvement routes through FirstMate when available.

## 12. Implementation state and next slices

### Knowledge boss — initial slice implemented

Librarian now acts as an interactive domain boss for substantial knowledge work. Its first manager pipeline is:

```text
Retriever ─┐
           ├─→ Fact Checker → Librarian synthesis → layered DomainResult
Researcher ┘
```

Retriever and Researcher run in parallel through the existing durable background-job runtime without speaking to George directly. Fact Checker receives their reports as claims to verify independently. Librarian wakes only after specialist completion, reconciles the work, and stores both its synthesis and the raw specialist outputs.

Documenter and Knowledge Curator remain future specialist roles. Librarian itself should continue to preserve management context rather than becoming the worker that browses every source.

### Live correction routing — implemented

Jev now classifies whether a turn is a correction, decision, priority change, question, cancellation or new request. When a correction/decision targets a domain with exactly one active run, Flyd forwards George's exact wording to that boss before composing its own answer.

For coding, the message is a durable idempotent FirstMate inbox request. For knowledge, it becomes a durable message on the Librarian DomainRun and is folded into later verification/synthesis. If multiple matching runs are active, Flyd refuses to guess.

### Boss interrogation — implemented

Flyd can inspect the retained L0/L1/L2/L3 result with `domain_work show` and create a linked follow-up with `domain_work ask`. The follow-up is a child DomainRun carrying the parent report/evidence, so questions such as "why did you reject option B?" do not require re-running unrelated work or throwing away prior reasoning.

### Cross-domain command graph

One George objective may create several DomainRuns with dependencies. The CoS owns this organizational DAG on the `Objective` (`runs`, `after`); Flyd sees only the objective's reports.

### Creative boss

Build after coding + knowledge demonstrate that the common protocol is stable.

### Life/Ops boss

Build only when there is enough recurring work to justify a manager rather than a skill bundle.

### Chief of Staff — intake, dispatch and reports (behind `FLYD_COS=1`)

This is split plan Phase 3 (`docs/plans/2026-10-30-flyd-chief-of-staff-split-plan.md`). It is off by default until Phase 5.

**Handoff.** With `FLYD_COS=1`, a `delegate` turn shows Flyd one tool, `hand_off(words, notes, urgency?)`. The call records an `Objective` in `~/.flyd/command/objectives/<id>.json`, kept with George's exact words and Flyd's notes. It returns once the record is durable, without waiting for intake. Objectives are written only through the command store's lock, and every write bumps the objective's `revision`.

**The CoS tick.** `command/cos/tick.ts` runs on every command tick, and `hand_off` also starts it at once.

- **Intake** (`cos/intake.ts`) is one JSON query over his words, Flyd's notes, USER.md and the work model. It uses the delegate route's own team guide (`TEAMS` in `runtime/turn-plan.ts`). It returns:
  - the team;
  - the outcome and done-when;
  - the project;
  - the brief's decisions field: the calls that come back to George, and those his known policy settles.
- **The decisions field** reaches each team in its brief: FirstMate's request body, the Creative Director's brief and the Librarian's synthesis. Every run records its `objectiveId`.
- **Dispatch** (`cos/dispatch.ts`) sends the brief through each team's existing entry point, with the objective's own request id (`<objective>-r1`):
  - coding goes to FirstMate, with the compatibility crew as fallback;
  - knowledge goes to the Librarian;
  - creative goes to Design Mate's lab;
  - life goes to a background job.

  `refuseLeakedLaunch` runs first. The brief is kept on the objective before dispatch, so a restart dispatches the same brief by the same id, and the team replays it rather than starting the work twice.
- **Refusals.** An intake or dispatch that fails or is refused becomes one `blocked` report ("I couldn't get … started"). It never fails silently.

**Reports.** A run that serves an objective is never told on its own: while `FLYD_COS=1` and the objective lists the run, or is dispatching it right now, `notifyRun` leaves it to the CoS. A life job started for an objective never delivers itself, even when resumed after a restart; its result becomes the objective's one `done` report, or a `decision` when it didn't finish. The compatibility crew still tells George itself; the objective only follows it. When the run settles, the CoS reviews it with the same executive review step. A send-back stays with its boss. Otherwise the CoS writes one `cos.report` event in the SQLite spine, and Flyd tells George through the shared delivery step (`tellRun` in `command/scheduler.ts`: lead line, focus timing, told once). The report kind follows the run's outcome:

- a needs-decision run gives a `decision` report, and the objective waits on George;
- a completed run gives a `done` report;
- a failed run gets one alternative (see chains, below); a second failure, a one-off job or a crew run gives a `decision` report.

### Chief of Staff — chains, joins and corrections (behind `FLYD_COS=1`)

This is v8 Phase 6 (`docs/plans/2026-11-08-flyd-orchestration-v8.md`). The plan lives on the objective (`plan`, `after`) and changes only through its lock; there is no new store and no graph engine (`command/cos/plan.ts`).

- **Plan.** Work that needs more than one team gets `runs` from intake: each run's team, outcome, done-when and the runs it waits on (`after`), inside the same objective. Intake plans only what it can brief now. A plan whose runs wait on a run it doesn't have, or on each other, is refused and becomes a `blocked` report. One-team work is one run.
- **Release.** Each tick dispatches a queued run when all its dependencies are completed and valid, it has no receipt, and fewer than `FLYD_COS_MAX_ACTIVE` (default 3) CoS runs are active across all objectives. A FirstMate run counts as one; a run handed to the compatibility crew holds no slot. Run `rN` goes out as `<objective>-rN`; a later attempt as `<objective>-rN-<attempt>`, so a re-run is never replayed as the old one.
- **Join.** A run that waits on several gets its brief from one query over their retained results: George's exact words go as the original message, the brief carries the synthesis, and it links each dependency's layered result. When that query can't be read, the dependencies' own results stand in, so a model outage never stalls the chain. The join may cancel queued runs the results make pointless and add runs after itself; each is recorded on the objective with its reason.
- **Uncertain dispatch.** A run is written `dispatching` before its team is called. A run a dead pass left there is reconciled by sending the same request id as a replay: FirstMate's inbox, the Librarian and Design Mate answer with the run they hold. A one-off job and the compatibility crew keep the request id on their own record, so a replay finds what they started. One that can't be found leaves the run `unknown`: it is never sent again on its own, each pass looks for it again, and after `UNCONFIRMED_MS` (15 min) George gets one decision: Send it again / Drop it. That call waits while another wait is open, and is asked again once that one is answered if the run is still unconfirmed.
- **Corrections.** A `tell_work` correction targets one run: the only one, or the one the team hint names. If it can't tell, it asks one question and changes nothing. If the correction would touch a one-off job that has already started, it asks whether to do it again instead of re-running it. It bumps the objective's `briefRevision`. Runs outside the target's downstream keep their results, which move forward to the new revision. In the downstream:
  - queued runs get the corrections in their brief;
  - the target, when under way, gets the correction through `sendRunMessage`;
  - completed runs are re-queued with their result attached as prior work.
  A result that arrives for an older revision is kept as prior work and run again, never delivered.
- **Delivery and acceptance.** The one `done` report is written only when every run is completed and valid for the current revision. Before that, one query checks the final result against the objective's done-when. A check that can't be read lets the result through, noted in the report's detail; the domain's own review still stands. A single final domain run is told through `tellRun`; anything else is one line.
- **Adapting.** A failed run, or a final result that falls short of done-when, is re-briefed to its team once with why. A one-off job may have acted outside, so it is never re-run on its own. A second failure, or a failed job, is one `decision` report; there is no third try, and an unanswered close-but-not-there decision is not re-checked. Each adaptation is recorded with its reason, and `work_status` shows the plan, his corrections and the adaptations.

### Chief of Staff — waiting work (behind `FLYD_COS=1`)

This is v8 Phase 7. Each objective records what it waits on George for (`waitingOn`: the report, its kind, question and options), so nothing waits silently and his reply has somewhere to go. Each wait kind takes only its own answers (`WAIT_ANSWERS` in `command/cos/types.ts`): work that couldn't start (`intake`) takes his words and is briefed again; a run's own call (`run`) goes to that run; a run that didn't finish (`retry`) is tried another way or dropped; a result that fell short (`accept`) is taken as it is or tried another way; work gone quiet (`stuck`) is nudged, parked or left running; a hand-over never confirmed (`unconfirmed`) is sent again or dropped. A run that didn't finish is a wait, never a terminal objective status.

- **Every wait carries a question.** An objective waiting on George with nothing asked gets one: "“X” is waiting on you for Y", where Y is the open question of a run awaiting his decision, or "a decision". One with nothing planned never started, so it asks for more and his words brief it again, whatever was recorded; a correction with no part left to pick never asks "Which part is this for?".
- **Snooze.** `tell_work` with `kind: "snooze"` and `until` (`this_evening`, `tomorrow_morning`, or a time he names) sets the wait aside. Until then the CoS raises nothing for it and doesn't treat the objective as stuck; the rest of the objective carries on. At the time it is raised once more ("Back as you asked: …"). `work_status` lists it as snoozed until then.
- **His reply resumes the same objective**, never a new task. `tell_work` with his answer (`kind: "decision"`, and `choice` when he picked an offered option):
  - a run's own call goes to that run, as before;
  - work that couldn't start goes back to intake with his answer added;
  - a result that fell short is delivered when he takes it as it is;
  - otherwise what didn't make it is tried again with his words, or dropped (with what waits on it) when he says to drop it.
  - an option counts only when `choice` names it, or when his words name exactly one offered option; an unclear stuck reply, or one naming two options, asks again and changes nothing;
  - his words alone never re-run a one-off job that already ran: he is asked first, and only an explicit option runs it again. A job whose dispatch was refused never ran, so his words re-queue it as for any retry ("Try again" / "Drop it").
- **Stuck work is mostly Flyd's to settle.** An objective with no progress for a day (`STUCK_MS`: no run sent or settled, no word from its teams, no earlier triage) is settled from what it waits on:
  - a FirstMate run is chased by the fleet monitor (recorded as a nudge);
  - a Librarian run gets a note asking where it stands;
  - a crew run is parked, since the crew tells him itself; it settles with the crew task (ready or landed completes it, failed is his call: try another way or drop it, discarded cancels it) and is never sent again on its own; a result that falls short of done is his call too (take it as it is or try another way), and its done report is recorded without telling him twice. An objective whose runs are all dropped or cancelled closes as cancelled.
  When the CoS can't tell (a one-off job running a day, a team that can't be asked), George gets one decision: Nudge / Park it / It's ongoing. Staff silence on its own never reaches him. Each choice is recorded with why. Parked and ongoing objectives are never treated as stuck again.
- **Plain run statuses** show in `work_status(objective_id)` only, so only when he asks: interrupted, retrying; picked up (a retry finished it); replaced (a newer revision took over); reported twice (one result kept); still finishing (gone quiet; the chaser is on it).
- **Not yet covered:** the conversation view's Needs you column has no snooze button. It lists FirstMate's own calls, not the CoS's reports, so a snooze is set by telling Flyd.

### Chief of Staff — steering and status (behind `FLYD_COS=1`)

This is split plan Phase 4. With the flag on:

- **Steering.** `tell_work(message, kind?, objective_id?, team?)` replaces the in-turn fast path that sent a correction straight to a domain run.
  - The CoS (`command/cos/steer.ts`) resolves which open objective the message is for. The Jev domain reading arrives as a team hint that narrows the list.
  - It delivers the message through `sendRunMessage` to that objective's open run.
  - When two or more objectives match, it returns one question for Flyd to ask instead of guessing. It forwards nothing when no work is under way.
  - A cancel is passed to the open run and closes the objective; an objective with nothing dispatched yet is closed directly. A background job or crew task cannot be cancelled this way, so the cancel is reported as not delivered.
- **Status.** `work_status(objective_id?)` is read-only. It lists his open and recent objectives and their stage, or returns one objective's retained result (report, decisions, open questions, artefacts), so a follow-up question never dispatches anything.
- **Tool set.** On George's own turns, Flyd's tools no longer include the management tools (`start_*`, `pass_on_question`, `background_task`, `domain_work`, `crew`) or the code-writing ones (`edit_file`, `write_file`).
  - A shell command that changes anything is refused with "hand it off".
  - Every route may steer work under way with `tell_work`; routes that hand work over (delegate, answer, act) do it with `hand_off`.
  - Unattended runs (background jobs, the agenda) are the work itself and keep their tools.
- **LIVE.** A LIVE or command-bar `task_plan` becomes a `hand_off` objective (`handOffLiveTask` in `runtime/live-task-intake.ts`) instead of a separate `AgentTask`.

## 13. Success criteria

The architecture is working when:

- George can begin almost every substantial request with Flyd;
- coding requests reach FirstMate without George having to address FirstMate;
- Flyd can answer detailed follow-ups from retained results;
- a domain boss can ask/receive a real escalation without exposing worker chatter;
- domain failures enter the existing improvement loop;
- confident Jev routing lowers latency rather than adding a second reasoning turn;
- no boss summary is the sole surviving copy of important evidence;
- Flyd increasingly resolves lower-level questions without involving George;
- George spends more time on goals, taste and consequential decisions than task management.
