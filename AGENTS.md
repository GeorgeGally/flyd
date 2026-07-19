# flyd — agent reference

## Repository workflow

- `main` is the working branch and source of truth.
- Do not leave completed work only on feature branches, PR branches, or temporary worktrees.
- If a requested change exists off `main`, fast-forward or otherwise land it on `main` before reporting completion.
- If local `main` is stale, dirty, or otherwise not the correct state, preserve any uncommitted work and make `main` match the correct source of truth.

## Product architecture

**The interface is the intelligence expressed.**

Flyd is the intelligence. The default experience is an intelligence-generated `Surface`. Projects, conversations, messages, decisions, beliefs, behaviours, goals, tensions, curiosity, reports, and events are evidence and persistence structures, not the product.

Guardrails:

- Do not introduce project-first or conversation-first primary navigation.
- Do not make stored records visible merely because they exist.
- Homepage work must flow through persisted `Surface` records composed by `Flyd::Intelligence`.
- `GET /` must never call an LLM or execute provider refresh work synchronously.
- Surface composition, provider refresh, and live broadcast must run through background jobs.
- Retrieval, scoring, rules, and validation may support Flyd; they must not replace Flyd's judgment about what the user should experience.
- External or legacy intelligence sources must implement `IntelligenceState::Provider` and persist shared snapshots in PostgreSQL.
- Provider output is evidence supplied to Flyd, never direct UI instructions.
- Chat is one renderer within a surface, never the application shell.
- Global input should be interpreted before context is persisted. Project selection is a correction mechanism, not a prerequisite for thought.
- Layout semantics belong to Flyd's surface composition; renderers only present the plan.
- New modalities must enter through the universal intent model rather than separate product modes.

See `docs/product/flyd-personal-agent-platform-prd.md` and `docs/architecture/intelligence-generated-interface.md`.

## Structure

```
flyd/                    # Rails 8 + Hotwire intelligence surface
  app/                   Rails application and intelligence interfaces
  bin/rails              Rails CLI
  config/                App configuration
  db/                    Database schema and migrations
  lib/                   LLM providers, subsystems, utilities
  test/                  Test suite

  cli/                   TypeScript personal-agent harness and memory services
    src/runtime/         Tasks, planning, routing, workers, controls, verification, and recovery
    src/export-state.ts  Versioned intelligence-state export
    package.json         npm dependencies and CLI commands
```

## Commands

```bash
bin/rails server                     # Start dev server
bin/rails test                       # Run Rails tests
bin/rails test:all                   # Include system tests
bundle exec sidekiq                  # Run provider, composition, and broadcast jobs
bin/rails flyd:runtime_listener      # Replay runtime events and update live Rails task bindings

cd cli && npm test                   # Run CLI tests
cd cli && npm run dev                # Start/resume the coding harness
cd cli && npm run dev -- code "..."  # Start with an intended outcome
cd cli && npm run dev -- task status # Inspect the exact re-entry point
cd cli && npm run dev -- task workers
cd cli && npm run dev -- task stop <worker-key>
cd cli && npm run dev -- task retry <worker-key>
cd cli && npm run dev -- task redirect <worker-key> "..."
cd cli && npm run dev -- task replace <worker-key>
cd cli && npm run dev -- task metrics
cd cli && npm run build              # Compile dist/export-state.js
cd cli && npm run export-state       # Manual file export
cd cli && npm run export-state -- --stdout
```

## Key Files

