# flyd — agent reference

## Product architecture

**The interface is the intelligence expressed.**

Flyd is the intelligence. The default experience is an intelligence-generated `Surface`. Projects, conversations, messages, decisions, beliefs, behaviours, goals, tensions, curiosity, reports, and events are evidence and persistence structures, not the product.

Guardrails:

- Do not introduce project-first or conversation-first primary navigation.
- Do not make stored records visible merely because they exist.
- Homepage work must flow through `Flyd::Intelligence`.
- Retrieval, scoring, rules, and validation may support Flyd; they must not replace Flyd's judgment about what the user should experience.
- External or legacy intelligence sources must implement `IntelligenceState::Provider`.
- Provider output is evidence supplied to Flyd, never direct UI instructions.
- Chat is one renderer within a surface, never the application shell.
- Global input should be interpreted before context is persisted. Project selection is a correction mechanism, not a prerequisite for thought.
- Layout semantics belong to Flyd's surface composition; renderers only present the plan.
- New modalities must enter through the universal intent model rather than separate product modes.

See `docs/architecture/intelligence-generated-interface.md`.

## Structure

```
flyd/                    # Rails 8 + Hotwire intelligence surface
  app/                   Rails application and intelligence interfaces
  bin/rails              Rails CLI
  config/                App configuration
  db/                    Database schema and migrations
  lib/                   LLM providers, subsystems, utilities
  test/                  Test suite

  cli/                   TypeScript memory and proactive-analysis producer
    src/export-state.ts  Versioned intelligence-state export
    package.json         npm dependencies and export command
```

## Commands

```bash
bin/rails server                     # Start dev server
bin/rails test                       # Run Rails tests
bin/rails test:all                   # Include system tests
bundle exec sidekiq                  # Start job processor

cd cli && npm test                   # Run CLI tests
cd cli && npm run dev                # Run CLI directly
cd cli && npm run export-state       # Write ~/.flyd/intelligence-state.json
cd cli && npm run export-state -- --stdout
```

## Key Files

- `docs/architecture/intelligence-generated-interface.md` — product architecture and interface contract
- `app/services/flyd/intelligence.rb` — Flyd's surface-composition boundary
- `app/services/intelligence_state/provider.rb` — provider contract
- `app/services/intelligence_state/cli_provider.rb` — versioned CLI adapter and automatic refresh
- `app/services/intelligence_state/registry.rb` — provider aggregation
- `cli/src/export-state.ts` — CLI state producer
- `app/services/context_resolver.rb` — temporary context-routing support
- `app/services/surface/planner.rb` — compatibility delegate only; contains no intelligence
- `config/flyd.yml` — app configuration
- `lib/llm/provider.rb` — LLM provider abstraction
- `lib/subsystems/` — memory, belief, and behaviour evidence systems

## Known Issues

- QMD sidecar (`qmd-sidecar/`) does not exist — search-dependent features return empty
- Surface composition is synchronous and not yet cached or persisted
- CLI export refresh currently shells out to npm and should move to a background refresh process
- The current context resolver still assumes project-shaped persistence after interpretation
