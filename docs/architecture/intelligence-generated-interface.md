# Intelligence-Generated Interface

## Status
Accepted.

## Principle

**Flyd is the intelligence. The interface is the intelligence expressed.**

Projects, conversations, messages, decisions, beliefs, behaviours, events, goals, and reports are evidence and persistence structures. They inform Flyd. They do not determine the interface directly.

## Core boundary

The root surface must be composed through `Flyd::Intelligence`, persisted, validated, and activated before it becomes visible.

Flyd receives a snapshot of the current world, including active interaction, memory, project context, recent decisions, beliefs, messages, goals, tensions, curiosity, nudges, reports, events, and available capabilities. Flyd synthesizes that state and returns:

- its concise understanding of what is happening
- its current intention toward the user
- a semantic surface composition
- relationships to supporting contexts and evidence
- available actions

Rules, retrieval, scoring, and validation may support this operation. They must not replace Flyd's judgment by turning stored records directly into UI.

## Intelligence-state interface

The TypeScript CLI is a producer behind a versioned interface, not a separate intelligence product.

The compiled exporter can emit JSON to stdout:

```bash
node cli/dist/export-state.js --stdout
```

Manual file export remains available through `npm run export-state`, but Rails does not use the file as application transport.

`RefreshIntelligenceStateJob` executes the exporter in a background worker, validates the payload through `IntelligenceState::CliProvider`, and persists it as an `IntelligenceSnapshot` in PostgreSQL. Web and worker processes therefore share the same canonical provider state.

Snapshots store:

- provider and schema version
- generated and received timestamps
- freshness
- a content digest
- payload
- provider errors

Unchanged content refreshes freshness without triggering unnecessary composition. Changed content queues a new surface composition. Failed refreshes are persisted separately while the most recent usable evidence remains available with explicit health errors.

Provider output is evidence supplied to Flyd. It never directly determines a surface object.

## Persisted surface lifecycle

`Surface` and `SurfaceItem` are durable semantic presentation records.

A surface moves through:

```text
draft → active → superseded
             ↘ expired

draft → invalid
```

Only one surface may be active. Activation is transactional: the previous active surface is superseded only when the replacement draft is valid and contains its declared focus item. Invalid drafts never replace the current experience.

The request path performs no model composition. `GET /` loads the active persisted surface and creates a deterministic fallback only when no active surface exists.

## Background composition and live replacement

`ComposeSurfaceJob` is triggered by:

- changed provider state
- a missing or stale active surface
- a new user intent
- a completed assistant response

The job:

1. asks `Flyd::Intelligence` to compose a semantic plan
2. persists the plan as a draft
3. activates it transactionally
4. queues `BroadcastSurfaceJob`

Retryable composition failures retain the existing active surface. Exhausted and non-retryable failures are stored as invalid surfaces for diagnostics. Broadcasting retries independently so a transient Action Cable failure never causes duplicate composition or activation.

The browser subscribes to `flyd_surface` and replaces only `#surface_plane`, preserving the universal input and active conversation shell.

## Constraints

- The root experience renders the current persisted Flyd-composed `Surface` when the generated-surface feature is enabled.
- A project, decision, belief, message, goal, signal, or other record never becomes a visible object merely because it exists.
- It is valid for Flyd to synthesize many records into one scene, create no scene, or choose a different representation entirely.
- Projects are context references. They appear only for provenance, correction, or explicit system navigation.
- Conversation is one renderer within the surface. It is not the application shell.
- Conversation grows beneath the universal input, with the newest exchange closest to the input anchor.
- The universal intent entry point is modality-agnostic. Text ships first; audio, files, images, clipboard, and screen input can be added later.
- Flyd decides what appears, why it appears, its prominence, relationships, and available actions.
- Renderers present a semantic plan. They do not determine relevance or intention.
- The surface may contain one dominant scene, several related objects, a conversation, or only the intent entry point.
- Motion communicates semantic changes through expansion, compression, recession, and return. It must be reversible.
- Invalid or unavailable intelligence output falls back to a calm universal input, never to a ranked database feed.
- Missing or stale provider state must be explicit rather than silently ignored.
- Provider refresh, model composition, persistence, and broadcast work must not block the surface request path.

## Current implementation boundary

Implemented:

- persisted surfaces and surface items
- transactional activation and history
- deterministic fallback
- background provider refresh
- PostgreSQL-backed shared intelligence snapshots
- background Flyd composition
- stale and missing-surface triggers
- live Turbo Stream replacement
- independent broadcast retries
- durable provider and composition failure records
- production CLI compilation in the Docker image

Still outside this slice:

- bounded world-state compilation
- strict source-reference validation
- renderer and action registries
- persisted universal intents
- context correction and multi-context interaction
- full scene resolution, collapse, and resurfacing
- multimodal input and artifact renderers

Legacy project and conversation routes remain available as fallback and diagnostic views. Production rollout is controlled by `FLYD_GENERATED_SURFACE`.
