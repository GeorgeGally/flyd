# flyd — agent reference

## Product architecture

**The interface is the intelligence expressed.**

Flyd is the intelligence. The default experience is an intelligence-generated `Surface`. Projects, conversations, messages, decisions, beliefs, and behaviours are evidence and persistence structures, not the product.

Guardrails:

- Do not introduce project-first or conversation-first primary navigation.
- Do not make database entities visible merely because they exist.
- Homepage work must flow through `Flyd::Intelligence`.
- Retrieval, scoring, rules, and validation may support Flyd; they must not replace Flyd's judgment about what the user should experience.
- Chat is one renderer within a surface, never the application shell.
- Global input should be interpreted before context is persisted. Project selection is a correction mechanism, not a prerequisite for thought.
- Layout semantics belong to Flyd's surface composition; renderers only present the plan.
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
- `app/services/flyd/intelligence.rb` — Flyd's surface-composition boundary
- `app/services/context_resolver.rb` — temporary context-routing support
- `app/services/surface/planner.rb` — compatibility delegate only; contains no intelligence
- `config/flyd.yml` — app configuration
- `lib/llm/provider.rb` — LLM provider abstraction
- `lib/subsystems/` — memory, belief, and behaviour evidence systems
- `app/jobs/` — background jobs for streaming, extraction, synthesis, and builds

## Known Issues

- QMD sidecar (`qmd-sidecar/`) does not exist — search-dependent features return empty
- Proactive CLI intelligence is not yet included in the Rails state snapshot
- Surface composition is synchronous and not yet cached or persisted
- The current context resolver still assumes project-shaped persistence after interpretation
