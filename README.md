# Flyd

Flyd is a personal agent platform. Its first product is a repository-aware coding harness that preserves the intended outcome, relevant memory, permissions, worker state, corrections, verification, and exact re-entry point across sessions.

## Release 1B: supervised coding harness

Prerequisites: PostgreSQL, Node 20+, Ruby 3.2+, Codex CLI 0.144.x, and OpenCode 1.17.x.

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
flyd task workers
flyd task stop <worker-key>
flyd task retry <worker-key>
flyd task redirect <worker-key> "focus on the failing test"
flyd task replace <worker-key>
flyd task list
flyd task metrics
flyd task complete
flyd task escape "needed to compare Codex"
flyd dashboard
```

Release 1B turns the intended outcome into one or two bounded assignments, routes each assignment by capability to a healthy Codex or OpenCode adapter, and permits two isolated workers with a four-run budget. Editing happens under `~/.flyd/runtime/worktrees`; a worker process remains paused until its identity is journaled. The task grant names the repository, managed worktree root, adapters, commands, file operations, verification, renewal boundaries, concurrency, run budget, 90-minute limit, and eight-hour expiry.

Codex runs with strict config, workspace-write sandboxing, network disabled, and a sanitized environment. OpenCode uses a deny-by-default permission policy that blocks external directories, network tools, subagents, ungranted commands, and inherited credentials. Flyd can automatically retry one failed verification or replace a failed worker only while the approved budget and scope still allow it. Destructive operations, external writes, deployment, publication, purchases, secrets, permission changes, repository drift, and scope expansion return to the user.

Worker output is evidence, not proof. Flyd independently captures each patch, changed-file set, command result, and digest. It rejects overlapping assignments, verifies the combined result in a temporary integration worktree, rechecks that `main` is clean and unchanged, and only then applies the verified patch. PostgreSQL rejects completion until every planned assignment is integrated and the user confirms the repository result.

If the `codex` command in `PATH` is broken, Flyd also checks the Codex desktop executable at `/Applications/Codex.app/Contents/Resources/codex`. Set `FLYD_CODEX_PATH` or `FLYD_OPENCODE_PATH` to an exact supported executable when needed. An unsupported version fails closed instead of running an untested adapter.

The five-working-day control trial begins with real worker activity. A measured resume is the same unresolved task reopened at least 30 minutes after the prior session. `flyd task metrics` reports routed assignments, adapter use, accepted evidence-backed interventions, controls, integration conflicts, permission renewals, verified integrations, manual context transfer, completion, and tool escape. Missing evidence is reported as missing.

## Rails surface

```bash
redis-server &
bundle exec sidekiq &
bin/rails server
```

Visit <http://localhost:3000>. Rails is the intelligence-generated surface foundation. Shared coding-task control and live parity remain the Release 1C gate; the web app is not represented as equivalent to the Release 1B CLI yet.

## Stack

- Rails 8 + Hotwire
- PostgreSQL + Redis/Sidekiq
- TypeScript + Commander
- Codex and OpenCode worker adapters
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
