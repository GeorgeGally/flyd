# Intelligence Surface Foundation

## Status

Implemented architecture and first complete directed-interface slice for Flyd V1.

This document describes the runtime, persistence, trust boundaries, interface grammar, and deployment substrate. Product behavior and completion criteria are defined in `docs/product/flyd-v1-prd.md`.

## Principle

**Flyd is the intelligence. The interface is the intelligence expressed.**

**The intelligence is not waiting for instructions. It is continuously preparing the next scene for you.**

Projects, contexts, conversations, messages, decisions, beliefs, behaviours, events, goals, reports, attachments, provider signals, corrections, feedback, scenes, artifacts, and actions are evidence or system structures. They inform Flyd. They do not determine the interface directly.

The TypeScript CLI is an evidence producer. It is not a second intelligence, an attention engine, or a user-facing product boundary.

## Runtime architecture

```text
provider evidence + Rails memory + active intent + active interaction
+ unresolved scenes + builds + artifacts + prior surface
+ corrections + feedback + learned preferences
→ Flyd::WorldStateCompiler
→ Flyd::WorldStateExtensions
→ exact state budget + final-state reference registry
→ Flyd::InterfaceDirector
→ Flyd::Intelligence
→ Flyd::SurfacePlanValidator
→ persisted Scenes + draft Surface
→ transactional activation
→ keyed Turbo morph
→ actions, corrections, memory, artifacts, and outcomes return as evidence
```

`GET /` performs no model composition and executes no provider. It renders the current persisted surface immediately. Missing or stale provider state schedules refresh but never blocks Flyd from composing with Rails memory and provider-health evidence.

## Canonical product domains

```text
Scene       = durable unit of meaning and work
SurfaceItem = temporary presentation of a Scene
Surface     = current composition
Intent      = user input or request
Artifact    = durable result
```

Scenes and artifacts are product domains. Surfaces and surface items are presentation domains. Conversations, projects, contexts, memories, builds, and provider snapshots supply interaction, ownership, execution, and evidence.

A scene may survive many surface compositions. A surface item may disappear while the scene remains unresolved. A resolved scene links to the artifact that changed the world.

## Intelligence-state interface

The CLI exports schema version `1.0`:

```bash
node cli/dist/export-state.js --stdout
```

Each evidence unit carries stable identity and type, source, epistemic status, confidence, generated time, evidence references, and structured content.

Rails validates CLI output and persists shared `IntelligenceSnapshot` records in PostgreSQL. Unchanged semantic evidence refreshes freshness without creating another snapshot. Failed refreshes preserve the newest usable snapshot and explicit provider health.

## Bounded world state and provenance

`Flyd::WorldStateCompiler` and `Flyd::WorldStateExtensions` combine:

- provider evidence and health;
- active intent and interaction;
- projects, contexts, decisions, beliefs, scenes, artifacts, and build outcomes;
- current and prior surface state;
- corrections and feedback;
- executable actions and renderers.

`Flyd::StateBudget` truncates and prunes evidence to an exact serialized budget or fails closed. `Flyd::ReferenceRegistry` is derived from the final pruned state.

A surface stores the complete semantic state digest plus exact provider snapshot identities. Source inspection therefore resolves evidence against the state actually used for composition.

## Interface direction

`Flyd::InterfaceDirector` identifies which interface modes are justified by the current evidence. It does not directly generate the surface and it does not mechanically rank records. It supplies Flyd with a constrained set of meaningful interface candidates.

Supported modes:

- **quiet** — nothing has earned a more demanding interface;
- **conversation** — dialogue is genuinely the best next move;
- **decision** — an unresolved choice is blocking progress;
- **investigation** — meaningful uncertainty must be reduced;
- **action** — proposed or running work requires review or an outcome;
- **monitoring** — a changing condition matters but is not yet actionable.

Unresolved decisions, investigations, and actions outrank passive conversation continuity. The most recently touched conversation is evidence, not the default product state.

## Flyd judgment and validation

`Flyd::Intelligence` is the only model judgment boundary. It decides among the modes justified by the evidence and emits a bounded semantic plan. It does not generate HTML, CSS, coordinates, arbitrary controllers, or private reasoning.

