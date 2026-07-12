# Intelligence-Generated Interface

## Status

Accepted and implemented as the primary Flyd architecture.

## Principle

**Flyd is the intelligence. The interface is the intelligence expressed.**

Projects, conversations, messages, decisions, beliefs, behaviours, events, goals, reports, media, contexts, and provider signals are evidence and persistence structures. They inform Flyd. They do not determine the interface directly.

## Runtime architecture

```text
provider evidence + Rails memory + active intent + prior surface + feedback
→ Flyd::WorldStateCompiler
→ Flyd::WorldStateExtensions
→ Flyd::Intelligence
→ Flyd::SurfacePlanValidator
→ persisted draft Surface
→ transactional activation
→ live surface replacement
```

`GET /` performs no model composition or provider execution. It renders the current persisted surface immediately and only schedules stale work.

## Intelligence-state interface

The TypeScript CLI is an evidence producer behind schema version `1.0`, not a separate intelligence product.

```bash
node cli/dist/export-state.js --stdout
```

The contract is defined in `schemas/intelligence-state.schema.json`. Every exported unit carries:

- stable identity and evidence type
- source
- epistemic status
- confidence
- generated timestamp
- evidence references
- structured content

Reports and plans are discovered recursively. Paths are portable and relative to `FLYD_DIR`. Manual file export uses a temporary file and atomic rename. Rails ingests stdout through `RefreshIntelligenceStateJob`, validates the contract, and persists shared `IntelligenceSnapshot` records in PostgreSQL.

Unchanged evidence refreshes freshness without unnecessary composition. Failed refreshes are recorded while the newest usable evidence remains available with explicit health errors.

## Bounded world state

`Flyd::WorldStateCompiler` normalizes and deduplicates provider evidence, then combines it with:

- the active universal intent
- the active conversation when one exists
- relevant project decisions and beliefs
- the current surface
- context corrections
- recent surface feedback
- executable capabilities and renderers

`Flyd::WorldStateExtensions` adds:

- text extracted from active intent attachments
- image, audio, file, clipboard, and screen evidence metadata
- active temporary contexts
- learned presentation preferences

Both layers apply hard character and collection budgets and record dropped evidence diagnostically. They prepare evidence; they do not decide what should appear.

## Composition contract

Flyd may create new semantic surface-item IDs. Context and source references must resolve to IDs in the compiled world state.

`Flyd::SurfacePlanValidator` rejects:

- hallucinated references
- unsupported renderers
- unsupported actions
- invalid item kinds, intents, depths, and modes
- duplicate semantic IDs
- missing focus items
- invalid relationship endpoints or behaviours

Invalid output never replaces the current active surface.

## Renderer and action registries

Implemented renderers:

- `hero_scene`
- `supporting_card`
- `conversation`
- `document`
- `notification`
- `code`
- `data_table`
- `media`

The media renderer presents stored image, audio, and file evidence. The code and table renderers present structured artifacts rather than forcing them into prose cards.

Implemented action contracts include discussion, answering, approval, rejection, dismissal, resolution, source inspection, context correction, and artifact opening. Only registered actions may be emitted or rendered.

Semantic relationships drive spatial behaviour:

- join
- yield
- recede
- leave
- replace
- collapse
- return

Motion is derived from meaning rather than item array position.

## Universal and multimodal intent

Input is persisted first as an `Intent` before any project context is assigned.

```text
text / clipboard / file / image / audio / screen
→ Intent + IntentAttachment evidence
→ InterpretIntentJob
→ context candidates or accepted contexts
→ interaction/conversation where needed
→ surface recomposition
```

Attachments are size-limited, checksummed, stored durably, and interpreted asynchronously. Textual formats contribute extracted text. Binary media remains source evidence available to Flyd and media renderers.

An intent may have no project, one project, a temporary context, or several context references. Ambiguous input remains unresolved and visible for correction; it is never stored in a fake Inbox project.

`ContextCorrection` records original and corrected contexts and feeds future world-state composition. Users may create temporary non-project contexts directly from the clarification surface. Temporary contexts expire unless retained through continued use.

## Scene lifecycle and learning

`SurfaceFeedback` records opened, ignored, discussed, dismissed, resolved, corrected, useful, and not-useful signals.

Scenes may be:

- dismissed
- resolved
- collapsed into durable summary metadata
- superseded by a later surface
- resurfaced by Flyd when new evidence makes them relevant

`SurfacePreference` learns decayed renderer, kind, intent, context-type, and source-type tendencies from outcomes. These preferences return to Flyd as soft evidence. They never directly rank, hide, or emit interface objects.

## Persistence and diagnostics

`Surface` and `SurfaceItem` are durable semantic presentation records.

```text
draft → active → superseded
             ↘ expired

draft → invalid
```

Only one surface may be active. Activation is transactional and preserves previous-surface lineage.

`SurfaceCompositionLog` records reason, state digest, provider health, input/output size, latency, validation failures, and compiler drops without storing private chain-of-thought.

## Background preparation

Surface preparation is triggered by:

- scheduled provider refresh
- changed evidence
- missing or stale surfaces
- new intents and attachments
- temporary context creation
- context corrections
- assistant responses
- decision extraction
- belief synthesis
- scene feedback
- newly imported captures

Composition triggers are coalesced rather than dropped. Broadcast delivery retries independently from composition.

## Remaining extension points

The next extensions are:

- native microphone, camera, clipboard, and screen-capture controls rather than upload fields alone
- transcription and vision extraction providers for binary audio and images
- semantic retrieval beyond bounded recency and active context
- explicit resurfacing controls and richer longitudinal learning
- artifact editing and execution workflows beyond presentation

Legacy project and conversation routes remain diagnostic/fallback views. Production rollout is controlled by `FLYD_GENERATED_SURFACE`.
