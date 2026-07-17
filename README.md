# Flyd

Flyd is a personal agent platform. Its first product is a repository-aware coding harness that preserves the intended outcome, relevant memory, permissions, worker state, corrections, verification, and exact re-entry point across sessions.

## Release 1A: coding harness

Prerequisites: PostgreSQL, Node 18+, Ruby 3.2+, and OpenCode 1.17.x.

```bash
bin/rails db:prepare
cd cli
npm install
npm run build
npm link
cd ..

flyd
```

Run `flyd` from a Git repository. With no arguments it starts or resumes the repository's unfinished task. Flyd observes current Git state, retrieves relevant project and personal evidence, presents its interpretation, and asks for one repository-scoped task grant before starting OpenCode.

```bash
flyd code "Fix the failing intent flow"
flyd task status
flyd task list
flyd task metrics
flyd task complete
flyd task escape "needed to compare Codex"
flyd dashboard
```

Release 1A uses one OpenCode worker directly in the approved repository. The task grant names the provider, repository, command and file scope, automatic verification, renewal-required actions, one-worker concurrency, three-run budget, 90-minute run limit, and eight-hour expiry. Flyd applies a deny-by-default OpenCode policy that blocks external directories, network tools, subagents, ungranted commands, and inherited credentials. The worker is paused until its process identity is journaled.

OpenCode output is evidence, not proof: Flyd re-inspects the repository and requires user confirmation before recording completion, and PostgreSQL rejects completion without a successful worker and repository verification. Corrections, tool escapes, and verified outcomes are delivered idempotently from the event outbox to `~/.flyd/raw`. If Flyd or OpenCode stops, the next run reconciles the worker as interrupted and resumes its exact OpenCode session from durable task state.

The five-working-day continuity trial begins after the first real interrupted task completes. A measured resume is the same unresolved task reopened at least 30 minutes after the prior session; `flyd task metrics` reports resumed sessions without context restatement, interpretation, verified completion, and manual tool-escape evidence.

## Rails surface

```bash
redis-server &
bundle exec sidekiq &
bin/rails server
```

Visit <http://localhost:3000>. Rails is the intelligence-generated surface foundation. Shared coding-task control arrives in Release 1C; it is not presented as parity in Release 1A.

## Stack

- Rails 8 + Hotwire
- PostgreSQL + Redis/Sidekiq
- TypeScript + Commander
- OpenCode worker adapter
- OpenAI / Anthropic providers

## Testing

```bash
bin/rails test
bin/rails test:all
cd cli && npm test
cd cli && npm run lint
cd cli && npm run build
```

The authoritative product definition is `docs/product/flyd-personal-agent-platform-prd.md`.
