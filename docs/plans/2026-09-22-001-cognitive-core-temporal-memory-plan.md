---
title: Cognitive Core & Temporal Memory
type: feat
status: completed
date: 2026-09-22
completed: 2026-09-23
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

The problem is orchestration and representation.

Important context is assembled through multiple independent paths and often too late. Current state may be inferred only for certain intents. Memory retrieval often begins from the literal user utterance. Conversation referents are not a durable structured state. Temporal validity is mostly treated as freshness rather than as a first-class question of whether a fact is still actionable.

More importantly, too much of Flyd's memory architecture still treats maintained documents and summaries as the knowledge itself. That creates a compression-drift risk: an agent rewrites prior material without fully preserving the reasons, dependencies, contradictions, and downstream implications that made the original fact meaningful. The canonical layer must therefore move below Markdown into immutable events, claims, and typed relationships.

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

### State is derived, not edited

Flyd should not maintain truth by repeatedly editing summaries. It should store provenance-bearing events and claims, connect them with typed relationships, and derive current state from that graph.

### Relationships explain why

Support, contradiction, dependency, requirement, supersession, causation, containment, and resolution relationships are operational data. They must affect state derivation, not merely retrieval ranking.

### Markdown is a projection

PROFILE.md, NOW.md, project files, and other human-readable records are rebuildable views over the logical world model. Losing or rewriting a projection must never destroy canonical knowledge.

### Jev evaluates predicates; code changes state

Use Jev as a fast probabilistic predicate engine over small, bounded evidence projections. Jev may judge whether evidence supports a proposition, whether a new statement contradicts or supersedes an existing claim, whether a trace contains reusable learning, whether context is relevant, or whether ambiguity warrants escalation.

Jev does not directly mutate the graph, compute dates, enforce permissions, or perform multi-hop state derivation. Deterministic code interprets Jev probabilities using explicit per-predicate thresholds and then applies validated graph operations.

# Target architecture

Sources:
- conversations
- git
- tasks
- verified outcomes
- user corrections
- explicit memories
- consented external context

These emit immutable provenance-bearing observations/events.

Events produce candidate claims and relationships. Before ambiguous semantic mutations enter the graph, Flyd may evaluate bounded propositions with Jev. Claims and entities are connected through typed relationships. The logical world model is the canonical knowledge layer.

Core flow:

events / observations
-> bounded evidence projection
-> Jev semantic predicates where needed
-> validated candidate claims / relations
-> typed relationships
-> deterministic derived world state
-> projections
-> Context Compiler
-> model

A background curator proposes and validates graph mutations:
- ADD claim
- SUPPORT claim
- CONTRADICT claim
- CORRECT claim
- SUPERSEDE claim
- EXPIRE claim
- COMPLETE entity/task/event
- CANCEL entity/task/event
- CARRY_FORWARD into a new claim
- GENERALIZE
- LINK
- PRUNE projection

The curator maintains derived personal knowledge projections:
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

# Canonical logical world model

The canonical knowledge layer is not Markdown and not a summary cache.

It is composed of:

1. Immutable Events — what was observed, stated, changed, verified, corrected, or completed.
2. Claims — atomic propositions derived from events.
3. Entities — projects, people, organizations, tasks, events, features, requirements, files, products, etc.
4. Relations — typed, weighted edges that explain why claims/entities are connected.
5. Derived State — the currently valid world model computed from claims + relations + lifecycle + time.

Internal principle:

> Events are history. Claims are knowledge. Relationships explain why. State is derived. Markdown is a view.

## Claim

Suggested shape:

- id
- subject
- predicate
- object
- epistemicStatus
- epistemicConfidence
- observedAt
- validFrom
- validUntil
- sourceEventIds
- status

Claims should be atomic enough that one claim can be superseded or contradicted without rewriting unrelated knowledge.

Examples:

- event:gnm3 --occurred_on--> 2026-09-05
- task:gnm3:sponsorship --required_for--> event:gnm3
- task:gnm3:sponsorship --status--> open
- event:gnm3 --status--> completed

## Relation

Start with a deliberately small operational vocabulary:

- supports
- contradicts
- supersedes
- requires
- depends_on
- caused_by
- part_of
- instance_of
- resolved_by
- valid_for

Each relation carries:
- source refs
- confidence
- createdAt
- optional validity window
- optional relation metadata

Do not start with an open-ended ontology. New relation types require a demonstrated derivation or retrieval use case.

## Derived-state rules

Initial deterministic rules:

