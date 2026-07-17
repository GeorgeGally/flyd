# Flyd Release 1B Agent Control and Initiative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Release 1A continuity harness into a supervised Codex/OpenCode runtime that can plan bounded assignments, route and control workers, work safely in parallel, intervene on failures, verify results, and integrate accepted work onto `main`.

**Architecture:** PostgreSQL remains authoritative for tasks, grants, assignments, workers, controls, and interventions. A provider-neutral TypeScript orchestration layer discovers pinned local adapters, plans one or two bounded assignments, runs every editing worker in a Flyd-managed Git worktree, and verifies results independently. Integration first proves the combined result in a temporary integration worktree, then applies the same verified patch to an unchanged clean `main`; stale or conflicting results remain inspectable and blocked.

**Tech Stack:** Rails 8, PostgreSQL JSONB and partial indexes, TypeScript, Node child processes, Git worktrees, Vitest, Minitest, Codex CLI JSONL, OpenCode JSON output.

---

### Task 1: Persist assignments and worker controls

**Files:**
- Create: `db/migrate/20260717130000_add_release_1b_orchestration.rb`
- Create: `app/models/task_assignment.rb`
- Create: `app/models/worker_command.rb`
- Create: `test/models/task_assignment_test.rb`
- Create: `test/models/worker_command_test.rb`
- Modify: `app/models/agent_task.rb`
- Modify: `app/models/worker_session.rb`
- Modify: `test/models/worker_session_test.rb`

- [x] **Step 1: Write failing model tests**

  Cover assignment status, dependency shape, revision, one live worker per assignment, command kinds, idempotency keys, and task/grant ownership.

- [x] **Step 2: Verify the tests fail**

  Run: `bin/rails test test/models/task_assignment_test.rb test/models/worker_command_test.rb test/models/worker_session_test.rb`

  Expected: missing tables or constants.

- [x] **Step 3: Add the Release 1B schema**

  Add `task_assignments` with durable instructions, success criteria, capability requirements, dependency keys, worktree/branch/base-head data, verification and integration results, and revision. Add `worker_commands` with `stop`, `retry`, `redirect`, and `replace` kinds, payload, status, idempotency key, and timestamps. Link workers to assignments, add capability and heartbeat data, remove the Release 1A one-live-worker-per-task index, and replace it with one-live-worker-per-assignment.

- [x] **Step 4: Implement model invariants**

  Keep models as read-only Rails projections after persistence, validate task ownership, and ensure commands target workers from the same task.

- [x] **Step 5: Run migration and model tests**

  Run: `bin/rails db:migrate && bin/rails test test/models/task_assignment_test.rb test/models/worker_command_test.rb test/models/worker_session_test.rb`

  Expected: all pass.

### Task 2: Introduce the provider-neutral adapter contract and Codex adapter

**Files:**
- Create: `cli/src/runtime/worker-adapter.ts`
- Create: `cli/src/runtime/codex-adapter.ts`
- Create: `cli/src/runtime/__tests__/codex-adapter.test.ts`
- Create: `cli/src/runtime/__tests__/worker-adapter.test.ts`
- Modify: `cli/src/runtime/opencode-adapter.ts`
- Modify: `cli/src/runtime/__tests__/opencode-adapter.test.ts`
- Modify: `cli/src/runtime/types.ts`

- [x] **Step 1: Write failing adapter contract tests**

  Require health and capability discovery, tested version ranges, structured argument arrays, JSONL session extraction, bounded stop behavior, sanitized environment, and exact-session resume.

- [x] **Step 2: Verify the tests fail**

  Run: `cd cli && npm test -- src/runtime/__tests__/worker-adapter.test.ts src/runtime/__tests__/codex-adapter.test.ts`

  Expected: missing adapter modules and contract.

- [x] **Step 3: Define the shared contract**

  Define `capabilities`, `detect`, `start`, `observe`, `stop`, and `resume` data shapes. Keep process execution shared while provider argument and event parsing stay adapter-specific.

- [x] **Step 4: Implement Codex**

  Use `codex exec --json` with `workspace-write`, no interactive approval, network disabled, a Flyd-managed worktree, and minimum context. Parse `thread.started` for the durable Codex thread ID and resume only that ID. Fail closed when the executable is broken or outside the tested range.

- [x] **Step 5: Adapt OpenCode without changing its 1A security boundary**

  Wrap the existing OpenCode implementation in the shared contract and retain its deny-by-default permission map, process journaling pause, timeout, and exact-session resume.

- [x] **Step 6: Run adapter tests**

  Run: `cd cli && npm test -- src/runtime/__tests__/worker-adapter.test.ts src/runtime/__tests__/codex-adapter.test.ts src/runtime/__tests__/opencode-adapter.test.ts`

  Expected: all pass.

### Task 3: Plan assignments and route by capability

