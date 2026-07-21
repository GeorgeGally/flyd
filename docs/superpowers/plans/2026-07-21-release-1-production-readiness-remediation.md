# Release 1 Production Readiness Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers-ruby:test-driven-development` for each task and `superpowers-ruby:verification-before-completion` before every completion claim.

**Goal:** Close every Critical and Important finding from the Release 1 review so Flyd can safely execute, resume, verify, integrate, and present work while collecting trustworthy dogfood evidence.

**Architecture:** Keep PostgreSQL as the task/grant/event authority and replace external coding-harness delegation with a Flyd-native worker. Flyd calls the configured OpenAI-compatible model, owns the resumable loop and structured tools, strips provider credentials from tool processes, and edits through isolated assignment clones plus grant-approved repository roots. Make grants and process groups authoritative at runtime, resume the exact Flyd session for retries and redirects, integrate a verified commit through a locked fast-forward of `main`, and make release evidence identify the exact recommendation and task revision that the user actually experienced.

**Tech Stack:** Rails 8, PostgreSQL, Hotwire/Stimulus, TypeScript, Node child processes, macOS `sandbox-exec`, Vitest, Minitest.

---

## Constraints And Completion Contract

- Work on `main`; do not leave completed work only in a worktree or feature branch.
- Preserve and finish the current uncommitted surface/discovery changes. Do not reset or discard them.
- Every security boundary fails closed when it cannot prove the requested scope.
- The model connection may request only Flyd tools. HTTPS reads are limited to hosts explicitly referenced by the assignment; repository and command tools are limited by the task grant. Provider credentials never enter tool subprocess environments.
- Verification commands run without provider credentials or network access and may write only inside the integration worktree and isolated temporary directories.
- A release gate reports success only from explicit, revision-matched evidence; delivery alone is not parity.

## Task 0: Make Conversational Action Requests Enter The Execution Loop

**Files:**
- Modify: `cli/src/runtime/input-interpreter.ts`
- Modify: `cli/src/runtime/agent-session.ts`
- Modify: `cli/src/runtime/conversation-memory.ts`
- Modify: `cli/src/runtime/conversation-responder.ts`
- Modify: `cli/src/commands/code.ts`
- Modify: `cli/src/runtime/__tests__/input-interpreter.test.ts`
- Modify: `cli/src/runtime/__tests__/agent-session.test.ts`
- Modify: `cli/src/runtime/__tests__/conversation-memory.test.ts`
- Modify: `cli/src/runtime/__tests__/conversation-responder.test.ts`

1. Reproduce the observed sequence in a failing session test: Flyd recalls the `i-have-adhd` GitHub skill, the user says `ok implement then` or `no you implement!`, and Flyd must return a coding outcome rather than another conversational answer.
2. Let the lexical interpreter return an unresolved `contextual_action` for deictic commands such as `implement it`, `do it`, `go ahead`, and `you implement`; it must not inspect memory or invent a coding outcome.
3. Resolve that action in `AgentSession` against a typed coding-only `ActionableOutcome` containing exact original text, source session, source turn, and timestamp. Prefer the current session, then `retrieveRecentActionableOutcome`; reject absent, stale, non-coding, or ambiguous referents. Hand the exact original outcome to `runCode` so the GitHub URL is preserved.
4. Tighten the conversation prompt so it never offers implementation steps or says Flyd cannot act when an actionable request can be handed to the runtime. Conversational turns may explain or clarify, but execution claims must come only from the supervised harness.
5. Persist a dedicated actionable handoff record before returning and before terminal close, so restart plus `continue` can recover the exact request if grant approval or worker launch is interrupted. A persistence failure blocks the handoff rather than losing continuity.
6. Test no referent, a non-coding referent, stale and multiple referents, restart recovery, persistence failure, and exact URL preservation.
7. Run `cd cli && npx vitest run src/runtime/__tests__/input-interpreter.test.ts src/runtime/__tests__/agent-session.test.ts src/runtime/__tests__/conversation-memory.test.ts src/runtime/__tests__/conversation-responder.test.ts`.

## Task 1: Add The Flyd-Native Coding Worker