1. A claim superseded by a valid newer claim is not current.
2. An event-bound task whose parent event completes becomes expired/completed unless explicitly carried forward.
3. A current parent remains unresolved when a required child is unresolved.
4. Contradicting claims reduce certainty and surface a conflict instead of silently overwriting one another.
5. When an upstream dependency changes, downstream derived state is marked potentially stale until revalidated.

These rules are more important than broad graph traversal.

## Logical chains

The graph must support causal/product/project chains such as:

customer
-> has_problem
-> problem
-> motivates
-> feature
-> requires
-> requirement
-> implemented_by
-> commit
-> verified_by
-> test

If a requirement changes, Flyd should be able to identify the affected feature, implementation, and verification evidence without depending on an agent remembering to edit every summary that mentioned the old requirement.

This is the core difference between archive retrieval and a world model.

# System-1 predicate layer (Jev)

Jev is not Flyd's reasoning model and not the canonical world model. It is a fast semantic judgment layer used for bounded questions whose answer space is known in advance.

The implementation pattern is adapted from Agent Beacon's Jev usage: first construct a small deterministic projection of evidence, then ask several typed yes/no or choice questions in one call, persist the probabilities and evaluator metadata, and let deterministic code decide what follows.

## Bounded projection

Never send the whole user history or world model to Jev.

Each evaluation builds a purpose-specific projection such as:
- incoming event or statement
- nearby candidate claims
- relevant entities and relations
- source evidence
- parent project/event state
- current temporal frame
- exact deterministic facts already known

Projection limits should be explicit by evaluator type: maximum events, maximum claims, maximum text per field, and allowed source classes.

## Predicate families

Initial predicates:

### Ingestion / curation
- is_correction
- changes_current_state
- same_entity
- supports_existing_claim
- contradicts_existing_claim
- supersedes_existing_claim
- creates_new_claim
- should_create_task
- evidence_supported

### Retrieval / context
- relevant_to_request
- useful_as_current_context
- useful_as_historical_context
- requires_current_verification
- same_project_or_workstream

### Conversation
- refers_to_previous_action
- resolves_to_known_entity
- user_is_correcting_flyd
- user_is_confirming_decision

### Learning
- task_succeeded
- contains_reusable_correction
- contains_reusable_workflow
- learning_supported_by_trace

### Escalation
- ambiguity_is_material
- needs_reasoning_model
- needs_more_evidence

Do not use Jev for:
- date arithmetic
- lifecycle propagation
- graph traversal
- permission enforcement
- irreversible-action authorization
- numeric accounting
- deterministic repository facts
- open-ended planning
- prose generation

## Evaluation contract

Suggested internal result:
- evaluator
- evaluatorModel
- rubricVersion
- rubricHash
- projectionHash
- sourceEventIds
- predicates: id, probability, confidence
- evaluatedAt
- latencyMs
- cost

Predicate results are evidence, not truth. They remain inspectable and provenance-linked.

## Per-predicate gates

Do not flatten all predicate outputs into one average score for graph mutation.

Example policy:
- same_entity >= 0.90 may allow entity coalescing only when deterministic identifiers do not conflict.
- evidence_supported >= 0.85 is required before automatic promotion of an inferred durable claim.
- supersedes_existing_claim >= 0.90 may propose a supersession edge.
- contradicts_existing_claim >= 0.90 may create a contradiction edge; it must not delete either claim.
- relevant_to_request >= 0.70 may include a retrieved candidate in context.
- confidence below the evaluator-specific floor preserves the item as uncertain or escalates to the reasoning model.

Thresholds are versioned policy, benchmarked, and adjustable. They are not embedded casually throughout call sites.

## Separation of soft and hard reasoning

Soft semantic judgment:
- Is George correcting a previous assumption?
- Are these two statements about the same project?
- Does this trace support the proposed learning?
- Is this memory relevant to the current intent?

Use Jev where benchmarked useful.

Hard deterministic logic:
- validUntil < now
- parent event is completed
- relation A supersedes B exists
- test exited 0
- commit SHA exists
- action grant permits exact target

Use code.

This separation is a central Cognitive Core invariant.

## Example: GNM3 correction

Input: GNM3 is done; we don't need sponsors anymore.

Bounded projection includes:
- event:gnm3 status/date claims
- task:gnm3:sponsorship
- existing sponsor requirement relation
- incoming user statement

Jev may return:
- is_correction: 0.98
- changes_current_state: 0.99
- same_entity: 0.99
- supersedes_existing_claim: 0.95
- should_create_task: 0.02

Validated operations:
- add user-stated completion/correction event if not already present
- add or confirm supersession relation where appropriate

