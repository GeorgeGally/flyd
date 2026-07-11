# flyd — agent reference

## Product architecture

**The interface is the intelligence expressed.**

The default experience is an intelligence-generated `Surface`. Projects, conversations, messages, decisions, beliefs, and behaviours are internal context and persistence models.

Guardrails:

- Do not introduce project-first or conversation-first primary navigation.
- Do not make database entities visible merely because they exist.
- Homepage work must flow through `Surface::Planner` or its successor.
- Chat is a renderer within a surface, never the application shell.
- Global input must resolve context automatically. Project selection is a correction mechanism.
- Layout semantics belong to intelligence planning; renderers only present them.
- New modalities must enter through the universal intent model rather than separate product modes.

See `docs/architecture/intelligence-generated-interface.md`.

## Structure

```
flyd/                    # Rails 8 + Hotwire intelligence surface (active development)
  app/                   Rails application code
  bin/rails              Rails CLI
  config/                App configuration
  db/                    Database schema and migrations
  lib/                   LLM providers, subsystems, utilities
  test/                  Test suite (Rails)

  cli/                   Original TypeScript intelligence CLI (maintenance mode)
    src/                 TypeScript source
    package.json         npm dependencies
```

## Commands

```bash
bin/rails server       # Start dev server
bin/rails test         # Run Rails tests
bin/rails test:all     # Include system tests
bundle exec sidekiq    # Start job processor

cd cli && npm test     # Run CLI tests (maintenance)
cd cli && npm run dev  # Run CLI directly
```

## Key Files

- `docs/architecture/intelligence-generated-interface.md` — product architecture and UI constraints
- `app/services/surface/planner.rb` — semantic surface planning
- `app/services/context_resolver.rb` — automatic context inference
- `config/flyd.yml` — app configuration (models, directories, backup)
- `lib/llm/provider.rb` — LLM provider abstraction (OpenAI/Anthropic)
- `lib/subsystems/` — MemoryEngine, BeliefEngine, BehaviourEngine
- `app/jobs/` — Sidekiq background jobs (streaming, extraction, synthesis, builds)

## Known Issues

- QMD sidecar (`qmd-sidecar/`) does not exist — search-dependent features return empty
- Proactive CLI intelligence is not yet connected to the Rails surface planner
- LLM extraction, synthesis, and builds use `Llm::Chat` which calls the configured extraction model
