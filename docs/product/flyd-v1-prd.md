# Flyd V1 Product Requirements

## Status

Superseded as the authoritative product definition by `docs/product/flyd-personal-agent-platform-prd.md`.

This document remains the detailed directed-surface specification for the Rails interface where it does not conflict with the personal-agent platform PRD.

This document supersedes the July 7 project/chat-first PRD. Projects, chat, OpenCode, memory, scenes, artifacts, and providers remain useful parts of Flyd, but none defines the product interface.

The architecture foundation is documented separately in `docs/architecture/intelligence-surface-foundation.md`.

## Product thesis

**Flyd is the intelligence. The interface is the intelligence expressed.**

**The intelligence is not waiting for instructions. It is continuously preparing the next scene for you.**

Flyd is not valuable because it reopens the last thing the user touched. Every ordinary application can do that. Continuity is necessary, but it is table stakes.

Flyd is valuable when it understands the present situation and transforms the entire surface into the interface required to handle it.

```text
What is happening?
→ What matters now?
→ What should Flyd accomplish?
→ What interface would best accomplish it?
→ Generate that scene
```

Projects, conversations, memories, scenes, artifacts, providers, tools, and agents are evidence and capabilities inside the system. None is the product by itself.

## Defining V1 outcome

A user should open Flyd and encounter the most useful interface for the present moment—not a fixed home screen, project dashboard, attention feed, or automatically restored chat.

The same surface may become:

- a **decision** when a real choice blocks progress;
- an **investigation** when uncertainty must be reduced;
- an **action** when Flyd is ready to perform work;
- a **conversation** when thinking together is genuinely the best next move;
- **monitoring** when a changing condition matters but is not actionable yet;
- **quiet** when nothing has earned the screen.

The defining loop is:

```text
Notice → Direct → Think or Act → Resolve → Learn
```

Continuity supports this loop. It does not lead it.

V1 succeeds when this loop works end to end for one real software-project workflow without manual context transfer.

## The five product outcomes

### 1. Notice

Flyd prepares a situation when meaningful evidence changes, without waiting for a user prompt.

V1 evidence sources:

- local captures;
- goals and plans;
- project decisions and beliefs;
- active and recent scenes;
- conversation outcomes;
- build proposals, execution state, and outcomes;
- artifacts;
- provider health;
- explicit feedback and corrections.

Requirements:

- Scheduled or event-driven preparation happens outside the request path.
- Flyd synthesizes evidence rather than exposing raw records.
- Unchanged evidence does not create duplicate work.
- Provider failure does not erase the last usable experience.
- The last active conversation is evidence, not an automatic winner.

Acceptance criteria:

- A completed build prepares a new or updated situation without a manual refresh.
- A changed evidence snapshot can alter the selected interface mode.
- A recent conversation does not displace a more important decision, investigation, or action.

### 2. Direct

Flyd decides what kind of moment this is and generates the correct interface grammar.

Supported V1 modes:

#### Quiet

Almost nothing appears. Flyd does not manufacture urgency or reopen work merely because it exists.

#### Conversation

The active interaction becomes the dominant scene only when dialogue is the best next move. Prior turns grow downward and recede.

#### Decision

The choice itself becomes the screen. The user sees:

- the decision;
- two to four real options;
- the consequence of each option;
- Flyd’s recommendation when evidence supports one;
- executable choice controls.

Choosing an option creates a durable decision artifact and resolves the scene.

#### Investigation

Uncertainty becomes the screen. The user sees:

- what is currently known;
- what remains unknown;
- the exact next question worth pursuing;
- an action to begin that investigation.

Beginning the investigation creates a focused interaction around that question.

#### Action

Ready work becomes the screen. The user sees:

- what Flyd proposes to do;
- what will change;
- whether the work is ready, blocked, or already running;
- the confirmation boundary.

The action does not execute until reviewed and confirmed.

#### Monitoring

A changing condition becomes the screen. Flyd shows the condition, its direction, and the threshold that would make it actionable.

Requirements:

- The mode changes the whole composition, not just a card title.
- Directed modes appear before the universal composer; the composer recedes to a response/control surface.
- Conversation is never restored automatically over a more important mode.
- Each mode has a strict renderer, metadata, action, and item-count contract.
- The model chooses semantics; deterministic renderers control layout and execution.
- One dominant scene is the default. No more than two supporting scenes compete for attention.

Acceptance criteria:

- A decision surface cannot validate without real options and executable choices.
- An investigation surface cannot validate without known/unknown evidence and a next question.
- An action surface cannot validate without proposed work and an executable review action.
- Quiet renders exactly one calm scene.
- Returning to `/` does not automatically reopen chat when a directed surface is active.

### 3. Think

Universal input enters the current surface without forcing the experience into a permanent chat shell.

Requirements:

- Interpret desired outcome and requested capability before assigning durable context.
- Retrieve relevant evidence before responding.
- Conversation counts inside the same attention budget as every other scene.
- Context ownership remains correctable.
- A directed scene can become a focused conversation when the user chooses to discuss or investigate it.
- Continuity restores the relevant interaction only when Flyd has selected conversation mode or the user explicitly opens it.

Acceptance criteria:

- Ambiguous input is preserved before context is assigned.
- Correcting context repairs derived memory without disturbing unrelated work.
- Selecting **Investigate** starts an interaction around the exact displayed question.
- Selecting **Discuss** opens the scene’s interaction without making chat the permanent shell.

### 4. Act

Flyd can propose and execute a real capability.

V1 executable capability:

- Build software through OpenCode using the relevant project, conversation, scene, memory, and root path.

Requirements:

- A build is first created as a reviewable proposal.
- The action surface explains what will run and what will change.
- The confirmation view shows where it will run and the evidence supplied.
- Nothing executes until the user confirms.
- Execution status returns to Flyd as evidence.
- Failures are durable outcomes, not transient errors.

Acceptance criteria:

- A generated action scene can offer **Review action**.
- Selecting it creates a proposed build and does not execute OpenCode.
- Confirming it queues execution exactly once.
- The user can return to the surface while execution proceeds.

### 5. Resolve and Learn

Work resolves into durable meaning, not merely hidden presentation state.

Canonical model:

```text
Scene       = durable unit of meaning and work
SurfaceItem = temporary presentation of a scene
Surface     = current composition
Intent      = user input or request
Artifact    = durable result
```

Requirements:

- A scene persists across multiple surfaces.
- Choosing an option creates a durable decision artifact.
- Resolving a scene creates or links a durable artifact.
- A completed build creates a build-result artifact.
- The resolution returns to the interaction and world state.
- The resolved scene may collapse, leave, or return later with its history intact.
- Verified outcomes update memory and influence future direction as evidence, never as a mechanical ranking rule.

Acceptance criteria:

- A decision choice resolves its scene and records both an artifact and project decision when project-owned.
- A successful build has a linked artifact containing output and summary.
- The originating scene records its resolution and resolved artifact.
- Flyd recomposes after resolution using the new artifact as evidence.

## Dynamic interface contract

The surface is a sequence of editorially directed scenes.

- There is no fixed home-screen content beneath those scenes.
- The universal composer remains available but changes prominence according to the mode.
- A directed scene occupies the primary visual plane.
- Supporting scenes may join, yield, recede, leave, replace, collapse, or return.
- Layout is deterministic and semantic; the model never emits pixels, HTML, CSS, controllers, or arbitrary executable UI.
- Mode-specific renderer and action contracts fail closed.
- The three-item rule is an editorial attention budget, not a universal database constraint for nested elements.

## Intelligence contract

Flyd must:

- decide what kind of interface the moment requires;
- understand desired outcome before durable ownership;
- synthesize across available evidence;
- distinguish observation, inference, confirmed fact, and generated hypothesis;
- retain provenance for decisions, beliefs, actions, and artifacts;
- stop at genuine approval boundaries;
- update memory from verified outcomes;
- avoid treating recency, retrieval scores, provider heuristics, or the last open conversation as intelligence.

## Scope

### Included in V1

- single user;
- local-first persistence;
- background prepared surface;
- dynamic quiet, conversation, decision, investigation, action, and monitoring modes;
- durable scenes and artifacts;
- conditional conversation continuity;
- executable decision and investigation actions;
- project and temporary-context ownership;
- OpenCode build proposal, confirmation, execution, and outcome;
- memory extraction and correction;
- text and file intent evidence;
- deployment, retention, and encrypted backups.

### Explicitly later

- native microphone, camera, and screen capture;
- image understanding and audio transcription;
- broad email, calendar, Slack, and web observation;
- multiple specialist execution agents beyond OpenCode;
- collaborative/multi-user workflows;
- autonomous high-risk execution;
- comprehensive semantic retrieval across all historical evidence;
- general-purpose artifact editing;
- unrestricted generative layout beyond the controlled mode grammars.

## Superseded requirements

The following assumptions are no longer product requirements:

- projects are the primary product unit;
- a sidebar/project switcher is the primary interface;
- chat is the application shell;
- opening the product automatically restores the last conversation;
- every meaningful thought must belong to a project;
- exactly one chat thread per project defines the experience;
- the landing page has a permanently prescribed project-summary layout;
- Flyd is limited to software projects;
- qmd specifically is required rather than semantic retrieval generally.

Useful requirements retained from the earlier PRD:

- remove manual context transfer between thinking and execution;
- OpenCode remains the software executor;
- user confirmation precedes execution;
- outcomes return to Flyd and memory;
- local-first, durable, single-user V1.

## V1 completion gate

Flyd V1 is not complete until browser-tested journeys prove:

### Decision journey

1. evidence creates an unresolved choice;
2. `/` becomes a decision interface instead of restoring chat;
3. the user chooses an option;
4. a decision artifact is created;
5. the scene resolves;
6. the surface recomposes around the new reality.

### Investigation journey

1. evidence exposes meaningful uncertainty;
2. `/` becomes an investigation interface;
3. known facts, unknowns, and the next question are visible;
4. the user starts the investigation;
5. a focused interaction opens around that exact question;
6. the outcome updates the scene.

### Action journey

1. Flyd identifies work ready to execute;
2. `/` becomes an action interface;
3. the user reviews the proposed work and impact;
4. confirming queues OpenCode exactly once;
5. execution completes or fails durably;
6. an artifact and interaction outcome are created;
7. the surface recomposes around what changed.