Then deterministic lifecycle rules derive:
- GNM3 completed
- GNM3-bound sponsorship task expired

Jev does not directly set the task to expired.

## Example: learning from an agent trace

Bounded trace projection:
- task goal
- selected tool/file/test events
- corrections
- outcome

Questions in one Jev call:
- task_succeeded?
- contains_reusable_correction?
- learning_supported_by_trace?

Only if the relevant predicate gates pass does Flyd create a candidate learning. The candidate remains provenance-linked and may require review depending on authority and impact.

## Fail-safe behaviour

If Jev is unavailable, slow, malformed, or low-confidence:
- preserve the source event
- do not perform the optional semantic graph mutation
- fall back to deterministic rules where possible
- escalate to the reasoning model only when the user-facing task requires it
- never block basic Present/context operation solely on Jev availability

The world model must remain usable without the hosted evaluator.

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

Use human-readable, git-friendly Markdown as inspection and portability projections. They are disposable views over the canonical event/claim/relation graph and can always be rebuilt. The curator never treats a projection edit as canonical truth.

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

The curator operates on canonical events, claims, entities, and relations. It does not perform free-form edits to prior knowledge files. Projection files are regenerated from validated graph state.

Inputs:
- completed conversation turns
- explicit corrections
- task lifecycle events
- verified execution outcomes
- git project digests
- foreground/project activity signals when permitted
- explicit memory captures
- existing claims

Supported canonical operations:
- ADD_CLAIM
- ADD_RELATION
- SUPPORT
- CONTRADICT
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

Use Jev as the default fast semantic classifier for bounded interpretation predicates when benchmarked above the deterministic baseline, with a reasoning-model fallback for materially ambiguous cases.

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
- canonical claim/entity/relation store
- QMD
- raw archive
- wiki
- graph indexes
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

## Phase 1: Canonical claims, relations, temporal derivation, and Jev predicate interface

Primary files:
- cli/src/cognition/types.ts
- cli/src/cognition/world-model.ts
- cli/src/cognition/relations.ts
- cli/src/cognition/temporal.ts
- cli/src/cognition/system-one/types.ts
- cli/src/cognition/system-one/jev.ts
- cli/src/cognition/system-one/policy.ts
- cli/src/lib/brain-retrieval.ts
- cli/src/resolve.ts

Implement:
- Entity / Claim / Relation contracts
- immutable source-event references
- typed relation vocabulary
- TemporalClaim fields
- deterministic derived-state rules
- parent lifecycle propagation through relations
- Jev request/response adapter
- bounded projection contract
- versioned predicate-policy thresholds
- provenance for Jev evaluations
- fail-safe behaviour when Jev is unavailable
- current vs historical filtering
- GNM regression

Acceptance:
- GNM3 completion invalidates the GNM3 sponsor task through the valid_for/requires graph relationship, not by an LLM editing NOW.md.
- Jev may classify correction/supersession/support predicates, but deterministic lifecycle logic performs the invalidation.
- A superseded claim cannot remain current.
- A contradiction is preserved as a conflict rather than destructively resolved.
- Low-confidence or failed Jev evaluations never silently mutate canonical state.
- A stale action cannot appear as current merely because semantic relevance is high.

## Phase 2: Rebuildable PROFILE / NOW / project projections

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

## Phase 3: Background graph curator + semantic predicate evaluation

Add:
- cli/src/cognition/curator/curator.ts
- reconcile.ts
- lifecycle.ts
- prompts.ts
- queue.ts

Implement:
- conversation closeout to immutable events
- bounded curator projections
- Jev predicate batches for ambiguous semantic judgments
- corrections as new claims + supersession edges
- task outcomes as lifecycle events
- git digest ingestion as observations
- evidence-support evaluation for inferred learnings
- claim reconciliation
- relation creation
- conflict preservation
- graph-derived projection updates
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

## Phase 5: Conversation state + Jev-backed semantic interpretation

Add:
- cli/src/cognition/conversation-state.ts
- cli/src/cognition/interpret.ts

Refactor:
- cli/src/lib/recall-intent.ts
- cli/src/runtime/conversation-responder.ts
- cli/src/router.ts

Acceptance:
Short follow-ups such as “do that”, “the backend”, and “take another look” resolve correctly. Fast bounded interpretation uses Jev when confident and escalates when material ambiguity remains.

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

## Phase 7: Unified memory read API + Jev reranking

Add:
- cli/src/cognition/memory.ts

Move QMD/raw/wiki/graph/history behind it.

