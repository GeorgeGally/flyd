# flyd — agent reference

## Structure

```
flyd/                    # Rails 8 + Hotwire chat portal (active development)
  app/                   Rails application code
  bin/rails              Rails CLI
  config/                App configuration
  db/                    Database schema and migrations
  lib/                   LLM providers, subsystems, utilities
  test/                  Test suite (Rails)

  cli/                   Original TypeScript CLI (maintenance mode)
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

- `config/flyd.yml` — app configuration (models, directories, backup)
- `lib/llm/provider.rb` — LLM provider abstraction (OpenAI/Anthropic)
- `lib/subsystems/` — MemoryEngine, BeliefEngine, BehaviourEngine
- `app/jobs/` — Sidekiq background jobs (streaming, extraction, synthesis, builds)

## Known Issues

- QMD sidecar (`qmd-sidecar/`) does not exist — search-dependent features return empty
- LLM extraction, synthesis, and builds use `Llm::Chat` which calls the configured extraction model
