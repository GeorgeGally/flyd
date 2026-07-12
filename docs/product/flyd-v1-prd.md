# Flyd V1 Product Requirements

## Status

Authoritative product PRD for Flyd V1.

This document supersedes the July 7 project/chat-first PRD. The project/chat document remains useful historical context for the OpenCode execution bridge, but it is no longer the product specification.

The architecture foundation is documented separately in `docs/architecture/intelligence-surface-foundation.md`.

## Product thesis

**Flyd is the intelligence. The interface is the intelligence expressed.**

**The intelligence is not waiting for instructions. It is continuously preparing the next scene for you.**

Flyd is not a dashboard, project manager, chat shell, attention feed, or wrapper around one model. It is a persistent system that understands the user’s situation, presents what deserves attention, thinks with the user, acts through specialist capabilities, and remembers what changed.

Projects, conversations, memories, scenes, artifacts, providers, tools, and agents are parts of the system. None is the product by itself.

## V1 outcome

A user opening Flyd should immediately understand:

1. what they were doing;
2. what changed;
3. what remains unresolved;
4. what Flyd recommends doing next;
5. what Flyd can execute now.

The defining loop is:

```text
Continue → Notice → Think → Act → Resolve → Learn
```

V1 is successful when that loop works end to end for one real software-project workflow without manual context transfer.

## The five product outcomes

### 1. Continue

Opening Flyd restores the most relevant active work rather than presenting a blank composer or requiring project selection.

Requirements:

- Restore the current durable scene and its active interaction.
- Show the latest meaningful state, unresolved question, and next move.
- Preserve continuity when navigating away and returning to `/`.
- A project or temporary context may own the work, but ownership is not the first thing the user sees.
- A genuinely empty system may show the universal fallback.

Acceptance criteria:

- After discussing a scene, returning to `/` restores that conversation automatically.
- The surface clearly distinguishes current work from supporting context.
- The current scene survives surface recomposition.

### 2. Notice

Flyd prepares a scene when meaningful evidence changes, without waiting for a user prompt.

V1 evidence sources:

- local captures;
- goals and plans;
- project decisions and beliefs;
- conversation outcomes;
- build state and build outcomes;
- provider health;
- explicit feedback and corrections.

Requirements:

- Scheduled or event-driven preparation happens outside the request path.
- Flyd synthesizes evidence rather than exposing raw records.
- A new scene appears only when it has a clear purpose for the user.
- Provider failure does not erase the last usable experience.

Acceptance criteria:

- A completed build produces a new or updated scene without refreshing the page manually.
- A changed evidence snapshot can prepare a new surface.
- Unchanged evidence does not generate duplicate work.

### 3. Think

Universal input enters the current surface. Conversation is a scene within the plane, not a separate application mode.

Requirements:

- Interpret desired outcome and requested capability before assigning durable context.
- Retrieve relevant evidence before responding.
- Keep the active conversation inside the same attention budget as other scenes.
- Prior turns grow downward and recede without becoming a separate chat application.
- Context ownership remains correctable.

Acceptance criteria:

- A user can continue the active conversation directly from `/`.
- Ambiguous input is preserved before context is assigned.
- Correcting context repairs derived memory without disturbing unrelated work.

### 4. Act

Flyd can propose and execute a real capability.

V1 executable capability:

- Build software through OpenCode using the relevant project, conversation, scene, memory, and root path.

Requirements:

- A build is first created as a reviewable proposal.
- The confirmation view shows what will run, where it will run, and the evidence supplied.
- Nothing executes until the user confirms.
- Execution status returns to Flyd as evidence.
- Failures are durable outcomes, not transient errors.

Acceptance criteria:

- A generated scene can offer `Build`.
- Selecting it creates a proposed build and does not execute OpenCode.
- Confirming it queues execution exactly once.
- The user can return to the surface while execution proceeds.

### 5. Resolve

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
- Resolving a scene creates or links a durable artifact.
- A completed build creates a build-result artifact.
- The resolution is returned to the conversation and world state.
- The resolved scene may collapse, leave, or return later with its history intact.

Acceptance criteria:

- A manually resolved scene has a resolution artifact.
- A successful build has a linked artifact containing output and summary.
- The originating scene records its resolution and resolved artifact.
- Flyd recomposes after resolution using the artifact as evidence.

## Editorial interface contract

- One dominant scene is the default.
- No more than two supporting scenes should compete for attention.
- An active conversation counts as a scene.
- Clarification belongs inside the current scene, not as unrelated interface chrome.
- Layout is deterministic and semantic; the model never emits pixels or arbitrary UI code.
- Relationships may join, yield, recede, leave, replace, collapse, or return across surface generations.

The three-item rule is an editorial attention budget, not a universal database constraint for every nested element.

## Intelligence contract

Flyd must:

- understand desired outcome before durable ownership;
- synthesize across available evidence;
- distinguish observation, inference, confirmed fact, and generated hypothesis;
- retain provenance for decisions, beliefs, actions, and artifacts;
- stop at genuine approval boundaries;
- update memory from verified outcomes;
- avoid treating retrieval scores or provider heuristics as intelligence.

## Scope

### Included in V1

- single user;
- local-first persistence;
- generated surface;
- durable scenes and artifacts;
- active conversation continuation;
- project and temporary-context ownership;
- OpenCode build proposal, confirmation, execution, and outcome;
- memory extraction and correction;
- background evidence preparation;
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
- general-purpose artifact editing.

## Superseded requirements

The following July 7 assumptions are no longer product requirements:

- projects are the primary product unit;
- a sidebar/project switcher is the primary interface;
- chat is the application shell;
- every meaningful thought must belong to a project;
- exactly one chat thread per project defines the experience;
- the landing page has a permanently prescribed project-summary layout;
- Flyd is limited to software projects;
- qmd specifically is required rather than semantic retrieval generally.

The useful requirements retained from that PRD are:

- remove manual context transfer between thinking and execution;
- OpenCode remains the software executor;
- user confirmation precedes execution;
- outcomes return to Flyd and memory;
- local-first, durable, single-user V1.

## V1 completion gate

Flyd V1 is not complete until one browser-tested journey proves:

1. the user opens `/` and continues active work;
2. the conversation appears as the dominant scene;
3. Flyd proposes a build from that scene;
4. the user reviews and confirms it;
5. OpenCode execution completes or fails durably;
6. an artifact and conversation outcome are created;
7. the scene resolves or updates;
8. the surface recomposes around the new state.
