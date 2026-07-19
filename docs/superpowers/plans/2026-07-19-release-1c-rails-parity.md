# Release 1C Rails Parity Implementation Plan

> Execute on `main`. Every completed slice must be tested, committed, pushed, and visible from the canonical checkout.

**Goal:** Make Rails and the CLI equally capable interfaces to one authoritative Flyd coding task, including permissions, worker control, verified artifacts, corrections, completion, live state, and interruption recovery.

**Architecture:** PostgreSQL remains canonical for operational state and the TypeScript runtime remains the only command authority. A versioned JSON bridge and the CLI both call one `RuntimeCommandService`. Rails reads projections, invokes the bridge for mutations, and renders intelligence-selected task bindings through persisted surfaces.

**Product constraint:** This is not a task dashboard. A coding task earns one fixed stage through `Flyd::Intelligence`; renderers present the selected semantic plan and do not expose records merely because they exist.

---

## Slice 0: Repair Runtime Trust Guarantees

### Task 0.1: Make worker command replay terminal and concurrency-safe

**Files:**

- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/worker-controller.ts`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Test: `cli/src/runtime/__tests__/worker-controller.test.ts`

**Steps:**

1. Add failing tests proving a failed command replay neither signals again nor inserts another event.
2. Add a two-request concurrency test proving duplicate idempotency keys converge on one worker command.
3. Lock the authoritative task/worker before the final idempotency lookup.
4. Treat `completed`, `failed`, and `cancelled` worker commands as terminal results.
5. Run the focused tests and `npm run lint`.

### Task 0.2: Derive task status from all live workers

**Files:**

- Modify: `cli/src/runtime/task-store.ts`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`

**Steps:**

1. Add a failing two-assignment test where one command completes while the second worker remains running.
2. Add a locked helper that derives task status from task terminal state, assignment state, and all live workers.
3. Use it after worker command completion instead of assigning `ready` unconditionally.
4. Verify the task remains `running` until the final live worker ends.

### Task 0.3: Implement real inactivity observation

**Files:**

- Modify: `cli/src/runtime/worker-adapter.ts`
- Modify: `cli/src/runtime/orchestrator.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/types.ts`
- Test: `cli/src/runtime/__tests__/worker-adapter.test.ts`
- Test: `cli/src/runtime/__tests__/orchestrator.test.ts`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`

**Steps:**

1. Add separate `runtimeTimeoutMs` and `inactivityTimeoutMs` adapter inputs.
2. Reset inactivity on stdout, stderr, and parsed events while retaining the absolute runtime timer.
3. Add a lightweight store method that updates `last_observed_at` without incrementing the semantic task revision.
4. Throttle persisted observations to avoid write amplification.
5. Add tests proving active output survives the inactivity window and silence triggers the inactivity control.

### Task 0.4: Route adapter exceptions through bounded intervention

**Files:**

- Modify: `cli/src/runtime/orchestrator.ts`
- Test: `cli/src/runtime/__tests__/orchestrator.test.ts`

**Steps:**

1. Add failing tests for crash-to-retry, crash-to-replace, and exhausted worker-run budget.
2. Normalize adapter exceptions into a failed run result after `worker.failed` is journaled.
3. Continue through the existing intervention policy and preserve the crash error.
4. Verify automatic intervention remains bounded and idempotent.

### Task 0.5: Strengthen worker process identity

**Files:**

- Add migration: `db/migrate/20260719*_add_process_identity_to_worker_sessions.rb`
- Modify: `db/schema.rb`
- Modify: `cli/src/runtime/types.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/recovery.ts`
- Modify: `cli/src/runtime/worker-controller.ts`
- Test: `cli/src/runtime/__tests__/recovery.test.ts`
- Test: `cli/src/runtime/__tests__/worker-controller.test.ts`

**Steps:**

1. Persist an OS process-start token when a worker starts.
2. Require PID, executable, and start token to match before recovery or signaling.
3. Fail closed on an unreadable or mismatched identity.
4. Run CLI tests, Rails tests, migration checks, and `git diff --check`.

---

## Slice 1: One Command Authority

### Task 1.1: Extract `RuntimeCommandService`

**Files:**

- Add: `cli/src/runtime/runtime-command-service.ts`
- Add: `cli/src/runtime/runtime-command-contract.ts`
- Modify: `cli/src/commands/task.ts`
- Modify: `cli/src/runtime/worker-controller.ts`
- Test: `cli/src/runtime/__tests__/runtime-command-service.test.ts`
- Test: `cli/src/commands/__tests__/task.test.ts`

**Steps:**

1. Define version `1` request and response unions for health, status, grants, worker controls, correction, and completion.
2. Validate exact action fields, actor surface, task revision, authoritative selectors, and idempotency keys.
3. Move command orchestration behind `RuntimeCommandService`.
4. Keep CLI formatting separate while making every CLI task action call the service.
5. Add contract tests for revision conflicts, invalid selectors, unknown fields, and replay.

### Task 1.2: Persist immutable grant proposals

**Files:**

- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/types.ts`
- Modify: `cli/src/runtime/harness.ts`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Test: `cli/src/runtime/__tests__/harness.test.ts`