- `docs/architecture/intelligence-generated-interface.md` — product architecture and interface contract
- `docs/product/flyd-personal-agent-platform-prd.md` — authoritative personal-agent platform PRD and release sequence
- `app/models/surface.rb` — persisted surface lifecycle and activation
- `app/models/surface_item.rb` — persisted semantic presentation objects
- `app/models/intelligence_snapshot.rb` — shared provider snapshots and health
- `app/services/surfaces/persist_plan.rb` — stores Flyd plans as drafts
- `app/services/flyd/intelligence.rb` — Flyd's surface-composition boundary
- `app/services/intelligence_state/provider.rb` — provider contract
- `app/services/intelligence_state/cli_provider.rb` — PostgreSQL-backed CLI adapter
- `app/services/intelligence_state/cli_query_provider.rb` — targeted shared-archive evidence adapter
- `app/services/intelligence_state/cli_bridge.rb` — JSON-only CLI retrieval boundary
- `app/services/intelligence_state/registry.rb` — provider aggregation
- `lib/flyd/archive_event_writer.rb` — Rails-to-shared-archive event writer
- `app/jobs/refresh_intelligence_state_job.rb` — CLI stdout ingestion
- `app/jobs/archive_event_job.rb` — background Rails event export
- `app/jobs/compose_surface_job.rb` — background composition and activation
- `app/jobs/broadcast_surface_job.rb` — retryable live surface delivery
- `cli/src/export-state.ts` — CLI state producer
- `cli/src/bridge.ts` — targeted retrieval bridge
- `cli/src/lib/brain-retrieval.ts` — shared ask/search/librarian retrieval service
- `cli/src/runtime/harness.ts` — continuity, interpretation, grant, and user-confirmation boundary
- `cli/src/runtime/assignment-planner.ts` — bounded one-or-two assignment planning
- `cli/src/runtime/orchestrator.ts` — capability routing, lifecycle, intervention, verification, and integration
- `cli/src/runtime/codex-adapter.ts` — pinned strict Codex worker adapter
- `cli/src/runtime/task-store.ts` — PostgreSQL task, grant, worker, event, and session authority
- `cli/src/runtime/archive-outbox.ts` — idempotent runtime outcome delivery into `~/.flyd/raw`
- `cli/src/runtime/opencode-adapter.ts` — structured OpenCode worker adapter
- `cli/src/runtime/worktree-manager.ts` — Flyd-managed assignment isolation
- `cli/src/runtime/result-verifier.ts` — independent patch and command evidence
- `cli/src/runtime/result-integrator.ts` — unchanged-main integration boundary
- `cli/src/runtime/worker-controller.ts` — durable stop, retry, redirect, and replace controls
- `cli/src/runtime/recovery.ts` — stale-process reconciliation on restart
- `app/models/agent_task.rb` — canonical coding task state
- `app/models/task_grant.rb` — approved worker scope and lifecycle
- `app/models/worker_session.rb` — durable worker process/session state
- `app/models/runtime_event.rb` — transactional task event journal
- `app/models/task_artifact.rb` — immutable verified runtime artifacts
- `app/models/task_correction.rb` — user-authoritative task corrections
- `app/services/agent_runtime/event_listener.rb` — leased PostgreSQL notification replay
- `app/jobs/broadcast_runtime_observation_job.rb` — high-frequency worker activity delivery without recomposition
- `app/services/runtime_tasks/action_executor.rb` — Rails-to-runtime command boundary
- `app/services/runtime_tasks/binding_presenter.rb` — revision-safe task scene binding
- `app/services/context_resolver.rb` — temporary context-routing support
- `app/services/surface/planner.rb` — compatibility delegate only; contains no intelligence
- `config/flyd.yml` — app configuration
- `lib/llm/provider.rb` — LLM provider abstraction
- `lib/subsystems/` — memory, belief, and behaviour evidence systems

## Known Issues

- World state is bounded by serialized character count, not model-specific tokens.
- Large archive queries can be slow while the local QMD index or embedding model warms up.
- Production web and worker processes must share the configured `FLYD_DIR` volume for Rails-to-CLI memory parity.
- The current context resolver still assumes project-shaped persistence after interpretation.
- Codex adapter support is pinned to 0.144.x and 0.145.0-alpha.x, and OpenCode to 1.17.x; other versions fail closed until tested.
- The local propagation target is below two seconds, but production latency still needs measurement under the Release 1C dogfood window.
