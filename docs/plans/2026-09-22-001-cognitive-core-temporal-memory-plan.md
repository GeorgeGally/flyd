---
title: Cognitive Core & Temporal Memory
type: feat
status: planned
date: 2026-09-22
owner: George Galanakis
builds_on:
  - docs/plans/2026-07-28-003-feat-unified-memory-architecture-plan.md
  - docs/product/flyd-personal-intelligence-prd.md
---

# Cognitive Core & Temporal Memory

## Goal

Make Flyd feel continuously aware of George's world instead of repeatedly searching for context after a question is asked.

A fresh Flyd interaction should already understand:
- who George is,
- what is active now,
- what recently changed,
- which projects are current,
- which tasks and facts have expired,
- what the current conversation refers to,
- what deeper memory is relevant,
- what Flyd can actually do.

This plan prioritizes cognition over new UI, new evidence adapters, and additional planning abstractions.

## Core diagnosis

Flyd already has strong ingredients: brain retrieval, epistemic metadata, Present Model, WorkHypothesis, task state, git inspection, transitions, receipts, evidence adapters, behavioural directives, conversation history, and execution machinery.

The problem is orchestration.

Important context is assembled through multiple independent paths and often too late. Current state may be inferred only for certain intents. Memory retrieval often begins from the literal user utterance. Conversation referents are not a durable structured state. Temporal validity is mostly treated as freshness rather than as a first-class question of whether a fact is still actionable.

That allows once-correct memories to remain semantically relevant after they stop being current. GNM3 sponsorship is the canonical regression: “secure sponsors for GNM3” was once valid, but should never appear as current advice after the 5 September event unless explicitly carried forward into a future edition.

## Product principles

### Current state before retrieval

Flyd must establish the user's present world before doing deeper memory search. Retrieval enriches current understanding; it should not be responsible for discovering basic present tense.

### Historical truth and current actionability are separate

Expired information remains historically true. It simply stops being valid input for current recommendations.

### Answering and memory-writing are separate jobs

The answering model can emit observations, corrections, outcomes, and candidate learnings. A background curator reconciles durable memory. The interactive agent should not directly rewrite durable personal knowledge.

### One world, one compiler, many interfaces

Mac INVOKED, LIVE, CLI conversation, coding tasks, planning, and future canvas surfaces should consume the same compiled context contract.

### Simple retrieval over strong representations first

PROFILE, NOW, direct project records, aliases, lexical lookup, and entity IDs should solve the common path. Semantic and graph retrieval remain deeper tools.

### Every actionable fact must answer “when?”

A current recommendation cannot rely on an event-bound or deadline-bound fact whose validity has ended.

# Target architecture

Sources:
- conversations
- git
- tasks
- verified outcomes
- user corrections
- explicit memories
- consented external context

These emit provenance-bearing observations/events.

A background curator then:
- reconciles,
- deduplicates,
- generalizes,
- links,
- expires,
- supersedes,
- completes,
- cancels,
- carries forward,
- updates summaries.

The curator maintains personal knowledge projections:
- PROFILE
- NOW
- projects
- people
- organizations
- preferences
- decisions
- tasks
- timeline

The runtime also maintains a materialized Present state for low-latency current work.

Every model turn goes through a Context Compiler that combines:
- PROFILE
- NOW
- Present state
- active conversation state
- current project/entity records
- relevant deep memory
- uncertainty/conflicts
- current environment
- available capabilities

The model then reasons and acts with tools.

# Canonical CompiledContext

Introduce one model-facing context contract under cli/src/cognition.

Suggested fields:

- generatedAt
- user.profile
- user.autonomy
- user.communication
- present.summary
- present.activeProjects
- present.upcoming
- present.waitingOn
- present.recentlyCompleted
- present.openDecisions
- conversation.summary
- conversation.topic
- conversation.goal
- conversation.referents
- conversation.unresolved
- conversation.recentTurns
- memory.current
- memory.relevant
- memory.historical
- memory.conflicts
- memory.gaps
- environment.app
- environment.documentPath
- environment.projectRoot
- environment.repository
- capabilities

No active model-facing code should independently assemble personal profile, Present, memory, project state, or conversation recap after migration.