**Steps:**

1. Split proposal creation from approval.
2. Persist full scope and digest with status `proposed` before prompting.
3. Approve or reject only the persisted proposal at the expected task revision.
4. Prevent mutation of approved proposal scope; changed scope creates a new proposal.
5. Render the same proposal in the harness and bridge result.

### Task 1.3: Add the JSON runtime bridge

**Files:**

- Add: `cli/src/runtime-bridge.ts`
- Add: `cli/src/runtime/__tests__/runtime-bridge.test.ts`
- Modify: `cli/scripts/postbuild.mjs`
- Modify: `cli/package.json`
- Add: `app/services/agent_runtime/bridge.rb`
- Test: `test/services/agent_runtime/bridge_test.rb`

**Steps:**

1. Read exactly one bounded JSON request from standard input and write exactly one JSON response.
2. Send diagnostics only to standard error.
3. Return structured conflict, validation, unavailable, and internal-error envelopes.
4. Build the bridge into `dist/runtime-bridge.js`.
5. Invoke it from Rails using an argument array, bounded input, timeout, and no shell string.
6. Prove the CLI and bridge call the same service with identical outcomes.

---

## Slice 2: Semantic Rails Task Surfaces And Artifacts

### Task 2.1: Add canonical task artifacts

**Files:**

- Add migration: `db/migrate/20260719*_create_task_artifacts.rb`
- Add: `app/models/task_artifact.rb`
- Modify: `app/models/agent_task.rb`
- Modify: `app/models/task_assignment.rb`
- Modify: `app/models/worker_session.rb`
- Modify: `cli/src/runtime/result-verifier.ts`
- Modify: `cli/src/runtime/orchestrator.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Test: `test/models/task_artifact_test.rb`
- Test: `cli/src/runtime/__tests__/result-verifier.test.ts`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`

**Steps:**

1. Add artifact keys, allowed kinds, MIME type, byte size, digest, verification status, source revision, bounded content, safe path, and provenance.
2. Persist diff, test, and bounded log artifacts in the verification transaction.
3. Redact before persistence, truncate explicitly, and retain full digests.
4. Bind integrated artifacts to the resulting repository head.
5. Enforce repository-relative real paths and allowlisted inline image MIME types.

### Task 2.2: Add runtime task evidence

**Files:**

- Add: `app/services/intelligence_state/runtime_task_provider.rb`
- Modify: `app/services/intelligence_state/registry.rb`
- Modify: `app/services/flyd/world_state_compiler.rb`
- Test: `test/services/intelligence_state/runtime_task_provider_test.rb`
- Test: `test/services/intelligence_state/registry_test.rb`

**Steps:**

1. Project the active task, revision, assignments, grant proposal, workers, controls, artifacts, corrections, and runtime freshness.
2. Add exact reference-registry entries for task, grant, assignment, worker, and artifact keys.
3. Keep provider output as evidence; do not force it onto the stage.
4. Bound logs and artifact summaries before world-state compilation.

### Task 2.3: Register task renderers and validated bindings

**Files:**