**Files:**
- Create: `cli/src/runtime/assignment-planner.ts`
- Create: `cli/src/runtime/worker-router.ts`
- Create: `cli/src/runtime/__tests__/assignment-planner.test.ts`
- Create: `cli/src/runtime/__tests__/worker-router.test.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Modify: `cli/src/lib/llm.ts`

- [x] **Step 1: Write failing planning, routing, and persistence tests**

  Require one grounded fallback assignment when model planning is unavailable, no more than two editing assignments, explicit dependencies, capability-based routing, load-aware choice, unhealthy-provider exclusion, assignment idempotency, and grant concurrency enforcement.

- [x] **Step 2: Verify the tests fail**

  Run: `cd cli && npm test -- src/runtime/__tests__/assignment-planner.test.ts src/runtime/__tests__/worker-router.test.ts src/runtime/__tests__/task-store.integration.test.ts`

  Expected: missing planner/router APIs.

- [x] **Step 3: Implement a validated Flyd plan**

  Ask the configured Flyd model for strict JSON containing success criteria, verification criteria, and at most two genuinely independent assignments. Reject unknown fields, cycles, empty instructions, overlapping declared file scopes, and unsupported capability names. Fall back to one assignment equal to the user's outcome without fabricating detail.

- [x] **Step 4: Implement capability routing**

  Score healthy adapters by required capabilities and current task load. Prefer the least-loaded capable adapter; use stable tie-breaking so identical state produces the same route. The user supplies an outcome, not a provider name.

- [x] **Step 5: Persist the plan transactionally**

  Store task criteria and assignments with one task revision and idempotent events. Enforce the approved grant's adapters, concurrency, run budget, expiry, and worktree paths under row locks.

- [x] **Step 6: Run planning and store tests**

  Run: `cd cli && npm test -- src/runtime/__tests__/assignment-planner.test.ts src/runtime/__tests__/worker-router.test.ts src/runtime/__tests__/task-store.integration.test.ts`

  Expected: all pass.

### Task 4: Isolate, verify, and integrate worker changes

**Files:**
- Create: `cli/src/runtime/worktree-manager.ts`
- Create: `cli/src/runtime/result-verifier.ts`
- Create: `cli/src/runtime/result-integrator.ts`
- Create: `cli/src/runtime/__tests__/worktree-manager.test.ts`
- Create: `cli/src/runtime/__tests__/result-verifier.test.ts`
- Create: `cli/src/runtime/__tests__/result-integrator.test.ts`
- Modify: `cli/src/runtime/repository-inspector.ts`

- [x] **Step 1: Write failing Git isolation tests**

  Use temporary repositories to prove deterministic managed paths, assignment branches from the recorded base head, no edits in the source checkout, cleanup, and refusal to reuse an unrelated worktree.

- [x] **Step 2: Write failing verification and integration tests**

  Prove worker text cannot verify completion, verification commands must exit zero, overlapping changed files block integration, changed source HEAD or dirty state blocks integration, and two disjoint verified patches integrate through a temporary integration worktree before touching `main`.

- [x] **Step 3: Verify the tests fail**

  Run: `cd cli && npm test -- src/runtime/__tests__/worktree-manager.test.ts src/runtime/__tests__/result-verifier.test.ts src/runtime/__tests__/result-integrator.test.ts`

  Expected: missing worktree, verifier, and integrator modules.

- [x] **Step 4: Implement managed worktrees**

  Store worktrees under `~/.flyd/runtime/worktrees/<task-key>/<assignment-key>`, create branches from the task's recorded base head, and reject paths outside the managed root.

- [x] **Step 5: Implement independent verification**

  Run only grant-approved verification commands with structured shell invocation and bounded timeouts. Record command, exit status, output digest, changed files, resulting head, and observed repository state.

- [x] **Step 6: Implement conflict-safe integration**

  Refuse overlapping files before application. Apply and verify all patches in an integration worktree. Recheck source branch, head, and status digest immediately before applying the verified combined patch to `main`. On any mismatch, leave `main` untouched and return a blocked result with evidence.

- [x] **Step 7: Run isolation tests**

  Run: `cd cli && npm test -- src/runtime/__tests__/worktree-manager.test.ts src/runtime/__tests__/result-verifier.test.ts src/runtime/__tests__/result-integrator.test.ts`

  Expected: all pass.

### Task 5: Add durable stop, retry, redirect, and replacement controls

**Files:**
- Create: `cli/src/runtime/worker-controller.ts`
- Create: `cli/src/runtime/__tests__/worker-controller.test.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Modify: `cli/src/commands/task.ts`
- Modify: `cli/src/index.ts`

- [x] **Step 1: Write failing control tests**

  Cover idempotent commands, graceful then forced process stop, focused redirect incrementing assignment revision, retry preserving context, replacement excluding the failed adapter, and rejection outside an approved unexpired grant.

- [x] **Step 2: Verify the tests fail**

  Run: `cd cli && npm test -- src/runtime/__tests__/worker-controller.test.ts src/runtime/__tests__/task-store.integration.test.ts`

  Expected: missing controller and task commands.

- [x] **Step 3: Persist and execute controls**

  Store the command before signaling a worker. Use `SIGTERM`, then bounded `SIGKILL`; never signal a PID unless executable-path recovery proves identity. Redirect and replacement become a new assignment revision rather than mutating worker history.

