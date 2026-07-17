# Intelligence Surface Foundation

## Status

Implemented architecture and first complete directed-interface slice for Flyd V1.

This document describes the implemented Rails surface foundation. Product behavior and completion criteria are defined in `docs/product/flyd-personal-agent-platform-prd.md`; the earlier `docs/product/flyd-v1-prd.md` remains the detailed directed-surface specification.

## Principle

**Flyd is the intelligence. The interface is the intelligence expressed.**

**The intelligence is not waiting for instructions. It is continuously preparing the next scene for you.**

Projects, contexts, conversations, messages, decisions, beliefs, behaviours, events, goals, reports, attachments, provider signals, corrections, feedback, scenes, artifacts, and actions are evidence or system structures. They inform Flyd. They do not determine the interface directly.

The TypeScript CLI and Rails application are two interfaces to one Flyd brain. The CLI owns the shared local archive and its retrieval, graph, attention, interest, review, and maintenance machinery. Rails consumes those capabilities as evidence for `Flyd::Intelligence`; it is not a smaller replacement brain.

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

`GET /` performs no model composition and executes no provider. It renders the current persisted surface immediately. Periodic export, targeted retrieval, archive writing, and composition all run in background jobs.

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

## Shared brain interface

The CLI exports schema version `1.0`:

```bash
node cli/dist/export-state.js --stdout
```

Each evidence unit carries stable identity and type, source, epistemic status, confidence, generated time, evidence references, and structured content.

The periodic export includes goals, tensions, attention signals, curiosity, nudges, reports, recent events, memory health, personal interests, graph coverage, review state, maintenance suggestions, and the complete capability manifest.

For an active intent, conversation, or scene, background composition also invokes the JSON-only retrieval bridge:

```bash
node cli/dist/bridge.js retrieve --query "What was I working on?"
```

Search, `ask`, librarian evaluation, and Rails composition use the same ranked retrieval service. It returns stable memory references, source paths, freshness, confidence, corroboration, and a sufficiency judgment. Sufficient memory may justify conversation; partial or conflicting memory may justify investigation. `Flyd::Intelligence` still makes the final interface judgment.

Rails validates both CLI contracts and persists shared `IntelligenceSnapshot` records in PostgreSQL. Unchanged semantic evidence refreshes freshness without creating another snapshot. Failed refreshes preserve the newest usable snapshot for the same query and expose explicit provider health.

Accepted intents, extracted decisions, context corrections, surface feedback, and resolutions flow back into `~/.flyd/raw` through idempotent background archive events. The next CLI refresh therefore sees what happened in Rails. Test pollution is quarantined at read time without deleting source files.

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
- faster incremental retrieval and indexing across very large archives;
- native microphone, camera, and screen capture;
- transcription and vision understanding for binary media;
- execution capabilities beyond OpenCode;
- richer artifact editing and execution workflows;
- deeper resurfacing and longitudinal learning;
- continued refinement of the final spatial visual language.

See `docs/product/flyd-personal-agent-platform-prd.md` for the authoritative product definition and completion gate.