- Add: `app/services/runtime_tasks/binding_presenter.rb`
- Modify: `app/services/surface_renderers/registry.rb`
- Modify: `app/services/flyd/surface_plan_validator.rb`
- Modify: `app/services/flyd/intelligence.rb`
- Add: `app/views/surfaces/renderers/_task_orientation.html.erb`
- Add: `app/views/surfaces/renderers/_task_plan.html.erb`
- Add: `app/views/surfaces/renderers/_worker_monitor.html.erb`
- Add: `app/views/surfaces/renderers/_task_review.html.erb`
- Add: `app/views/surfaces/renderers/_task_completion.html.erb`
- Modify: `app/views/surfaces/_plane.html.erb`
- Test: `test/services/runtime_tasks/binding_presenter_test.rb`
- Test: `test/services/flyd/surface_plan_validator_test.rb`
- Test: `test/system/directed_surface_modes_test.rb`

**Steps:**

1. Register the five task renderer variants against their allowed canonical modes and item kinds.
2. Validate binding keys, task revision, key counts, and runtime state.
3. Resolve only persisted binding selectors through the presenter.
4. Render one dominant semantic object with in-place details, no dashboard grid, no cards, and no generic “Evidence” controls.
5. Verify fixed-stage desktop and mobile layouts.

### Task 2.4: Add closed-registry task actions

**Files:**

- Modify: `app/services/surface_actions/registry.rb`
- Modify: `app/controllers/surface_item_actions_controller.rb`
- Add: `app/services/runtime_tasks/action_executor.rb`
- Test: `test/services/runtime_tasks/action_executor_test.rb`
- Test: `test/controllers/surface_item_actions_controller_test.rb`

**Steps:**

1. Register grant, worker-control, correction, and completion actions.
2. Read task, revision, worker, grant, and assignment selectors only from the persisted action.
3. Permit one bounded string only for redirect and correction.
4. Reject blank, oversized, and extra user fields.
5. Call `AgentRuntime::Bridge`; never mutate task runtime records in Rails.
6. Mark the binding stale and read-only on timeout or runtime failure.

### Task 2.5: Deliver artifacts safely

**Files:**

- Add: `app/controllers/task_artifacts_controller.rb`
- Add: `app/services/task_artifacts/resolver.rb`
- Modify: `config/routes.rb`
- Test: `test/controllers/task_artifacts_controller_test.rb`
- Test: `test/services/task_artifacts/resolver_test.rb`

**Steps:**

1. Resolve verified artifacts by stable key.
2. Reject traversal, symlink escape, head mismatch, digest mismatch, unsupported inline MIME, and unverified records.
3. Render bounded text and allowlisted images inline.
4. Deliver documents with safe attachment disposition.

---

## Slice 3: Live Propagation And Runtime Availability

### Task 3.1: Publish committed runtime notifications

**Files:**

