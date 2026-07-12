# Intelligence-Generated Interface

## Status

Accepted and implemented as the primary Flyd architecture.

## Principle

**Flyd is the intelligence. The interface is the intelligence expressed.**

Projects, temporary contexts, conversations, messages, decisions, beliefs, behaviours, events, goals, reports, attachments, provider signals, corrections, and feedback are evidence and persistence structures. They inform Flyd. They do not determine the interface directly.

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
→ actions, corrections, memory, and outcomes return as evidence
```

`GET /` performs no model composition and executes no provider. It renders the current persisted surface immediately. Missing or stale provider state schedules refresh, but never blocks Flyd from composing with Rails memory and explicit provider-health evidence.

## Intelligence-state interface

The CLI exports schema version `1.0`:

```bash
node cli/dist/export-state.js --stdout
```

The contract is defined in `schemas/intelligence-state.schema.json`. Every evidence unit carries:

- stable identity and type;
- source;
- epistemic status;
- confidence;
- generated timestamp;
- evidence references;
- structured content.

Reports and plans are discovered recursively. Paths are portable relative to `FLYD_DIR`. File export uses a temporary file and atomic rename. Rails validates CLI output and persists shared `IntelligenceSnapshot` records in PostgreSQL.

Unchanged semantic evidence refreshes freshness without creating another snapshot. Failed refreshes record provider errors while preserving the newest usable snapshot. Each provider envelope supplied to Flyd includes the exact snapshot ID and digest used for composition.

## Bounded world state and provenance

`Flyd::WorldStateCompiler` combines:

- provider evidence and provider health;
- the active universal intent;
- the active project- or context-owned interaction;
- relevant project decisions and beliefs;
- the current surface;
- context corrections;
- recent surface feedback;
- executable actions and renderers.

`Flyd::WorldStateExtensions` adds:

- extracted text and metadata from active intent attachments;
- active temporary contexts;
- learned presentation preferences.

`Flyd::StateBudget` recursively truncates and prunes deepest evidence before structural provider envelopes. It either returns serialized state within the exact character budget or fails closed. The valid-reference registry is derived only from the final pruned state, so Flyd cannot reference evidence it was not actually shown.

The semantic state digest excludes observation time. Identical evidence therefore produces the same identity. A surface stores:

- the full semantic state digest;
- the exact provider snapshot IDs and digests;
- the evidence drops and provider health used during composition.

Source inspection resolves provider evidence against those exact snapshots rather than whichever snapshot happens to be current later.

## Flyd judgment and plan validation

`Flyd::Intelligence` is the only judgment boundary. It synthesizes what the user should experience now and emits at most three semantic items. It does not generate HTML, CSS, coordinates, arbitrary controllers, or private reasoning.

Flyd may create new semantic item IDs. Context and source references must use exact IDs present in the compiled state.

`Flyd::SurfacePlanValidator` rejects:

- hallucinated or pruned references;
- unsupported renderers or actions;
- incompatible renderer/kind combinations;
- invalid kinds, intentions, depths, modes, relationships, or focus IDs;
- duplicate semantic IDs;
- empty surfaces;
- arbitrary renderer metadata;
- arbitrary action payloads;
- media metadata not bound to an explicit validated attachment source;
- context-correction payloads that were not present in the compiled state.

Invalid plans never displace the current active surface.

## Renderers, actions, and spatial semantics

Implemented renderers:

- `hero_scene`;
- `supporting_card`;
- `conversation`;
- `document`;
- `notification`;
- `code`;
- `data_table`;
- `media`.

Implemented executable actions:

- discuss;
- answer;
- approve;
- reject;
- dismiss;
- resolve;
- inspect sources;
- correct context.

Only registered and implemented actions may be emitted or rendered.

Semantic relationships are directional:

- join;
- yield;
- recede;
- leave;
- replace;
- collapse;
- return.

The surface is a continuous positioned plane rather than a dashboard grid. Stimulus derives deterministic displacement, depth, opacity, blur, scale, collapse, replacement, and return behaviour from item depth and incoming/outgoing relationships. Turbo morphs the plane by stable semantic item identity, preserving continuity across surfaces.

Dismissed and collapsed items leave the rendered plane immediately. Their lifecycle does not depend on a later successful model composition.

## Universal, multimodal intent

Input is persisted as an `Intent` before context is assigned:

```text
text / clipboard / file / image / audio / future screen capture
→ Intent + IntentAttachment evidence
→ InterpretIntentJob
→ strong unique context, clarification candidates, or no persistent context
→ project- or temporary-context-owned conversation when interaction is needed
→ surface recomposition
```

Automatic context routing requires a strong unique match with word-boundary matching, stopword filtering, minimum evidence, and a top-two score margin. Ambiguous input remains unresolved. It is never written into the most recently active project or a fabricated Inbox/General project.

Temporary contexts are first-class interaction owners. A conversation belongs to exactly one project or one context. Temporary-context discussions use the same streaming and surface interaction path without requiring a hidden project.

## Context correction and memory provenance

Context correction validates authoritative project/context records before persistence.

The provenance chain is explicit:

```text
Intent
→ source user Message
→ Decisions extracted from that user-response segment
→ Beliefs carrying source_decision_ids
```

Decision extraction processes each user-response segment independently, ignores context-superseded segments, records the source message, marks completed extraction, and avoids duplicate decisions for the same source.

When an accepted intent is corrected:

- a new interaction is created in the corrected project/context when needed;
- only the corrected user message and its following assistant-response segment are superseded;
- only decisions derived from that source message move or are removed;
- dependent beliefs remove those decision sources and become challenged or superseded as appropriate;
- unrelated messages, decisions, beliefs, and intents in the original conversation remain intact;
- the original conversation is retired only when no visible user work remains;
- correction lineage is retained on the intent.

Superseded message segments are excluded from model prompts, world state, conversation history, and the live surface.

## Multimodal evidence storage and retention

`IntentAttachment` retains semantic evidence metadata, checksum, extracted text, MIME type, size, provenance, and expiry. New binary uploads are stored through Active Storage rather than PostgreSQL byte columns.

Ingestion enforces:

- five-file maximum;
- 10 MB per file;
- 25 MB total;
- server-side MIME detection through Marcel;
- a restricted type allowlist;
- checksum deduplication within an intent;
- bounded text extraction;
- 90-day default expiry.

Media delivery uses private no-store responses, `nosniff`, a restrictive content-security policy, and a safe inline-type allowlist. Unsafe or general files are forced to download. Legacy database bytes remain readable only as a migration fallback.

Expired unreferenced attachment records and bytes are deleted. Expired attachments still referenced by a scene retain provenance metadata while their binary storage is purged.

## Scene feedback and soft learning

`SurfaceFeedback` records opened, ignored, discussed, dismissed, resolved, corrected, useful, and not-useful outcomes.

`SurfacePreference` learns decayed tendencies across renderer, kind, intention, context type, and source type. Preferences return to Flyd as soft evidence. They never directly rank, hide, emit, or suppress scenes.

## Persistence and diagnostics

`Surface` lifecycle:

```text
draft → active → superseded
             ↘ expired