- [x] **Step 4: Add CLI controls**

  Add `flyd task workers`, `stop <worker-key>`, `retry <worker-key>`, `redirect <worker-key> <instruction>`, and `replace <worker-key>`. Status output must show assignment, adapter, worktree, revision, last heartbeat, and pending control.

- [x] **Step 5: Run control tests**

  Run: `cd cli && npm test -- src/runtime/__tests__/worker-controller.test.ts src/runtime/__tests__/task-store.integration.test.ts`

  Expected: all pass.

### Task 6: Orchestrate bounded parallel work and safe initiative

**Files:**
- Create: `cli/src/runtime/orchestrator.ts`
- Create: `cli/src/runtime/intervention-policy.ts`
- Create: `cli/src/runtime/__tests__/orchestrator.test.ts`
- Create: `cli/src/runtime/__tests__/intervention-policy.test.ts`
- Modify: `cli/src/runtime/harness.ts`
- Modify: `cli/src/runtime/__tests__/harness.test.ts`
- Modify: `cli/src/commands/code.ts`

- [ ] **Step 1: Write failing orchestration tests**

  Cover loose outcome to plan, two disjoint assignments running concurrently up to the grant limit, dependency ordering, provider routing, no manual context transfer, verified integration, and grounded review.

- [ ] **Step 2: Write failing initiative tests**

  Cover one bounded retry after a failed verifier, replacement after an unhealthy adapter, stop after inactivity, refusal to expand scope, no duplicate intervention for the same evidence digest, and escalation when repository evidence invalidates the plan.

- [ ] **Step 3: Verify the tests fail**

  Run: `cd cli && npm test -- src/runtime/__tests__/orchestrator.test.ts src/runtime/__tests__/intervention-policy.test.ts src/runtime/__tests__/harness.test.ts`

  Expected: missing orchestration and intervention behavior.

- [ ] **Step 4: Split the 1A harness into orientation and orchestration**

  Keep startup reconstruction and interpretation correction in the harness. Delegate planning, worktree creation, routing, worker lifecycle, independent verification, intervention, integration, and review to the orchestrator.

- [ ] **Step 5: Implement bounded initiative**

  Automatically retry or replace only inside the current task grant and remaining budget. Record the trigger evidence, expected benefit, action, and verification. Consequential, destructive, external, secret-bearing, deployment, publication, purchase, and permission changes remain approval boundaries.

- [ ] **Step 6: Run orchestration tests**

  Run: `cd cli && npm test -- src/runtime/__tests__/orchestrator.test.ts src/runtime/__tests__/intervention-policy.test.ts src/runtime/__tests__/harness.test.ts`

  Expected: all pass.

### Task 7: Measure the Release 1B control trial and document operation

**Files:**
- Modify: `cli/src/runtime/metrics.ts`
- Modify: `cli/src/runtime/__tests__/metrics.test.ts`
- Modify: `cli/src/commands/task.ts`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/architecture/intelligence-surface-foundation.md`

- [ ] **Step 1: Write failing Release 1B metric tests**

  Count real routed assignments, accepted interventions, stop/retry/redirect/replace controls, conflicts, permission renewals, verified integrations, and manual context transfers. Exclude prompt-only and test-fixture sessions.

- [ ] **Step 2: Verify the tests fail**

  Run: `cd cli && npm test -- src/runtime/__tests__/metrics.test.ts`

  Expected: missing Release 1B metrics.

- [ ] **Step 3: Implement and render the control trial**

  Extend `flyd task metrics` with the five-working-day Release 1B control evidence and explicit insufficient-evidence language.

- [ ] **Step 4: Document the operator contract**

  Explain adapter health, managed worktrees, task grants, automatic intervention limits, controls, integration safety, and the broken-local-Codex diagnostic. Keep Rails parity explicitly in Release 1C.

- [ ] **Step 5: Run metric tests**

  Run: `cd cli && npm test -- src/runtime/__tests__/metrics.test.ts`

  Expected: all pass.

### Task 8: Verify and land Release 1B

**Files:**
- Modify only files required by review findings.

- [ ] **Step 1: Run migrations and full suites**

  Run:

  ```bash
  bin/rails db:migrate
  bin/rails test
  cd cli && npm test
  cd cli && npm run lint
  cd cli && npm run build
  ```

  Expected: all pass.

- [ ] **Step 2: Run quality and security checks**

  Run:

  ```bash
  bundle exec rubocop
  bundle exec brakeman --no-pager
  cd cli && npm audit --omit=dev
  git diff --check
  ```

  Expected: no application findings; any toolchain-only warning is reported precisely.

- [ ] **Step 3: Run an end-to-end two-worker smoke**

  In an isolated temporary repository, use fake Codex and OpenCode executables to produce disjoint changes. Interrupt one worker, redirect or replace it, resume from durable state, verify both assignments, integrate onto `main`, and prove a repeated command is idempotent.

- [ ] **Step 4: Review against Journeys 2, 3, and 4**

  Confirm no worker output self-verifies, no unapproved scope is reached, no conflict touches `main`, and no manual context transfer occurs between workers.

- [ ] **Step 5: Commit and push `main`**

  Stage only intended changes, create a conventional commit, push `main`, and verify local `HEAD` equals `origin/main`.
