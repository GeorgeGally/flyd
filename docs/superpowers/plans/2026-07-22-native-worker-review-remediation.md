# Native Worker Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every production-readiness failure found in the `6969660..df28b3d` review without discarding the existing uncommitted interface and content work on `main`.

**Architecture:** Keep PostgreSQL authoritative for grants, controls, recommendations, and acceptance evidence. Keep model execution inside Flyd's native process, but make process-group cleanup, successful evidence, context redaction, path resolution, verification, and per-repository integration explicit trusted boundaries rather than model conventions.

**Tech Stack:** TypeScript, Node.js child processes, PostgreSQL, Rails 8, Minitest, Vitest, macOS Seatbelt sandboxing.

---

### Task 1: Enforce Worker Lifetime and Durable Controls

**Files:**
- Modify: `cli/src/runtime/worker-adapter.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/orchestrator.ts`
- Test: `cli/src/runtime/__tests__/worker-adapter.test.ts`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Test: `cli/src/runtime/__tests__/orchestrator.test.ts`

- [ ] Add failing tests proving a leader cannot complete while descendants remain and a persisted terminating command makes `workerAuthority` false.
- [ ] Make natural leader exit clean the complete process group before resolving the worker result.
- [ ] Make authority depend on an approved grant, an unexpired deadline, an active worker status, and the absence of a pending terminating command.
- [ ] Reuse and complete the existing durable control when authority loss stops a worker; do not enqueue a duplicate stop.
- [ ] Run `npm test -- worker-adapter task-store.integration orchestrator`.

### Task 2: Protect Context, Credentials, and Git Administration

**Files:**
- Create: `cli/src/runtime/context-redactor.ts`
- Modify: `cli/src/runtime/orientation.ts`
- Modify: `cli/src/runtime/flyd-worker-tools.ts`
- Test: `cli/src/runtime/__tests__/orientation.test.ts`
- Test: `cli/src/runtime/__tests__/flyd-worker-tools.test.ts`

- [ ] Add failing tests for raw secrets in memory/task context, aliases resolving to `.env`, aliases resolving into `.git`, and sandboxed writes to `.git`.
- [ ] Redact credential assignments, known provider-token formats, and private-key blocks before context is persisted or sent to a provider.
- [ ] Re-run sensitive-path checks against canonical resolved targets as well as lexical paths.
- [ ] Deny command writes beneath every assignment clone's `.git` directory and redact tool output before returning it to the model.
- [ ] Add bounded `delete_file` and `move_file` tools so ordinary coding changes do not require shell escape hatches.
- [ ] Run `npm test -- orientation flyd-worker-tools`.

### Task 3: Require Real Evidence and Revalidate Verification State

**Files:**
- Modify: `cli/src/runtime/flyd-worker-loop.ts`
- Modify: `cli/src/runtime/result-verifier.ts`
- Test: `cli/src/runtime/__tests__/flyd-worker-loop.test.ts`
- Test: `cli/src/runtime/__tests__/result-verifier.test.ts`

- [ ] Add failing tests proving denied/unknown tools do not satisfy evidence and verification-created symlinks are rejected.
- [ ] Count only successful repository evidence tools after execution succeeds.
- [ ] Recheck escaping symlinks after every verification command and immediately before patch extraction.
- [ ] Require the verification checkout's `HEAD` to remain at the recorded base.
- [ ] Run `npm test -- flyd-worker-loop result-verifier`.

### Task 4: Resume Corrected Work Instead of Replaying Old Integration

**Files:**
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/harness.ts`
- Test: `cli/src/runtime/__tests__/harness.test.ts`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`

- [ ] Add a failing integrate-reject-correct-rerun regression test.
- [ ] Bind integrated verification evidence to the task revision it satisfied.
- [ ] Supersede prior integration and plan evidence when a correction changes or refocuses executable work.
- [ ] Skip orchestration only when integrated evidence matches the current task revision.
- [ ] Run `npm test -- harness task-store.integration`.

### Task 5: Bound Remote Retrieval

**Files:**
- Modify: `cli/src/runtime/flyd-worker-tools.ts`
- Test: `cli/src/runtime/__tests__/flyd-worker-tools.test.ts`

- [ ] Add failing tests for oversized `Content-Length`, streamed bodies beyond the cap, stalled requests, and redirect timeout reuse.
- [ ] Use one abort deadline for redirects and body streaming, reject oversized declared bodies, and stop reading at the tool-result byte cap.
- [ ] Run `npm test -- flyd-worker-tools`.

### Task 6: Give Every Writable Repository Its Own Assignment Boundary

**Files:**
- Create: `db/migrate/20260722100000_add_repository_root_to_task_assignments.rb`
- Modify: `cli/src/runtime/types.ts`
- Modify: `cli/src/runtime/assignment-planner.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/orchestrator.ts`
- Modify: `cli/src/commands/code.ts`
- Test: `cli/src/runtime/__tests__/assignment-planner.test.ts`
- Test: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Test: `cli/src/runtime/__tests__/orchestrator.test.ts`

- [ ] Add failing tests for assignments targeting two granted repositories and independent verification/integration into each repository's unchanged `main`.
- [ ] Persist an explicit canonical repository root and base head on every assignment.
- [ ] Constrain model plans to granted roots and create one isolated clone per writable repository assignment.
- [ ] Group verified results by repository and run locked unchanged-main integration independently for each group.
- [ ] Aggregate repository-specific artifacts and block the task if any repository cannot integrate.
- [ ] Run the focused CLI planner, store, orchestrator, and integrator tests, then migrate the Rails test database.

### Task 7: Bind Acceptance to the Exact Presented Recommendation

**Files:**
- Create: `db/migrate/20260722101000_bind_delivery_receipts_to_surface_items.rb`
- Modify: `app/controllers/runtime_delivery_receipts_controller.rb`
- Modify: `app/models/runtime_delivery_receipt.rb`
- Modify: `app/services/release_acceptance/evidence.rb`
- Modify: `app/javascript/controllers/runtime_delivery_controller.js`
- Modify: relevant task renderer partials
- Test: `test/controllers/runtime_delivery_receipts_controller_test.rb`
- Test: `test/services/release_acceptance/evidence_test.rb`

- [ ] Add failing tests proving a receipt for another item, task, revision, or digest cannot satisfy recommendation acceptance.
- [ ] Persist the exact acknowledged `surface_item_id` from a server-rendered binding.
- [ ] Validate item, task, revision, event, surface, and digest server-side before recording the receipt.
- [ ] Join acceptance evidence through that exact item and task identity.
- [ ] Run focused Rails controller and acceptance tests.

### Task 8: Full Verification and Review

- [ ] Run `cd cli && npm test && npm run lint && npm run build`.
- [ ] Run `bin/rails db:migrate`, `bin/rails test:all`, and `bundle exec brakeman --no-pager`.
- [ ] Run `git diff --check` and inspect the final diff without reverting pre-existing uncommitted work.
- [ ] Request an independent review of the remediation range and fix every Critical or Important finding.
- [ ] Commit all intended work on `main` and push `origin/main` as required by `AGENTS.md`.