# Temporal memory model

Extend the existing epistemic model with explicit temporal semantics.

Every durable claim that can influence current behaviour should support:

- observedAt
- validFrom
- validUntil
- effectiveAt
- timeShape
- temporalStatus
- parentEntityId
- supersededBy

Suggested temporal statuses:

- future
- current
- expired
- completed
- cancelled
- superseded
- historical
- unknown

Suggested time shapes:

- durable
- temporary
- deadline_bound
- event_bound
- state
- historical

The dimensions remain separate:

- epistemicConfidence: how strongly Flyd believes the claim is/was true.
- freshness: how recently the claim was observed or revalidated.
- temporalStatus: whether it is valid for the current temporal frame.
- relevance: whether it matters to the current request.

A fact can therefore be:
- highly true,
- highly relevant historically,
- completely invalid as current advice.

## Example: GNM3 sponsorship

Before 5 September 2026:

id: task:gnm3:sponsorship
type: task
project: project:gnm3
content: Secure sponsors for GNM3
time_shape: event_bound
valid_until: 2026-09-05
temporal_status: current

After the event:

temporal_status: expired
superseded_by: event:gnm3:completed

Flyd may still answer:
- “Before GNM3 you were still trying to secure sponsors.”

Flyd must not answer a current-focus question with:
- “You should get sponsors for GNM3.”

If sponsorship work belongs to GNM4, the curator must create a new current claim/task linked to the historical source. It must never silently inherit the old task.

# Parent lifecycle propagation

Event/project lifecycle must affect child actionability.

Example:

GNM3 -> completed

Then:
- sponsor outreach -> expired
- vendor recruitment -> expired
- event-day setup -> completed
- sponsor relationship notes -> historical/durable
- lessons learned -> historical or carried forward explicitly
- GNM4 tasks -> new claims, never recycled GNM3 tasks

Deterministic lifecycle propagation should be used whenever parent/child relationships make the transition obvious.

# Knowledge projections

Use human-readable, git-friendly Markdown as inspection and portability projections. They are not independent authority; they are derived from canonical events/claims and can be rebuilt.

Suggested local structure:

~/.flyd/knowledge/
  PROFILE.md
  NOW.md
  projects/
  people/
  organizations/
  preferences/
  decisions/
  tasks/
  timeline/

## PROFILE.md

Always injected. Relatively stable. Target roughly 3k-5k tokens.

Sections:
- Identity
- Life context
- Work
- Long-term projects
- Preferences
- Communication
- Autonomy

No transient task list.

## NOW.md

Always injected. Fast-changing. Target roughly 2k-4k tokens.

Sections:
- Active now
- Upcoming
- Waiting on
- Open decisions
- Recently completed
- Recently changed

Every item must include a date, validity window, or lifecycle state.

## Project records

Each active project gets one compact record containing:
- stable ID
- aliases
- lifecycle status
- updated_at
- goal
- current state
- recent changes
- decisions
- open loops
- constraints
- related entity/decision/task IDs

Examples:
- project:flyd
- project:bloom
- project:gnm
- event:gnm3
- event:gnm4

# Background curator

Create cli/src/cognition/curator.

Inputs:
- completed conversation turns
- explicit corrections
- task lifecycle events
- verified execution outcomes
- git project digests
- foreground/project activity signals when permitted
- explicit memory captures
- existing claims

Supported write operations:
- ADD
- SUPPORT
- CORRECT
- SUPERSEDE
- EXPIRE
- COMPLETE
- CANCEL
- CARRY_FORWARD
- GENERALIZE
- LINK
- PRUNE_PROJECTION

Corrections must preserve history. Old claims remain versioned/superseded rather than being silently overwritten.

Initial triggers:
- conversation close
- verified task outcome
- explicit correction
- git digest
- Core startup when pending source events exist

Later:
- periodic low-priority reconciliation

Do not make once-per-day ingestion the only mechanism. Current state should normally converge within minutes of a meaningful explicit event.

# Git distillation

Git should feed Present and project memory proactively.

Add cli/src/cognition/git-distiller.ts.

For each registered active repo maintain:
- projectId
- generatedAt
- branch
- dirty state
- recent commits with timestamp and subject
- changed areas
- compact summary
- unresolved signals
- source refs