draft → invalid
```

Only one surface may be active. Activation is transactional and preserves lineage.

`SurfaceCompositionLog` records:

- reason;
- semantic state digest;
- provider health and exact snapshot identities;
- input/output size;
- latency;
- validation failures;
- dropped evidence;
- broadcast enqueue errors separately from successful composition.

No private chain-of-thought is stored.

## Background preparation and deployment

Surface preparation is triggered by scheduled refresh, changed evidence, stale/missing surfaces, intents, attachments, temporary context creation, corrections, assistant responses, decision extraction, belief synthesis, feedback, and imported captures.

Triggers are coalesced rather than dropped. Broadcast delivery retries independently.

Production separates responsibilities:

- web containers render prepared state;
- a Sidekiq job role refreshes evidence, interprets intents, composes surfaces, synthesizes memory, purges expired media, and broadcasts updates;
- Redis backs Sidekiq, production caching, and trigger coalescing;
- Active Storage lives on a persistent mounted volume shared by web and workers;
- the production image includes Node, PostgreSQL client, and GPG;
- encrypted backups archive both the configured PostgreSQL database and the Active Storage directory.

## Validation contract

CI verifies:

- Brakeman;
- RuboCop on changed Ruby files;
- JavaScript dependency audit;
- CLI typecheck, tests, and production build;
- PostgreSQL schema loading;
- full migration-chain execution;
- byte-for-byte schema parity after migrations;
- Rails unit/integration tests;
- real-browser system tests for the generated surface, context interaction, lifecycle, media, and legacy diagnostic project flows.

## Remaining extension points

The architecture intentionally leaves these as later product work:

- native microphone, camera, clipboard, and screen-capture controls;
- transcription and vision extraction providers for binary media;
- semantic retrieval beyond bounded recency and active context;
- richer artifact editing and execution;
- explicit resurfacing controls and deeper longitudinal learning;
- continued visual refinement of the final spatial language.

Legacy project and conversation routes remain diagnostic/fallback views. Production rollout remains controlled by `FLYD_GENERATED_SURFACE`.
