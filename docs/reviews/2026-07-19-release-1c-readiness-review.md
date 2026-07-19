# Release 1C Readiness Review

## Scope

This review covers the Release 1A/1B TypeScript runtime, its PostgreSQL authority, worker execution and recovery, the Rails surface architecture, and the approved Release 1C design.

Baseline verification on 2026-07-19:

- CLI: 337 tests passed.
- Rails: 321 tests and 1,117 assertions passed.
- `main` matched `origin/main`.

The passing baseline does not cover the failures below.

## Findings

### P1: A failed worker command is not terminal or retry-idempotent

`PostgresTaskStore#completeWorkerCommand` returns early only for `completed` commands. Replaying a command that was already recorded as `failed` tries to complete it again and insert the same completion event idempotency key. Depending on the path, that either raises a unique-key error or repeats worker-control work.

`controlWorker` has the same incomplete terminal check. If `queueWorkerCommand` returns an existing failed command, it can signal the worker process again before completion fails.

This violates the Release 1 requirement that retries cannot repeat a consequential action.

Required fix:

- Treat `completed`, `failed`, and `cancelled` commands as terminal.
- Return the original terminal result without signaling or inserting another event.
- Add integration coverage for repeated failed stop, redirect, and replace requests.

### P1: Concurrent idempotent requests can fail instead of converging

Worker command queueing checks for an existing idempotency key before locking the worker and task. Two concurrent transactions can both observe no command, then serialize on the worker lock. The second transaction does not recheck after acquiring the lock and attempts a duplicate insert.

Several task mutations use the same check-before-lock shape. A normal bridge retry racing the original request can therefore fail with a uniqueness error even though both requests are semantically identical.

Required fix:

- Recheck idempotency after acquiring the authoritative lock, or use an insert conflict path that returns the original committed result.
- Ensure the JSON bridge returns the same result envelope for concurrent duplicate requests.
- Add concurrency tests at the PostgreSQL store and command-service boundaries.

### P1: One controlled worker can make a concurrent task look ready

`PostgresTaskStore#completeWorkerCommand` always sets its task to `ready`. Release 1B permits two disjoint assignments to run concurrently, so stopping, redirecting, replacing, or failing one worker can falsely mark the task ready while another worker remains live.

This becomes a cross-surface trust failure in Release 1C because Flyd can compose a review or decision surface from a task that is still executing.

Required fix:

- Derive task status while holding the task lock.
- Keep the task `running` while any worker is live.
- Use `ready` only when no live workers remain and the task is not blocked or terminal.
- Add a two-worker regression test.

### P1: Worker inactivity monitoring does not monitor inactivity

The worker adapter starts one timer for the full approved runtime. Parsed output does not reset it. The orchestrator records a heartbeat only when a new external session ID appears, so ordinary worker progress does not update persisted observation time.

A healthy worker can be killed at the runtime limit despite continuous output, while a silent worker is allowed to sit for the entire runtime budget. The resulting event and user-facing explanation call this an inactivity threshold even though it is not one.

Required fix:

- Separate absolute runtime budget from an inactivity budget.
- Reset the inactivity timer on stdout, stderr, and parsed worker events.
- Persist bounded observation heartbeats without journaling a new task revision for every output chunk.
- Test active-output survival and silent-worker termination.

### P1: Adapter crashes bypass Flyd's intervention policy

When an adapter throws, the orchestrator records `worker.failed` and immediately rethrows. Replacement and retry policy runs only when an adapter returns a nonzero result. Spawn failures, channel failures, and callback failures therefore block the whole task without using the bounded intervention policy promised by Release 1B.

Required fix:

- Normalize adapter exceptions into failed worker results after journaling the failure.
- Run the same evidence digest, retry, replacement, and budget policy used for nonzero exits.
- Preserve the original error in verification and artifact evidence.
- Add crash-to-retry, crash-to-replace, and exhausted-budget tests.

### P2: Recovery identifies a process by PID and executable path only

Recovery checks that a PID exists and that its command contains the recorded executable path. A reused PID running the same worker executable can satisfy that test, allowing Flyd to signal or trust a process from a different worker session.

Required fix:

- Record a process-start identity token when the worker starts.
- Verify PID, executable path, and start identity before recovery or signaling.
- Fail closed and mark the worker interrupted on identity mismatch.

## Release 1C Gaps

The approved Release 1C behavior is not present yet:

- CLI commands do not share a versioned `RuntimeCommandService`.
- There is no JSON runtime command bridge for Rails.
- Grants are created directly as approved instead of persisted as proposals.
- Rails has no runtime-task provider, task bindings, task renderers, or runtime task actions.
- Verification keeps full patch and command output in memory but persists only digests and summaries.
- There is no canonical `TaskArtifact`.
- Runtime events do not publish PostgreSQL notifications.
- There is no Rails listener, runtime lease, delivery cursor, stale binding state, or propagation metric.
- Corrections are plain strings without original claim, provenance, confirming authority, or supersession.
- Completion does not promote structured, policy-bounded outcome knowledge.
- Journeys 5, 6, and 7 do not have cross-surface acceptance coverage.

## Verdict

Release 1A/1B has useful foundations but is not safe to expose as a first-class Rails command surface until the P1 issues are fixed. Release 1C should proceed, with runtime correctness as its first slice and the Rails interface built only on the repaired shared command authority.
