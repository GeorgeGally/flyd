# Flyd Release 1A Continuity Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make `flyd` the durable, repository-aware entry point for starting and resuming one OpenCode coding task.

**Architecture:** PostgreSQL remains authoritative for live tasks, grants, sessions, workers, and runtime events. The TypeScript CLI loads an in-process runtime over that store for Release 1A, while `~/.flyd` remains the memory evidence source. The harness composes deterministic orientation from current Git state, the unfinished task, and shared Flyd retrieval; it requires a bounded task grant before launching the existing OpenCode command shape and persists every transition for restart recovery.

**Tech Stack:** Rails 8, PostgreSQL, TypeScript, Commander, node-postgres, Node child processes, Vitest, Minitest.

---

### Task 1: Add authoritative coding-task records

**Files:**
- Create: `db/migrate/20260717090000_create_agent_runtime_records.rb`
- Create: `app/models/agent_task.rb`
- Create: `app/models/task_grant.rb`
- Create: `app/models/worker_session.rb`
- Create: `app/models/task_session.rb`
- Create: `app/models/runtime_event.rb`
- Modify: `app/models/project.rb`
- Test: `test/models/agent_task_test.rb`
- Test: `test/models/task_grant_test.rb`
- Test: `test/models/worker_session_test.rb`
- Test: `test/models/runtime_event_test.rb`

- [x] Write failing model tests for one active task per project, task lifecycle, task-grant scope and expiry, worker lifecycle, resumed session classification, and idempotent runtime events.
- [x] Run the focused Rails model tests and verify missing constants/tables fail.
- [x] Add the migration with database constraints and indexes for stable UUID keys, statuses, project ownership, task revisions, idempotency keys, and timestamps.
- [x] Add small Active Record models whose transition methods fail closed and increment task revisions.
- [x] Run the migration and focused model tests.

### Task 2: Add the TypeScript PostgreSQL runtime store

**Files:**
- Modify: `cli/package.json`
- Modify: `cli/package-lock.json`
- Create: `cli/src/runtime/types.ts`
- Create: `cli/src/runtime/database.ts`
- Create: `cli/src/runtime/task-store.ts`
- Create: `cli/src/runtime/__tests__/task-store.test.ts`

- [x] Add failing tests for project upsert, resumable-task lookup, transactional task/event creation, grant activation, session start/end, worker transitions, completion, correction, and optimistic revision conflicts.
- [x] Install `pg` and `@types/pg`; configure `Pool` from `DATABASE_URL` or the local `flyd_v1_development` database and close it cleanly.
- [x] Implement a parameterized-query store with one checked-out client for every multi-record transaction.
- [x] Preserve task and grant authority when archive export or memory retrieval is unavailable.
- [x] Run focused Vitest tests, TypeScript lint, and a real development-database smoke query.

### Task 3: Build repository-aware orientation

**Files:**
- Create: `cli/src/runtime/repository-inspector.ts`
- Create: `cli/src/runtime/orientation.ts`
- Create: `cli/src/runtime/context-package.ts`
- Create: `cli/src/runtime/__tests__/repository-inspector.test.ts`
- Create: `cli/src/runtime/__tests__/orientation.test.ts`
- Create: `cli/src/runtime/__tests__/context-package.test.ts`

- [x] Write failing tests for Git root/branch/HEAD/status inspection, no-repository failure, unchanged resume, changed repository resume, stale memory labeling, and bounded context packages with provenance.
- [x] Implement Git inspection with structured argument arrays and exact status digests.
- [x] Combine the active task, last worker/session, current repository state, and `retrieveBrainEvidence` matches into a concise orientation object.
- [x] Build a bounded Markdown context file that separates current repository observations, confirmed task state, and memory evidence.
- [x] Run the focused tests and lint.

### Task 4: Implement the approved OpenCode worker

**Files:**
- Create: `cli/src/runtime/opencode-adapter.ts`
- Create: `cli/src/runtime/__tests__/opencode-adapter.test.ts`
- Modify: `app/jobs/opencode_build_job.rb`
- Test: `test/jobs/opencode_build_job_test.rb`

- [x] Write failing TypeScript tests for version discovery, structured argv, sanitized environment, streamed JSON text, non-zero exit, interruption, and timeout.
- [x] Write a failing Rails regression test that locks the same OpenCode argv and output semantics used by the harness.
- [x] Implement the adapter with `opencode run <outcome> -f <context> --auto --format json`, an approved repository cwd, bounded timeout, and durable worker/event callbacks.
- [x] Extract or document the shared command contract so Rails and CLI cannot silently diverge.
- [x] Run focused TypeScript and Rails tests.

### Task 5: Make `flyd` the interactive continuity harness

**Files:**
- Create: `cli/src/commands/code.ts`
- Create: `cli/src/runtime/harness.ts`
- Create: `cli/src/runtime/terminal.ts`
- Create: `cli/src/runtime/__tests__/harness.test.ts`
- Modify: `cli/src/index.ts`

- [x] Write failing tests for no-task startup, task resumption, interpretation correction, grant rejection, approved worker launch, interrupted worker persistence, completion confirmation, and non-interactive failure.
- [x] Change no-argument `flyd` to start the coding harness and add explicit `flyd code [outcome]`; retain the old suggestion view as `flyd dashboard`.
- [x] Render orientation, action/grant, monitoring, review, and completion states without turning the terminal into a transcript dump.
- [x] Require task-grant approval before the first worker and persist correction, session, worker, and completion events.
- [x] On completion, capture post-run repository state and require user confirmation before promoting the verified outcome.
- [x] Run focused tests, all CLI tests, lint, and build.

### Task 6: Prove restart recovery and dogfood measurement

**Files:**
- Create: `cli/src/commands/task.ts`
- Create: `cli/src/runtime/metrics.ts`
- Create: `cli/src/runtime/__tests__/metrics.test.ts`
- Create: `cli/src/commands/__tests__/task.test.ts`
- Modify: `cli/src/index.ts`
- Modify: `AGENTS.md`
- Modify: `docs/architecture/intelligence-surface-foundation.md`

- [x] Write failing tests for task list/status, stale running-worker recovery, resumed-session classification, interpretation acceptance/correction, verified completion, and manual tool escape recording.
- [x] Add `flyd task list`, `flyd task status`, `flyd task resume`, and `flyd task complete` as deterministic recovery and inspection commands.
- [x] Reconcile running workers whose process no longer exists as interrupted while keeping the task active.
- [x] Compute the Release 1A five-day metrics from PostgreSQL without inventing success from missing data.
- [x] Document setup, migration, first run, task-grant behavior, and the fact that Release 1A directly edits the approved single repository while later parallel workers use managed worktrees.
- [x] Run the real Journey 1 smoke test across two CLI processes and a runtime restart.

### Task 7: Verify and land Release 1A

**Files:**
- Modify: `CHANGELOG.md` if present
- Modify: `VERSION` if present

- [x] Run `bin/rails db:migrate`.
- [x] Run all focused Rails and CLI tests from the tasks above.
- [x] Run `bin/rails test`.
- [x] Run `cd cli && npm test && npm run lint && npm run build`.
- [x] Run `bundle exec rubocop` and `bundle exec brakeman --no-pager`.
- [x] Run `git diff --check` and inspect the final diff for scope drift, secret exposure, unsafe shell interpolation, and duplicated state authority.
- [x] Exercise `flyd task status` against the development database and confirm the checkout remains on clean, pushed `main`.