- Modify: `cli/src/runtime/task-store.ts`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`

**Steps:**

1. Publish a compact `pg_notify` payload after each event insert.
2. Include event key, task key, task revision, and event type.
3. Rely on PostgreSQL commit semantics so rolled-back changes never notify.
4. Add commit, rollback, duplicate, and ordering tests.

### Task 3.2: Add listener cursor, lease, and latency state

**Files:**

- Add migration: `db/migrate/20260719*_create_runtime_delivery_states.rb`
- Add: `app/models/runtime_delivery_state.rb`
- Add: `app/services/agent_runtime/lease.rb`
- Add: `app/services/agent_runtime/event_listener.rb`
- Add: `lib/tasks/runtime_listener.rake`
- Modify: `Procfile.dev`
- Test: `test/models/runtime_delivery_state_test.rb`
- Test: `test/services/agent_runtime/lease_test.rb`
- Test: `test/services/agent_runtime/event_listener_test.rb`

**Steps:**

1. Persist listener cursor, lease expiry, last error, and delivery latency.
2. Listen with bounded reconnect backoff.
3. Replay committed revisions after the cursor on startup or reconnect.
4. Deduplicate by task revision and converge on the highest committed revision.
5. Document the listener as a required production process.

### Task 3.3: Broadcast live bindings and recompose only on phase changes

**Files:**

- Add: `app/jobs/broadcast_runtime_task_job.rb`
- Add: `app/jobs/recompose_runtime_task_surface_job.rb`
- Modify: `app/services/agent_runtime/event_listener.rb`
- Modify: `app/views/surfaces/_plane.html.erb`
- Test: `test/jobs/broadcast_runtime_task_job_test.rb`
- Test: `test/jobs/recompose_runtime_task_surface_job_test.rb`
- Test: `test/services/agent_runtime/event_listener_test.rb`

**Steps:**

1. Broadcast high-frequency state to the bound task fragment without an LLM call.
2. Enqueue normal background composition only for semantic phase or decision changes.
3. Measure commit-to-broadcast latency.
4. Prove duplicate and out-of-order events converge.

### Task 3.4: Enforce stale/read-only recovery

**Files:**

- Modify: `app/services/runtime_tasks/binding_presenter.rb`
- Modify: `app/services/runtime_tasks/action_executor.rb`
- Modify: `app/services/agent_runtime/event_listener.rb`
- Test: `test/services/runtime_tasks/binding_presenter_test.rb`
- Test: `test/services/runtime_tasks/action_executor_test.rb`
- Test: `test/system/runtime_task_surface_test.rb`

**Steps:**

1. Mark a binding fresh only when task revision, runtime lease, and listener state agree.
2. Disable all consequential actions while stale.
3. Preserve the last committed task state with an explicit stale status.
4. Recover the lease, replay missed revisions, and restore controls without direct Rails mutation.
5. Assert local p95 propagation below two seconds in the acceptance harness.

---

## Slice 4: Corrections, Outcome Learning, And Acceptance

### Task 4.1: Persist structured corrections

**Files:**

- Add migration: `db/migrate/20260719*_create_task_corrections.rb`
- Add: `app/models/task_correction.rb`
- Modify: `cli/src/runtime/types.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/runtime-command-service.ts`
- Modify: `cli/src/runtime/archive-outbox.ts`
- Test: `test/models/task_correction_test.rb`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Test: `cli/src/runtime/__tests__/archive-outbox.test.ts`

**Steps:**

1. Store original claim, corrected value, task revision, surface revision, user authority, provenance, and supersession links.
2. Update task context and insert the archive outbox event in one transaction.
3. Make correction replay idempotent.
4. Ensure later retrieval prefers the correction and preserves history.

### Task 4.2: Promote only verified outcome knowledge

**Files:**

- Add: `cli/src/runtime/outcome-promoter.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/archive-outbox.ts`
- Modify: `cli/src/runtime/runtime-command-service.ts`
- Test: `cli/src/runtime/__tests__/outcome-promoter.test.ts`
- Test: `cli/src/runtime/__tests__/archive-outbox.test.ts`

**Steps:**

1. Emit repository facts tied to the integrated head.
2. Emit only user-confirmed decisions and corrections as confirmed knowledge.
3. Label workflow preferences as hypotheses.
4. Preserve unresolved work and exact re-entry point.
5. Reject promotion from worker claims or model summaries without verification.

### Task 4.3: Add cross-surface acceptance journeys

**Files:**

- Add: `test/system/runtime_task_surface_test.rb`
- Add: `test/integration/release_1c_cross_surface_test.rb`
- Add: `cli/src/runtime/__tests__/release-1c-acceptance.test.ts`
- Modify: `docs/product/flyd-personal-agent-platform-prd.md`
- Modify: `AGENTS.md`

**Steps:**

1. Journey 5: correct a stale claim in Rails, deliver it to the archive, and prove later CLI retrieval omits the superseded claim.
2. Journey 6: complete a verified task and prove only allowed knowledge classes are promoted with provenance.
3. Journey 7: show one task revision, workers, grant, artifacts, and pending action in CLI and Rails; execute in Rails and observe the result through CLI.
4. Interrupt the runtime, prove both surfaces are stale/read-only, recover, and prove state convergence.
5. Re-run existing fixed-stage, action-contract, intent, attachment, composition, and no-request-time-LLM tests.

## Final Verification

Run:

```bash
cd cli && npm test
cd cli && npm run lint
cd cli && npm run build
bin/rails db:migrate
bin/rails test
bin/rails test:all
bundle exec brakeman --no-pager
git diff --check
git status --short --branch
```

Then:

1. Inspect the final diff against the pre-Release 1C base.
2. Confirm no Rails code mutates operational task state directly.
3. Confirm every task action is in the closed registry and calls the bridge.
4. Confirm `GET /` remains free of synchronous LLM, provider refresh, and runtime command work.
5. Commit and push each verified slice to `main`.
6. Confirm local `main`, `origin/main`, and the canonical working tree match before reporting completion.
