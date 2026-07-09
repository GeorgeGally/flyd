# Flyd

Persistent intelligence for software thinking and building. Chat with an LLM that remembers decisions, beliefs, and behaviours across sessions.

## Quick Start

```bash
# Start Redis (background jobs)
redis-server &

# Start Sidekiq (job processing)
bundle exec sidekiq &

# Start Rails
bin/rails server
```

Visit http://localhost:3000. First run will prompt for API keys.

## What it does

- **Chat** — persistent conversations per project with real-time LLM streaming
- **Memory** — extracts decisions from conversations every 5 messages
- **Beliefs** — synthesizes beliefs from decisions, detects contradictions
- **Behaviours** — learns recurring decision patterns
- **Context injection** — the LLM sees relevant decisions, beliefs, and matching behaviour patterns on every message
- **Build execution** — runs `opencode` via subprocess for code tasks (WIP)

## Stack

- Rails 8 + Hotwire (Turbo + Stimulus + ActionCable)
- PostgreSQL + Redis (via Sidekiq)
- OpenAI / Anthropic LLM providers

## CLI

The original TypeScript CLI lives in `cli/`. Run its tests with `cd cli && npm test`.

## Testing

```bash
bin/rails test            # Rails model/controller/job tests
bin/rails test:all        # include system tests
cd cli && npm test        # TypeScript CLI tests
```