Add optional Jev reranking over a small candidate set using bounded predicates such as relevant_to_request, useful_as_current_context, and requires_current_verification. Keep direct deterministic entity/project matches ahead of semantic reranking.

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
2. Existing raw/wiki/QMD data remains readable as source material during migration.
3. Canonical new knowledge is represented as events/claims/relations, not maintained summaries.
4. Projections are rebuildable and non-authoritative.
5. Existing epistemic metadata is preserved.
6. Missing temporal validity defaults to unknown, never silently current.
7. Legacy records are progressively converted/enriched by curator passes.
8. Rails remains excluded from active intelligence.
9. TypeScript Core remains the only new active intelligence runtime.

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
- Jev evaluator/model when used
- predicate IDs + probabilities/confidence
- predicate policy version
- Jev latency/cost
- fallback/escalation reason

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
- no unconditional Jev call for deterministic state derivation
- batch independent Jev predicates over the same bounded state into one request
- Jev failure must not make Present/NOW unavailable

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

1. Add cli/src/cognition/types.ts with Entity, Claim, Relation, and TemporalClaim.
2. Add cli/src/cognition/world-model.ts with a minimal local canonical store/projection interface.
3. Add cli/src/cognition/relations.ts with the initial typed relation vocabulary.
4. Add cli/src/cognition/temporal.ts with deterministic derived-state rules.
5. Add cli/src/cognition/system-one with Jev adapter, bounded projection contract, evaluation provenance, and versioned per-predicate policy.
6. Represent GNM3, its event date/status, and sponsor task as claims/entities/relations in fixtures.
7. Feed an ambiguous user correction fixture through Jev-compatible predicate evaluation and prove deterministic graph code owns the resulting lifecycle mutation.
8. Prove GNM3 completion invalidates sponsor-task actionability through graph derivation.
9. Add supersession, contradiction, low-confidence, and Jev-unavailable regression fixtures.
10. Add NOW projection reader/writer generated from derived state.
11. Inject generated NOW into the active resolution prompt.
12. Add debug trace fields for derivation path, Jev predicates, expired/suppressed claims, and conflicts.
13. Run existing Core tests plus the logical/temporal/System-1 benchmark subset.

Do not start the full curator/compiler rewrite until this slice proves that derived state beats document mutation for a real stale-memory failure.

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
11. PROFILE/NOW/project Markdown can be deleted and rebuilt from canonical events/claims/relations without loss of knowledge.
12. At least one dependency chain can be invalidated/revalidated through relation traversal without editing a summary by hand.
13. Jev is used only for bounded semantic predicates; deterministic code remains authoritative for lifecycle, permissions, dates, and graph-derived current state.
14. Jev outage/low confidence cannot corrupt canonical state or prevent basic Flyd cognition.
15. Benchmarks demonstrate at least one measurable win from Jev in intent classification, evidence support, claim/relation classification, or memory reranking before making it a required dependency.

# Success criterion

Flyd should stop feeling like an agent searching for context.

It should feel like a system that was already aware of George's world, understood what changed, knew what had ended, understood why facts and tasks were connected, and used tools only to deepen or act on that understanding.

The canonical test is not whether Flyd can maintain good notes. It is whether Flyd can recompute correct current state from history, claims, and relationships after the world changes.


## Implementation completion

Completed on main.

Landed:
- canonical event/claim/relation world model with temporal validity, lifecycle derivation, conflicts, supersession, dependencies, and unresolved requirements
- rebuildable PROFILE/NOW/project Markdown projections over the canonical model
- materialized Present state from WorkHypothesis, tasks, workers, decisions, and git activity
- git distillation feeding both Present and canonical world claims
- structured conversation state and referent tracking
- unified memory query facade; legacy archive retrieval is background-only for current-tense reasoning
- Context Compiler used by overlay resolution, Work Intelligence, CLI conversation, task planning, coding memory, `flyd ask`, and LIVE voice
- checkpointed background curator over immutable conversation events
- bounded Jev System-1 predicate client, versioned thresholds, trace metadata, timeout/failure fallback, and explicit hosted-egress opt-in
- deterministic safety and lifecycle logic remains authoritative over probabilistic classifiers
- GNM3 temporal regression tests, Jev/curator tests, and a 35-case intelligence benchmark fixture
- compatibility adapter retained for the legacy exported `buildMemoryPack()` test/API surface without restoring it to production cognition
- erasure-safe projection rebuild cleanup

Release invariants are documented in `docs/evals/cognitive-core-baseline-2026-09-22.md`.
