# Intelligence Surface Foundation

## Status

Implemented architecture foundation for Flyd V1.

This document describes the runtime, persistence, trust boundaries, and deployment substrate. It does **not** claim that the Flyd V1 product is complete. Product behavior and completion criteria are defined in `docs/product/flyd-v1-prd.md`.

## Principle

**Flyd is the intelligence. The interface is the intelligence expressed.**

Projects, contexts, conversations, messages, decisions, beliefs, behaviours, events, goals, reports, attachments, provider signals, corrections, feedback, scenes, artifacts, and actions are evidence or system structures. They inform Flyd. They do not determine the interface directly.

The TypeScript CLI is an evidence producer. It is not a second intelligence, an attention engine, or a user-facing product boundary.

## Runtime architecture

```text
provider evidence + Rails memory + active intent + active interaction
+ prior surface + corrections + feedback + learned preferences
→ Flyd::WorldStateCompiler
→ Flyd::WorldStateExtensions
→ exact state budget + final-state reference registry
→ Flyd::Intelligence
→ Flyd::SurfacePlanValidator
→ persisted draft Surface
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

## Flyd judgment and validation

`Flyd::Intelligence` is the only model judgment boundary. It synthesizes what the user should experience and emits a bounded semantic plan. It does not generate HTML, CSS, coordinates, arbitrary controllers, or private reasoning.

`Flyd::SurfacePlanValidator` rejects hallucinated references, unsupported renderers/actions, incompatible renderer-kind pairs, invalid modes/relationships/focus IDs, arbitrary metadata, arbitrary action payloads, and media not bound to explicit attachment evidence.

Invalid plans never displace the active surface.

## Interface substrate

The surface supports:

- one dominant scene and up to two supporting scenes as an editorial default;
- deterministic depth and placement;
- join, yield, recede, leave, replace, collapse, and return relationships;
- stable semantic DOM identity and Turbo morphing;
- immediate local dismissal/collapse without depending on later composition;
- conversation as a scene within the same plane.

The architecture supports semantic continuity, but product quality still depends on the scene model, continuation behavior, execution capabilities, and visual direction specified in the V1 PRD.

## Universal intent and context

Intent is persisted before durable ownership. Interpretation identifies desired outcome and requested capability before context resolution. Projects and temporary contexts are possible owners; ambiguous input remains unresolved and correctable.

Context correction preserves provenance and repairs only the affected message segment, decisions, and dependent beliefs.

## Execution and durable outcomes

Capabilities must create reviewable proposals at approval boundaries. Execution status and verified outcomes return as evidence. Durable results are stored as artifacts and linked to the scene they resolve or update.

OpenCode is the first V1 executor. The architecture is intended to support additional specialist capabilities later without making any executor the intelligence boundary.

## Persistence and diagnostics

Only one surface may be active. Surface activation is transactional and preserves lineage. Composition logs record reason, state digest, provider identities, input/output size, latency, validation failure, dropped evidence, and delivery errors without private chain-of-thought.

Binary intent evidence uses Active Storage with size limits, MIME detection, retention, safe delivery, and encrypted backup coverage.

## Background preparation and deployment

Production separates web rendering from Sidekiq work. Redis backs Sidekiq, cache, and trigger coalescing. Active Storage is mounted persistently across web and worker roles. Scheduled work refreshes provider evidence, imports captures, synthesizes beliefs, purges expired media, and creates encrypted backups.

## What this foundation does not complete

This foundation alone does not satisfy the Flyd V1 product requirements. V1 additionally requires:

- automatic continuation of current work;
- desired-outcome-first intent interpretation;
- conversation fully participating in the scene attention budget;
- confirmed real execution;
- durable artifacts and scene resolution;
- execution outcomes returning to conversation and surface;
- deeper retrieval and broader observation over time.

See `docs/product/flyd-v1-prd.md` for the authoritative completion gate.
