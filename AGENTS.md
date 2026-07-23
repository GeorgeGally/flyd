# flyd — agent reference

## Repository workflow

- `main` is the working branch and source of truth.
- Do not leave completed work only on feature branches, PR branches, or temporary worktrees.
- If a requested change exists off `main`, fast-forward or otherwise land it on `main` before reporting completion.
- If local `main` is stale, dirty, or otherwise not the correct state, preserve any uncommitted work and make `main` match the correct source of truth.

## Product architecture

**Flyd has no primary interface. It has a primary presence.**

Flyd Core is the intelligence runtime — now implemented in TypeScript (`cli/`). Swift (`mac-adapter/`) is the thin native OS adapter/presence layer that captures environment, renders UI, and executes operations. Rails (`flyd/`) remains as the optional composed-surface renderer and legacy subsystem.

### Interaction modes

| Mode | Trigger | Description |
|------|---------|-------------|
| PRESENT | Always on | OS notification-based foreground observation. No cognition, no network, no persistence. |
| INVOKED (text) | ⌃⌥ tap | One-shot text invocation. Intent field → resolution → native/augment/compose. |
| INVOKED (voice) | ⌃⌥ hold (>300ms) | Push-to-talk → `gpt-realtime-whisper` transcription → same `/manifest` pipeline. |
| LIVE | Ctrl×3 (triple-press) | Persistent realtime voice session with `gpt-realtime-2.1`. Tool calling routes through Core safety. Ctrl×3 again to exit. |
| DELEGATED | Explicit task creation | Coding/research agents with context envelopes, grant boundaries. |
| COMPOSED | Escalation from INVOKED/LIVE | Flyd creates a full surface. Only when existing interfaces can't express the problem. |

**Voice is a modality. LIVE is a consciousness/runtime state.**

### Architecture

```
Swift macOS adapter (thin OS driver)
    ├── PRESENT: NSWorkspace + AXObserver — observation only
    ├── INVOKED text/voice: environment capture → local WS relay → TypeScript Core
    ├── LIVE: audio I/O → local WS relay → TypeScript Core → OpenAI Realtime
    └── Execution: NativeExecutor (AX refs + fingerprint verification)

TypeScript Core (intelligence, memory, resolution)
    ├── HTTP server :4815 — manifest, learnings, health
    ├── Transcription WS :4816 — gpt-realtime-whisper relay
    ├── Realtime WS :4817 — gpt-realtime-2.1 session + tool relay
    ├── Memory: memory-gate → memory-receipt → belief/behaviour stores
    └── Delegation: intent pattern matching → capability envelope

Rails (legacy composition, optional)
    └── Surface rendering, existing subsystems — not the intelligence core
```

### Privacy invariants (enforced in code)

11 falsifiable constraints — see `mac-adapter/Sources/Privacy/PrivacyInvariants.swift` for the canonical list. Key guarantees: no screenshots in PRESENT, no environment persistence after invocation, no raw audio storage, mic only during explicit user action.

Guardrails:
- Do not introduce project-first or conversation-first primary navigation.
- Do not make stored records visible merely because they exist.
- Homepage work must flow through persisted `Surface` records composed by `Flyd::Intelligence`.
- `GET /` must never call an LLM or execute provider refresh work synchronously.
- New overlay logic must not default to Rails.
- Provider output is evidence supplied to Flyd, never direct UI instructions.
- The Swift adapter never decides what to do — all intelligence routes through TypeScript Core.

## Structure

```
flyd/                    # Rails 8 + Hotwire intelligence surface
  app/                   Rails application and intelligence interfaces
  bin/rails              Rails CLI
  config/                App configuration
  db/                    Database schema and migrations
  lib/                   LLM providers, subsystems, utilities
  test/                  Test suite

  docs/solutions/         Documented solutions to past problems (bugs, best practices,
                          workflow patterns) with YAML frontmatter (module, tags, problem_type)

  cli/                   TypeScript personal-agent harness and memory services
    src/runtime/         Tasks, planning, routing, workers, controls, verification, and recovery
    src/export-state.ts  Versioned intelligence-state export
    package.json         npm dependencies and CLI commands

  mac-adapter/           Swift Mac overlay adapter (thin OS driver — capture, render, execute)
    Sources/             Agent, state machine, privacy, permissions, environment, capture,
                         execution, bridge, UI, audit, auth, config
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
cd cli && npm run dev -- task acceptance
cd cli && npm run dev -- task acceptance review memory passed "review note"
cd cli && npm run dev -- task acceptance review rationale passed "review note"
cd cli && npm run dev -- task acceptance verify
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
- `cli/src/runtime/flyd-worker-adapter.ts` — Flyd-native worker process boundary
- `cli/src/runtime/flyd-worker-loop.ts` — resumable model/tool execution loop
- `cli/src/runtime/flyd-worker-tools.ts` — grant-scoped repository, command, and network tools
- `cli/src/runtime/flyd-worker-config.ts` — configured model/provider resolution
- `cli/src/runtime/repository-roots.ts` — explicit multi-repository grant discovery
- `cli/src/runtime/verification-commands.ts` — repository-derived independent verification commands
- `cli/src/runtime/task-store.ts` — PostgreSQL task, grant, worker, event, and session authority
- `cli/src/runtime/archive-outbox.ts` — idempotent runtime outcome delivery into `~/.flyd/raw`
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
- The native worker currently uses an OpenAI-compatible chat-completions provider; broader provider protocols still need first-class support.
- Additional repositories are grant-scoped context; each repository that needs edits requires its own isolated assignment and integration boundary.
- The local propagation target is below two seconds, but production latency still needs measurement under the Release 1C dogfood window.