The distiller updates:
- relevant project projection
- NOW
- Present state

The answering model should not repeatedly rediscover routine git state from scratch.

# Conversation state

Add cli/src/cognition/conversation-state.ts.

Maintain:
- topic
- goal
- entities
- referents
- decisions
- unresolved questions
- discussed artifacts
- compact recap

Required behaviours:
- “do that” resolves to the latest accepted/proposed action.
- “the backend” resolves to the currently discussed Flyd backend/harness.
- “what about Bloom?” can switch project focus while preserving the broader conversation goal.
- compaction preserves decisions and referents rather than only prose summary.

Conversation state is ephemeral by default. The curator promotes durable decisions/outcomes.

# Semantic interpretation

Add cli/src/cognition/interpret.ts.

Replace critical-path regex meaning detection with one structured semantic interpretation step.

Suggested result:
- intentKind: question/current_state/historical_recall/task_resume/action/correction/conversation
- entities
- projectIds
- referents
- temporalFrame: past/present/future/mixed
- needsCurrentState
- needsDeepMemory
- needsExternalEvidence
- requestedAction

Deterministic rules remain appropriate for:
- dictation
- explicit local commands
- safety boundaries
- permissions
- destructive command blocking
- protocol validation

Natural-language meaning should not depend primarily on enumerated regex phrases.

# Context Compiler

Add cli/src/cognition/context-compiler.ts and context-format.ts.

Pipeline:

1. Interpret utterance.
2. Load PROFILE.
3. Load NOW.
4. Load conversation state.
5. Load materialized Present.
6. Identify project/entity context.
7. Read direct project/entity projections.
8. Run targeted deep memory retrieval only if needed.
9. Add live evidence when temporal/current claims require revalidation.
10. Produce CompiledContext.

Retrieval order:
1. PROFILE
2. NOW
3. conversation state
4. direct project/entity reads
5. alias/lexical search
6. semantic memory search
7. graph expansion
8. live external evidence

This makes simple, obvious context cheap and available before sophisticated retrieval.

# Unified memory read API

Add cli/src/cognition/memory.ts.

Consumers should ask one API for memory with:
- text
- entities
- projectIds
- temporalFrame
- includeHistorical
- includeExpired
- includeSuperseded
- limit

Implementation details hidden behind it:
- QMD
- raw archive
- wiki
- graph
- aliases
- history/version lookup

Default behaviour:
- present questions exclude expired/completed/cancelled/superseded actionable claims
- historical questions may retrieve them
- contradictory claims are returned together
- user corrections outrank prior claims
- direct project/entity matches precede semantic expansion

Deprecate direct consumer knowledge of raw/wiki/QMD layout and separate fast/full retrieval entrypoints.

# Present materialization

Create ~/.flyd/state/present.json and cli/src/cognition/present-store.ts.

Present should include:
- foreground project
- active projects
- dirty repos
- recent repo movement
- unfinished tasks
- open decisions
- waiting-on items
- upcoming deadlines/events
- recently completed items
- active workers/agents
- generated timestamp
- provenance refs
- gaps/uncertainty

Update it on:
- authorized foreground/project change
- git change
- task transition
- conversation decision
- verified outcome
- explicit correction
- curator update

Existing PRESENT privacy invariants remain unchanged. Quiet OS observation remains zero-network and zero-persistence; materialized state can only incorporate signals already allowed to persist.

# Model prompt contract

Every answering path should receive a predictable high-level structure:

PROFILE
NOW
CONVERSATION STATE
CURRENT PROJECTS
RELEVANT MEMORY
UNCERTAINTY
CAPABILITIES
USER REQUEST

Rules:
- expired/current labels are explicit
- historical items are never phrased as present instructions
- source provenance remains available
- uncertainty is exposed
- tool use deepens context but does not replace baseline orientation

# Intelligence benchmark

Create cli/src/cognition/__tests__/fixtures/intelligence-benchmark.json with at least 30 real prompts.

Categories:

Current state:
- What am I working on?
- What's active?
- What should I worry about today?
- Where are we with Bloom?

Continuity:
- Where were we?
- Continue what I was doing yesterday.
- Take another look.
- Yeah, do that.
- What about the backend?

