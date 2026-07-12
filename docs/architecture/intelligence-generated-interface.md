# Intelligence-Generated Interface

## Status
Accepted and implemented as the primary Flyd architecture.

## Principle

**Flyd is the intelligence. The interface is the intelligence expressed.**

Projects, conversations, messages, decisions, beliefs, behaviours, events, goals, reports, and provider signals are evidence and persistence structures. They inform Flyd. They do not determine the interface directly.

## Runtime architecture

```text
provider evidence + Rails memory + active intent + prior surface + feedback
→ Flyd::WorldStateCompiler
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

It applies hard collection and character budgets and records dropped evidence diagnostically. The compiler prepares evidence; it does not decide what should appear.

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

## Universal intent

Input is persisted first as an `Intent` before any project context is assigned.

```text
raw input
→ Intent
→ InterpretIntentJob
→ context candidates or accepted contexts
→ interaction/conversation where needed
→ surface recomposition
```

An intent may have no project, one project, or several context references. Ambiguous input remains unresolved and visible for correction; it is never stored in a fake Inbox project.

`ContextCorrection` records original and corrected contexts and feeds future world-state composition.

## Scene lifecycle

`SurfaceFeedback` records opened, ignored, discussed, dismissed, resolved, corrected, useful, and not-useful signals.

Scenes may be:

- dismissed
- resolved
- collapsed into durable summary metadata
- superseded by a later surface
- resurfaced by Flyd when new evidence makes them relevant

Feedback is evidence for Flyd, not a direct ranking formula.

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
- new intents
- context corrections
- assistant responses
- decision extraction
- belief synthesis
- scene feedback
- newly imported captures

Composition triggers are coalesced rather than dropped. Broadcast delivery retries independently from composition.

## Remaining extension points

The architecture supports but does not yet fully implement:

- audio, image, file, clipboard, and screen ingestion
- richer artifact-specific renderers
- non-project temporary context creation UI
- semantic retrieval beyond the current bounded recency/context compiler
- explicit resurfacing controls and long-term feedback learning models

Legacy project and conversation routes remain diagnostic/fallback views. Production rollout is controlled by `FLYD_GENERATED_SURFACE`.
