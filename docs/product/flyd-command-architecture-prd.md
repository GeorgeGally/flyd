# Flyd Command Architecture PRD

**Status:** Active product/architecture authority  
**Date:** 9 October 2026  
**Scope:** Cross-domain command, domain bosses, specialist delegation, lossless handoffs, routing, escalation, self-improvement  
**Builds on:** `docs/product/flyd-operational-architecture-prd.md`

## 1. Objective

Flyd is the command layer between George and specialist organizations.

George talks to Flyd. Flyd decides who should own the work, gives that domain the right context and authority, supervises at the outcome/decision level, and keeps George at the highest useful altitude.

```text
George
  ↕
Flyd
  ├── FirstMate      coding boss
  ├── Librarian      knowledge boss
  ├── Art Director   creative boss
  └── Life/Ops       personal-operations boss
        ↓
     specialists
```

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

Flyd does not depend on a session being open for a note to be read. When an inbox note has gone unread, Flyd starts a FirstMate session itself (FirstMate's `bin/fm-session-start.sh`) through the first available coding runtime (`FLYD_FIRSTMATE_RUNTIMES`, default `claude,codex,opencode`), retrying with backoff when a runtime is unavailable or hits a usage limit. The session child's environment is stripped of the paid Anthropic API variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`), so the claude CLI runs on the Claude plan rather than the paid API.

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

For a confidently delegated coding turn, the harness exposes only the coding handoff. This prevents the model from choosing a generic background job when FirstMate should own the work.

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

One George objective may create several DomainRuns with dependencies. Flyd owns only this organizational DAG.

### Creative boss

Build after coding + knowledge demonstrate that the common protocol is stable.

### Life/Ops boss

Build only when there is enough recurring work to justify a manager rather than a skill bundle.

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