Temporal correctness:
- Do I still need sponsors for GNM3?
- What were we worried about before GNM3?
- What should I carry from GNM3 into GNM4?
- Which deadlines are still live?

Recall:
- Why did we decide against X?
- Wasn't there another project like this?
- What did I tell you about the Christmas market?

Project grounding:
- What's wrong with Flyd?
- What changed recently in Bloom?
- Is this still blocked?

Personalization:
- Recommend a tool for this.
- How should I approach this client?
- What kind of solution would suit me?

Score:
- referent resolution
- temporal correctness
- currentness
- project awareness
- recall
- uncertainty handling
- useful initiative
- evidence grounding
- avoidance of stale action

## Hard GNM temporal regression

Given:
- GNM3 date: 2026-09-05
- sponsorship task valid_until: 2026-09-05
- current date: 2026-09-22

Question:
“What should I focus on for GNM?”

Flyd must not recommend obtaining sponsors for GNM3.

Question:
“What did I still need before GNM3?”

Flyd may report sponsorship as historical unfinished work.

This regression must be deterministic and required in CI.

# Implementation phases

## Phase 0: Freeze and baseline

- Freeze new Surface work.
- Freeze new evidence adapters unless benchmark correctness needs one.
- Freeze new planning/future-model abstractions.
- Capture current Flyd answers for benchmark prompts.
- Record latency and which context sources were used.

Deliver:
- intelligence-benchmark.json
- docs/evals/cognitive-core-baseline-2026-09-22.md

## Phase 1: Temporal claims

Primary files:
- cli/src/lib/brain-retrieval.ts
- cli/src/lib/staleness.ts
- cli/src/resolve.ts
- cli/src/cognition/types.ts
- cli/src/cognition/temporal.ts

Implement:
- TemporalClaim
- temporal status evaluation
- date propagation from frontmatter
- parent lifecycle hooks
- current vs historical filtering
- GNM regression

Acceptance:
A stale action cannot appear as current merely because semantic relevance is high.

## Phase 2: PROFILE / NOW / project projections

Add:
- cli/src/cognition/projections/profile.ts
- cli/src/cognition/projections/now.ts
- cli/src/cognition/projections/project.ts
- cli/src/cognition/projections/store.ts

Implement:
- projection schemas
- stable entity IDs
- aliases
- links
- lifecycle/date fields
- read/write/rebuild helpers

Acceptance:
Core can rebuild readable projections from existing durable inputs and survive restart.

## Phase 3: Background curator

Add:
- cli/src/cognition/curator/curator.ts
- reconcile.ts
- lifecycle.ts
- prompts.ts
- queue.ts

Implement:
- conversation closeout
- corrections
- task outcomes
- git digest ingestion
- claim reconciliation
- projection updates
- provenance preservation

Acceptance:
Correction updates current projection while history remains recoverable. Completing an event expires event-bound tasks.

## Phase 4: Present materialization + git distillation

Add:
- cli/src/cognition/present-store.ts
- cli/src/cognition/git-distiller.ts