`Flyd::SurfacePlanValidator` rejects:

- a mode not justified by the current situation;
- hallucinated or pruned references;
- unsupported renderers or actions;
- incompatible renderer-kind pairs;
- invalid relationships or focus IDs;
- arbitrary metadata or action payloads;
- media not bound to explicit attachment evidence;
- mode grammars that are incomplete.

Invalid plans never displace the active surface.

## Mode-specific interface grammar

### Quiet

Exactly one calm focus scene. No manufactured urgency and no automatic conversation restoration.

### Conversation

The active interaction becomes the dominant scene only when conversation is the selected mode or the user explicitly opens it. Conversation shares the same attention budget as supporting scenes.

### Decision

The decision occupies the whole primary plane. It requires:

- two to four real choices;
- consequences for each choice;
- an optional evidence-backed recommendation;
- an executable `choose` action for each choice.

Choosing creates a durable decision artifact, creates a project decision when project-owned, resolves the scene, and recomposes the surface.

### Investigation

The uncertainty occupies the primary plane. It requires:

- known evidence;
- unknown evidence;
- the exact next question worth pursuing;
- an executable `investigate` action.

Starting the investigation preserves the investigation interface while converting the lower composer into the focused conversation for that exact question.

### Action

Proposed work occupies the primary plane. It requires:

- what Flyd proposes to do;
- what will change;
- readiness state;
- an executable build-review action.

Selecting the action creates a proposed build and opens the confirmation boundary. OpenCode does not run until explicit confirmation.

### Monitoring

The changing condition and its action threshold occupy the plane, with no more than one supporting scene.

## Spatial substrate

The surface supports:

- one dominant scene and up to two supporting scenes as an editorial default;
- full-plane directed modes;
- a composer whose prominence changes with the mode;
- deterministic depth and placement;
- join, yield, recede, leave, replace, collapse, and return relationships;
- stable semantic DOM identity and Turbo morphing;
- immediate local dismissal or collapse without depending on later composition.

The model chooses meaning and relationships. Deterministic renderers control physical layout and execution.

## Universal intent and context

Intent is persisted before durable ownership. Interpretation identifies desired outcome and requested capability before context resolution. Projects and temporary contexts are possible owners; ambiguous input remains unresolved and correctable.

Context correction preserves provenance and repairs only the affected message segment, decisions, and dependent beliefs.

## Execution and durable outcomes

Capabilities create reviewable proposals at genuine approval boundaries. Execution status and verified outcomes return as evidence. Durable results are stored as artifacts and linked to the scene they resolve or update.

OpenCode is the first V1 executor:

```text
action scene
→ reviewable proposed build
→ explicit confirmation
→ OpenCode execution
→ durable success/failure artifact
→ scene resolution
→ conversation outcome
→ surface recomposition
```

The architecture can support additional specialist capabilities later without making any executor the intelligence boundary.

## Persistence and diagnostics

Only one surface may be active. Surface activation is transactional and preserves lineage. Composition logs record reason, state digest, provider identities, input/output size, latency, validation failure, dropped evidence, and delivery errors without private chain-of-thought.

Binary intent evidence uses Active Storage with size limits, MIME detection, retention, safe delivery, and encrypted backup coverage.

## Background preparation and deployment

Production separates web rendering from Sidekiq work. Redis backs Sidekiq, cache, and trigger coalescing. Active Storage is mounted persistently across web and worker roles. Scheduled work refreshes provider evidence, imports captures, synthesizes beliefs, purges expired media, and creates encrypted backups.

## What remains beyond this slice

The core directed-interface loop is implemented for decision, investigation, action, conversation, monitoring, and quiet. Further product development still includes:

- broader observation across email, calendar, GitHub, Slack, and the web;
- semantic retrieval across deeper history rather than bounded recent evidence;
- native microphone, camera, and screen capture;
- transcription and vision understanding for binary media;
- execution capabilities beyond OpenCode;
- richer artifact editing and execution workflows;
- deeper resurfacing and longitudinal learning;
- continued refinement of the final spatial visual language.

See `docs/product/flyd-v1-prd.md` for the authoritative product definition and completion gate.
