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

The FirstMate fleet ledger may later enrich Present/status, but it is not the request/result authority. Durable inbox replies are the canonical handoff result.

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

### Live correction routing

Correlate George's correction with active DomainRuns and deliver verbatim to the owning boss immediately while Flyd interprets it in parallel.

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