Refactor:
- cli/src/lib/present-model.ts
- cli/src/work/work-hypothesis/*
- cli/src/lib/recent-commits.ts

Acceptance:
“What am I working on?” answers from materialized current state without archive search.

## Phase 5: Conversation state + semantic interpretation

Add:
- cli/src/cognition/conversation-state.ts
- cli/src/cognition/interpret.ts

Refactor:
- cli/src/lib/recall-intent.ts
- cli/src/runtime/conversation-responder.ts
- cli/src/router.ts

Acceptance:
Short follow-ups such as “do that”, “the backend”, and “take another look” resolve correctly.

## Phase 6: Context Compiler

Add:
- cli/src/cognition/context-compiler.ts
- cli/src/cognition/context-format.ts

Migrate active model call sites:
- cli/src/resolve.ts
- cli/src/work-intelligence/*
- cli/src/realtime-session.ts
- cli/src/runtime/conversation-responder.ts
- cli/src/work-intelligence/task-loop.ts
- active planning model calls

Acceptance:
Every active product model call uses CompiledContext or explicitly documents why it cannot.

## Phase 7: Unified memory read API

Add:
- cli/src/cognition/memory.ts

Move QMD/raw/wiki/graph/history behind it.

Deprecate:
- direct fast brain retrieval consumers
- direct resilient lexical retrieval consumers
- direct searchWiki consumers
- responder-level raw archive scans

Acceptance:
Model-facing code imports one memory query interface.

## Phase 8: Simplify harness cognition

After the benchmark improves, remove duplicated interpretation and planning machinery.

Target runtime mental loop:
- understand
- inspect
- act
- observe
- continue / finish / ask

Keep:
- capability grants
- verification
- delivery contracts
- destructive-action blocks
- budgets
- rollback/integration boundaries

Review for deletion/demotion:
- duplicate current-state inference
- planning predictions that do not improve outcomes
- redundant fast/slow context paths
- independent prompt assembly
- WorkHypothesis/Present overlap

# Migration rules

1. No big-bang rewrite.
2. Existing raw/wiki/QMD data remains readable.
3. Projections are rebuildable.
4. Existing epistemic metadata is preserved.
5. Missing temporal validity defaults to unknown, never silently current.
6. Legacy records are progressively enriched by curator passes.
7. Rails remains excluded from active intelligence.
8. TypeScript Core remains the only new active intelligence runtime.

# Observability

Every model turn should emit a compact debug trace with:
- interpreted intent
- profile loaded
- NOW loaded
- conversation state loaded
- project IDs
- number of memory queries
- current claim count
- historical claim count
- expired claims suppressed
- knowledge gaps
- compile latency

This trace should make “Why did Flyd think that?” answerable without exposing internal chain-of-thought.

# Performance targets

Baseline orientation should feel effectively free:
- PROFILE read under 10ms local
- NOW read under 10ms local
- Present read under 20ms local
- direct project read under 20ms local
- common context compilation under 100ms local before model time
- deeper retrieval budgeted separately
- no unconditional LLM call merely to retrieve current state

# Privacy and safety

- Existing PRESENT invariants remain unchanged.
- Curator uses only authorized durable sources.
- No raw screenshot/audio persistence.
- Forget/erase must invalidate affected projections and indexes.
- Historical/expired claims remain available unless explicitly forgotten.
- Model-generated curator operations must validate schema and provenance before becoming durable.
- Action permissions remain separate from memory/context permissions.

# Explicit non-goals

This release does not:
- build the free-form canvas
- add a new primary UI
- add more evidence providers
- reintroduce Rails as active intelligence
- require Supermemory or another memory vendor
- immediately replace all Markdown/QMD storage
- silently carry tasks from one event edition to another
- optimize for multi-user SaaS memory

# First implementation slice

The first PR should be narrow and visibly improve intelligence:

1. Add cli/src/cognition/types.ts.
2. Add cli/src/cognition/temporal.ts.
3. Propagate temporal metadata into MemoryPack.
4. Add NOW projection reader/writer.
5. Seed NOW from Present/WorkHypothesis and active task state.
6. Add parent-event lifecycle support for event-bound tasks.
7. Add GNM3 sponsorship regression fixture.
8. Inject NOW into the active resolution prompt.
9. Add debug trace fields for expired/suppressed claims.
10. Run existing Core tests plus the temporal benchmark subset.

Do not start the full curator/compiler rewrite until this slice produces a measurable improvement.

# Release gate

Cognitive Core is ready when:

1. A fresh Flyd process can answer “what am I working on?” from current materialized context.
2. Short follow-ups resolve referents across conversation turns.
3. GNM3 sponsorship cannot be recommended as current work after the event.
4. Historical questions can still retrieve expired GNM3 sponsorship work.
5. Profile-level personalization is available without retrieval.
6. Current project state is available without repeatedly rediscovering it.
7. Corrections supersede prior current facts while preserving history.
8. Git changes update project/NOW state before a user asks.
9. All active model paths use CompiledContext.
10. The 30+ prompt benchmark materially improves without regression in safety, provenance, or temporal correctness.

# Success criterion

Flyd should stop feeling like an agent searching for context.

It should feel like a system that was already aware of George's world, understood what changed, knew what had ended, and used tools only to deepen or act on that understanding.