**Files:**
- Create: `cli/src/runtime/flyd-worker-config.ts`
- Create: `cli/src/runtime/flyd-worker-tools.ts`
- Create: `cli/src/runtime/flyd-worker-loop.ts`
- Create: `cli/src/runtime/flyd-worker-process.ts`
- Create: `cli/src/runtime/flyd-worker-adapter.ts`
- Modify: `cli/src/runtime/worker-adapter.ts`
- Modify: `cli/src/commands/code.ts`
- Modify: `cli/src/runtime/result-verifier.ts`
- Modify: `cli/src/runtime/orchestrator.ts`
- Modify: `cli/src/runtime/worktree-manager.ts`
- Modify: `cli/src/runtime/__tests__/worker-adapter.test.ts`
- Create: `cli/src/runtime/__tests__/flyd-worker-config.test.ts`
- Create: `cli/src/runtime/__tests__/flyd-worker-tools.test.ts`
- Create: `cli/src/runtime/__tests__/flyd-worker-loop.test.ts`
- Create: `cli/src/runtime/__tests__/flyd-worker-adapter.test.ts`
- Modify: `cli/src/runtime/__tests__/result-verifier.test.ts`
- Modify: `cli/src/runtime/__tests__/orchestrator.test.ts`
- Modify: `cli/src/runtime/__tests__/worktree-manager.test.ts`

1. Write failing tests proving Flyd loads the configured model without logging credentials, launches itself as the worker, and resumes the exact Flyd session.
2. Write failing tool tests proving grant-approved repositories work while unrelated paths, symlink escapes, shell composition, ungranted commands, and inherited provider credentials are denied.
3. Make Release 1 routing Flyd-only. Codex and OpenCode executables are not production workers; OpenCode may inform the interaction design but is not Flyd's runtime substrate.
4. Replace linked assignment worktrees with isolated local clones whose `.git` data is contained inside the managed assignment directory. Trusted Flyd code extracts patches and commits; the worker never receives write access to the source repository or its Git administration.
5. Implement the native model/tool loop as a supervised child process with JSON events, durable session messages, bounded turns, and exact-session resume.
6. Pass provider credentials only to the Flyd worker process. Every command runs with a sanitized environment; the model has no environment-reading tool.
7. Route `runVerificationCommand` through a verifier sandbox with no provider credentials, no network, and only clone/runtime/temp access. Reject symlinks that resolve outside an allowed root.
8. Run focused tests for the Flyd worker, process supervisor, verifier, orchestrator, and clone manager, then run a real disposable-repository smoke task with the configured model.

## Task 2: Make Grant Expiry And Process Groups Authoritative

**Files:**
- Modify: `cli/src/runtime/types.ts`
- Modify: `cli/src/runtime/worker-adapter.ts`
- Modify: `cli/src/runtime/worker-controller.ts`
- Modify: `cli/src/runtime/orchestrator.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/recovery.ts`
- Modify: `cli/src/runtime/__tests__/worker-adapter.test.ts`
- Modify: `cli/src/runtime/__tests__/worker-controller.test.ts`
- Modify: `cli/src/runtime/__tests__/orchestrator.test.ts`
- Modify: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Modify: `cli/src/runtime/__tests__/recovery.test.ts`

1. Add failing tests for expiry between worker creation and process spawn, a grant expiring before `max_runtime_minutes`, revocation while running, `stop` after expiry/revocation, retry/redirect/replace denial after expiry, and descendants surviving after the leader exits.
2. Add an atomic database-backed `claimWorkerStart` immediately before spawn. Under row locks it revalidates grant status/expiry, transitions the worker to starting, and returns the database-derived deadline `min(database_now + max_runtime, expires_at)`; refuse spawn without a valid claim.
3. Make grant revocation enqueue stop commands for all live workers in the same transaction. Runtime observation checks grant status and deadline so missed notifications cannot extend authority.
4. Spawn workers in their own process group and persist a process-group ID plus identity independently of the leader PID. Send `SIGTERM`, wait, then `SIGKILL` to the full group from timeout, revocation, explicit control, and recovery paths, including when the original leader has exited.
5. Change command authorization so `stop` remains valid for a live worker after expiry or revocation, while retry, redirect, and replace require an approved unexpired grant.
6. Mark grant-expired or revoked workers stopped/interrupted with durable reasons and events; never silently retry them without a new approved grant.
7. Run focused runtime and store integration tests.

