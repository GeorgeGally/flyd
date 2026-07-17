# CLI and Rails Brain Parity Design

## Goal

Flyd has one brain with two interfaces. The TypeScript CLI owns local capture, retrieval, consolidation, graph, attention, interest, and knowledge-maintenance machinery. The Rails application must consume that machinery directly and continuously rather than rebuilding smaller Ruby substitutes or receiving a narrow static export.

## Product Contract

- Rails and CLI read and write the same `~/.flyd` archive.
- Rails-generated intents, decisions, corrections, feedback, and outcomes become archive evidence.
- Surface composition performs targeted memory retrieval for the active intent or scene in a background job.
- Retrieved evidence retains source, freshness, confidence, and sufficiency information.
- Memory health, interests, review state, suggestions, knowledge coverage, and available capabilities are exported to Rails.
- CLI maintenance commands may remain CLI commands, but their resulting state and capability availability are visible to Flyd.
- No request-time Rails action invokes an LLM, refreshes a provider, or performs CLI maintenance.
- Test and malformed captures are excluded without deleting user files.

## Architecture

```text
Rails events -----------------------> ~/.flyd/raw
                                           |
CLI capture/consolidate/wiki/graph --------+
                                           |
                         structured brain contract
                       /                         \
             periodic state export       targeted retrieval
                       \                         /
                       persisted Rails snapshots
                                  |
                         WorldStateCompiler
                                  |
                         Flyd::Intelligence
                                  |
                              Surface
```

The CLI exposes structured functions rather than formatted terminal output. Its human commands become adapters over those functions. Rails invokes a dedicated JSON bridge through an allowlisted argument-array command and persists the result as an `IntelligenceSnapshot` before composition.

## Brain Capability Classes

### Automatic cognition

Capture ingestion, memory health, attention, tension, curiosity, interests, suggestions, review state, synthesis state, graph state, and knowledge coverage are background evidence. They must not require a user command in Rails.

### Targeted cognition

Search, ask, and librarian evidence evaluation run against the active intent or scene. Rails uses retrieval and sufficiency results as evidence; `Flyd::Intelligence` remains responsible for synthesis and interface judgment.

### Maintenance operations

Consolidation, ingestion, distillation, graph rebuild, review generation, wiki initialization, and daemon management remain explicit maintenance capabilities. Rails sees their availability and health but does not execute them in the request path.

## Trust Rules

- Every retrieved item has a stable evidence ID and source path.
- Missing or malformed timestamps are `unverified`, not fresh by default.
- Generated evidence without source references cannot direct the interface.
- A stale archive cannot claim to describe current work.
- Test pollution is filtered by one shared detector used by export, retrieval, interests, and health.
- Retrieval failure preserves the last usable snapshot and exposes provider errors.
- Source details remain inspectable, not visually dominant.

## Acceptance Criteria

- A Rails intent about remembered work supplies the same retrieved evidence as `flyd ask/search` would use.
- Rails activity is written to the CLI archive and appears in later retrieval.
- The Rails provider includes brain health, profile interests, suggestions, review state, knowledge statistics, and a capability manifest.
- The parity test fails whenever a new CLI brain command is added without a declared Rails integration class.
- Polluted test captures do not appear in exported events, interests, health recommendations, or retrieval.
- Rails composition never executes targeted retrieval from `GET /`; it happens only in background composition.
- The existing provider snapshot, state budget, reference registry, validator, and surface activation boundaries remain intact.
