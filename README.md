# Flyd

Flyd is a personal agent platform. Its first product is a persistent conversational and coding agent that shares memory, task state, permissions, corrections, and outcomes across CLI and Rails.

## Release 1C: shared coding agent

Prerequisites: PostgreSQL, Node 20+, Ruby 3.4+, Codex CLI 0.144.x or 0.145.0-alpha.x, and OpenCode 1.17.x.

```bash
bin/rails db:prepare
cd cli
npm install
npm run build
npm link
cd ..

flyd
```

With no arguments, `flyd` starts a natural conversation. Completed turns are persisted immediately and a new process can recall the prior session. Flyd combines recent CLI and Rails conversations, decisions, beliefs, behaviours, provider snapshots, raw archive evidence, and curated wiki knowledge. Repository state is used when the conversation concerns coding; `/resume` reopens unfinished coding work.

```bash
flyd
flyd ask "What do you remember about my artwork release?"
flyd ask "Find conceptually related notes" --deep
flyd search "artwork release"
flyd search "conceptually related work" --deep
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

If the `codex` command in `PATH` is broken, Flyd also checks the current ChatGPT desktop executable at `/Applications/ChatGPT.app/Contents/Resources/codex` and the legacy Codex app path. Set `FLYD_CODEX_PATH` or `FLYD_OPENCODE_PATH` to an exact supported executable when needed. An unsupported version fails closed instead of running an untested adapter.

The five-working-day control trial begins with real worker activity. A measured resume is the same unresolved task reopened at least 30 minutes after the prior session. `flyd task metrics` reports routed assignments, adapter use, accepted evidence-backed interventions, controls, integration conflicts, permission renewals, verified integrations, manual context transfer, completion, and tool escape. Missing evidence is reported as missing.

## Rails surface

```bash
redis-server &
bundle exec sidekiq &
bin/rails flyd:runtime_listener &
bin/rails server
```

Visit <http://localhost:3000>. Rails and the CLI read the same PostgreSQL task, grant, assignment, worker, artifact, correction, and event authority. The Rails surface can approve or reject grants, stop, retry, redirect, or replace workers, correct Flyd, inspect verified artifacts, and confirm completion through the same TypeScript command service used by the CLI.

The runtime listener verifies the TypeScript bridge, replays committed task events, pushes worker observations without an LLM call, and keeps an old scene read-only until normal surface recomposition catches up with a semantic phase change. If the listener or bridge is stale, consequential controls remain disabled instead of mutating a second Rails-owned task state.

## Stack

- Rails 8 + Hotwire
- PostgreSQL + Redis/Sidekiq
- TypeScript + Commander
- Codex and OpenCode worker adapters
- OpenAI / Anthropic providers

## Overlay (macOS)

Flyd has a native macOS overlay that provides ambient intelligence — acting inside existing software rather than being a separate destination.

### Architecture

```
Swift macOS adapter (thin OS driver)  ←→  TypeScript Core (intelligence)
    :4815 HTTP — manifest/resolution
    :4816 WS   — gpt-realtime-whisper transcription
    :4817 WS   — gpt-realtime-2.1 LIVE sessions
```

### Shortcuts

| Shortcut | Mode | Description |
|----------|------|-------------|
| ⌃⌥ tap | INVOKED (text) | Type an intent, press Enter. Flyd resolves it into operations. |
| ⌃⌥ hold (>300ms) | INVOKED (voice) | Push-to-talk. `gpt-realtime-whisper` transcribes. Same resolution pipeline. |
| Ctrl×3 | LIVE | Persistent realtime voice session with `gpt-realtime-2.1`. Ctrl×3 again to exit. |

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLYD_MODEL` | `gpt-4o-mini` | Resolution LLM model |
| `FLYD_TRANSCRIPTION_MODEL` | `gpt-realtime-whisper` | Voice transcription model |
| `FLYD_REALTIME_MODEL` | `gpt-realtime-2.1` | LIVE session model |
| `FLYD_MODEL_API_KEY` | (from env) | OpenAI API key |
| `FLYD_CLI_DIR` | (auto-detected) | Path to cli/ directory |

### Build & run

```bash
cd mac-adapter && swift build
# Start TypeScript Core:
cd cli && npm run core
# In another terminal, run the Mac adapter:
cd mac-adapter && swift run
```

A menu bar dot indicates state: grey (PRESENT), blue (INVOKED), green (LIVE), red (error).

### Safety

All operations go through TypeScript Core's `resolve()` → `validateResolution()` pipeline. Execution is grounded in per-invocation AX element refs with fingerprint verification. The same safety gates apply to text, voice, and LIVE.

### Privacy

11 falsifiable invariants enforced in code. PRESENT never captures, transmits, or persists. Raw audio is never stored. Mic is only active during voice INVOKED or LIVE.

## Testing

```bash
bin/rails test
bin/rails test:all
cd cli && npm test
cd cli && npm run lint
cd cli && npm run build
```

The authoritative product definition is `docs/product/flyd-personal-agent-platform-prd.md`.