## Task 3: Resume The Exact Worker Session

**Files:**
- Modify: `cli/src/runtime/types.ts`
- Modify: `cli/src/runtime/orchestrator.ts`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/__tests__/orchestrator.test.ts`
- Modify: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Modify: `test/models/worker_session_test.rb`

1. Add `resumesWorkerSessionId` to the TypeScript `WorkerSession` contract and map the existing `resumes_worker_session_id` column.
2. Implement `findResumeSource(assignmentKey)` from the latest completed retry/redirect command. Persist `resumes_worker_session_id` atomically with next-worker creation so a fresh orchestrator process reaches the same answer.
3. Reject manual retry/redirect before stopping or mutating the old worker when no `external_session_id` was captured. Automatic retry follows the same deterministic source rule.
4. On retry and redirect, pass the source worker's `externalSessionId` to `adapter.buildArgs`; on replacement, deliberately start a fresh provider session and record why.
5. Test automatic retry plus manual retry/redirect across a fresh store/orchestrator process.

## Task 4: Make Integration Atomic And Main-Only

**Files:**
- Modify: `cli/src/runtime/result-integrator.ts`
- Modify: `cli/src/runtime/worktree-manager.ts`
- Modify: `cli/src/runtime/__tests__/result-integrator.test.ts`
- Modify: `cli/src/runtime/__tests__/worktree-manager.test.ts`

1. Add failing tests for a non-`main` source branch, a source ref changing between verification and integration, an uncommitted source checkout, and a successful atomic integration.
2. Require the source snapshot branch to be exactly `main` and clean for implementation results. Continue allowing unchanged dirty source state only for read-only assessments.
3. Apply and verify combined patches in the integration worktree, create a Flyd-authored integration commit there, and record its parent/head/diff digest.
4. Acquire a Flyd repository integration lock, then recheck branch, `HEAD`, index, worktree, and `refs/heads/main` against the recorded clean base.
5. Run `git merge --ff-only <integration-commit>` in the source checkout while holding the lock. Never use raw `update-ref`, `reset --hard`, or a check-then-apply sequence.
6. If the checkout or ref changes before the merge, leave it untouched and return a blocked integration with exact evidence. Afterward verify source `HEAD`, branch, clean state, parent, and changed-file digest before reporting integrated.

## Task 5: Record Recommendation Actions And Revision-Matched Surface Parity

**Files:**
- Create: `db/migrate/20260721090000_add_release_acceptance_evidence_fields.rb`
- Modify: `db/schema.rb`
- Modify: `app/models/runtime_delivery_receipt.rb`
- Modify: `app/controllers/runtime_delivery_receipts_controller.rb`
- Modify: `app/javascript/controllers/runtime_delivery_controller.js`
- Modify: `app/views/surfaces/_plane.html.erb`
- Modify: `app/services/release_acceptance/evidence.rb`
- Modify: `app/services/release_acceptance/report.rb`
- Modify: `cli/src/runtime/task-store.ts`
- Modify: `cli/src/runtime/release-acceptance.ts`
- Modify: `cli/src/runtime/harness.ts`
- Modify: `cli/src/runtime/__tests__/release-acceptance.test.ts`
- Modify: `cli/src/runtime/__tests__/task-store.integration.test.ts`
- Modify: `test/controllers/runtime_delivery_receipts_controller_test.rb`
- Modify: `test/integration/release_1c_cross_surface_test.rb`
- Modify: `test/services/release_acceptance/evidence_test.rb`
- Modify: `test/services/release_acceptance/report_test.rb`

1. Add failing tests showing startup interpretation is not recommendation acceptance, browser-supplied state is never authoritative, a receipt for the wrong task revision/digest is not parity, and a required-suite failure for the active release fails the gate.
2. Add a persisted recommendation record keyed by release marker, task revision, task session, surface item, and exact action. Record `accepted` only at the actual CLI command or `RuntimeTasks::ActionExecutor` execution boundary; record `adapted` only when explicitly linked to that recommendation. Startup interpretation remains separate.
3. Define one canonical, deterministically ordered task-binding payload containing task ID/revision, workers, artifacts, and available actions. Compute its digest server-side, render it into the page, and have the browser acknowledge that opaque digest rather than supply state.
4. Add task revision and binding digest to delivery receipts and validate them against the authoritative runtime event and bound surface item. Count parity only for an exact authoritative match.
5. Associate every automated run with release marker, commit, required suite, runner, and artifact identity. Within the active marker/commit, any required-suite failure fails the gate; preserve all historical runs.
6. Make the PostgreSQL/Rails report the single acceptance authority and have the CLI display that report rather than maintain a divergent TypeScript formula.

## Task 6: Make Release Availability Honest

**Files:**
- Modify: `db/migrate/20260720200000_create_release_markers.rb`
- Modify: `app/models/release_marker.rb`
- Create or modify: `lib/tasks/release_acceptance.rake`
- Modify: `test/models/release_marker_test.rb`
- Modify: `test/services/release_acceptance/evidence_test.rb`

1. Remove the fixed historical timestamp and commit from the table-creation migration so fresh installs cannot manufacture elapsed dogfood time.
2. Add a forward corrective migration that deletes only the exact synthetic `release_1c` marker with timestamp `2026-07-19 14:56:22` and commit `e171c4b34b3888f9118e17d878b405ac321b3ece`; never delete a real replacement marker.
3. Add an idempotent explicit marker command that records availability at invocation time with deployed commit SHA. Preserve an existing marker on rerun; require an explicit new marker for a new deployed commit/trial.
4. Test fresh install, an already-migrated synthetic marker, idempotent mark, and explicit new-release behavior.

## Task 7: Finish The Current Surface-Intelligence Changes

**Files:**
- Modify: `app/services/flyd/interface_director.rb`
- Modify: `app/services/flyd/evidence_candidates.rb`
- Modify: `app/services/flyd/intelligence.rb`
- Modify: `app/services/flyd/world_state_compiler.rb`
- Modify: `app/services/runtime_tasks/next_action.rb`
- Modify: `app/assets/tailwind/application.css`
- Modify: `app/javascript/controllers/surface_controller.js`
- Modify: `app/views/surfaces/renderers/_discovery_scene.html.erb`
- Modify: `test/services/flyd/interface_director_test.rb`
- Modify: `test/services/flyd/evidence_candidates_test.rb`
- Add focused renderer/controller tests where current coverage is absent.

1. Preserve the current work that suppresses completed runtime noise, improves discovery content, handles broken images, and renders direct discovery actions.
2. Add a failing regression test proving an active unresolved decision remains eligible after presentation until it is resolved, expired, or detached from live runtime evidence.
3. Define scene expiry as validated ISO8601 `metadata["expires_at"]` for expirable scene kinds. Replace the blanket `last_presented_at` exclusion with kind-aware lifecycle rules: transient completed/monitoring/discovery scenes yield after presentation; unresolved unexpired decisions, active investigations, and live builds remain eligible.
4. Replace the contradictory presentation-removes-decision test. Bound monitoring timestamps on both sides with an explicit small clock-skew allowance so future-dated evidence cannot hold the interface.
5. Confirm completed tasks with no genuine follow-up yield the stage while completed tasks with a specific follow-up remain available.
6. Run focused Rails tests and render-system coverage.

## Task 8: Full Verification, Independent Review, And Main Publication

**Files:**
- Modify: `docs/product/flyd-personal-agent-platform-prd.md` only if implementation changes an explicit contract.
- Modify: `docs/architecture/intelligence-generated-interface.md` only if the runtime/surface contract changed.
- Modify: `CHANGELOG.md` if present and required by repository conventions.

1. Run `bin/rails db:migrate` and inspect `db/schema.rb` for only intended changes.
2. Run `bin/rails test`.
3. Run `bin/rails test:all`.
4. Run `cd cli && npm test`.
5. Run `cd cli && npm run lint`.
6. Run `cd cli && npm run build`.
7. Run `git diff --check` and inspect the complete diff, including the pre-existing uncommitted surface files.
8. Launch a fresh independent review agent over the exact final diff and resolve every Critical or Important finding.
9. Run the live CLI smoke flows for chat, implementation dispatch, stop, resume, retry/redirect, and acceptance reporting. Record any dogfood-only evidence still legitimately missing.
10. Commit the complete verified change set on `main`, push `origin/main`, and report the exact commit plus any evidence gate that remains time-dependent.
