# Release 1C Rails Parity Design

## Goal

Make Rails a first-class interface to the same active coding task as the Flyd CLI. Rails must show the same committed task revision, workers, permission decisions, verification evidence, artifacts, corrections, and completion state, and it must expose the same actions without implementing a second runtime.

Release 1C is complete only when Journeys 5, 6, and 7 in `docs/product/flyd-personal-agent-platform-prd.md` pass.

## Product Boundary

Release 1C is not another homepage redesign and not a task dashboard.

- The active coding situation earns the stage through `Flyd::Intelligence`.
- The result remains a persisted `Surface` with validated semantic items.
- Coding views are renderer variants inside the canonical surface modes, not new application sections.
- Chat remains one renderer. It is not the shell around task control.
- Rails does not expose projects, workers, logs, or stored artifacts merely because records exist.
- Empty or unrelated task state does not displace a more relevant Flyd surface.
- A task surface owns one viewport and changes with the task. It must not become a scrolling collection of cards.

## Chosen Architecture

### One command authority

The TypeScript runtime remains the only authority that mutates task, grant, assignment, worker, command, correction, and completion state.

The existing CLI control functions move behind one `RuntimeCommandService`. Both the human CLI commands and a JSON-only runtime bridge call that service. Rails invokes the bridge as an argument-array subprocess with a JSON request on standard input. Rails never shells through a string and never writes operational state directly.

The bridge supports an explicit versioned command contract:

- `health`
- `task.status`
- `task.approve_grant`
- `task.reject_grant`
- `task.stop_worker`
- `task.retry_worker`
- `task.redirect_worker`
- `task.replace_worker`
- `task.correct`
- `task.confirm_completion`

Every mutating request includes:

- schema version;
- task key;
- expected task revision;
- target worker, grant, or assignment key when applicable;
- a caller-generated idempotency key;
- actor surface;
- the minimum user-authored content needed by that action.

The runtime resolves the authoritative record, validates the expected revision and task grant, executes the existing control path, journals the event, and returns the resulting task revision. Replaying an idempotency key returns the original result and cannot repeat a consequential effect.

Rails may read PostgreSQL through Active Record because PostgreSQL is the canonical operational store. Reads are projections, not a competing authority.

### Persisted grant proposals

Permission parity requires a grant to exist before either interface approves it. The runtime therefore persists a `proposed` `TaskGrant` with its full immutable scope before prompting.

CLI and Rails render the same proposal. Approval and rejection both go through `RuntimeCommandService`. Approval changes the proposed grant to `approved`; rejection changes it to `revoked` with a recorded reason. A scope change creates a new proposal rather than mutating an approved grant.

### Semantic task surfaces

A new `IntelligenceState::RuntimeTaskProvider` supplies current operational evidence to the normal world-state compiler:

- active task and revision;
- intended outcome and current recommendation;
- assignments, dependencies, status, and declared scope;
- current grant or pending grant proposal;
- workers, adapters, process/session identity, heartbeat, and pending control;
- verification and integration state;
- artifact references;
- corrections and unresolved decisions;
- runtime health and freshness.

The provider output is evidence. `Flyd::Intelligence` still chooses whether the task deserves the stage and which canonical mode is appropriate.

The allowed coding renderer variants are:

| Renderer | Canonical mode | Purpose |
| --- | --- | --- |
| `task_orientation` | conversation, investigation, action, or quiet | Current interpretation and re-entry point |
| `task_plan` | action or decision | Assignments, dependencies, risk, scope, and verification |
| `worker_monitor` | monitoring | Live workers, progress, blocks, and controls |
| `task_review` | action or decision | Diff, tests, artifacts, conflicts, and confirmation |
| `task_completion` | quiet or action | Verified changed reality and unresolved follow-up |

These renderers are registered and validator-backed. They receive only a validated binding:

```json
{
  "task_key": "uuid",
  "task_revision": 12,
  "assignment_keys": ["uuid"],
  "worker_keys": ["uuid"],
  "artifact_keys": ["uuid"],
  "runtime_state": "fresh"
}
```

The binding is part of the persisted surface plan. A presenter resolves it against current PostgreSQL state. Views do not query arbitrary records or choose layout semantics.

Phase-changing events enqueue background recomposition. High-frequency progress events update the live binding without calling an LLM. This preserves intelligence-directed layout while allowing worker logs and state to move at operational speed.

## Actions And Input

Task surface actions are added to the closed action registry:

- `approve_task_grant`
- `reject_task_grant`
- `stop_worker`
- `retry_worker`
- `redirect_worker`
- `replace_worker`
- `correct_task`
- `confirm_task_completion`

Persisted action payloads contain authoritative selectors such as task key, expected revision, worker key, grant key, and assignment revision. The browser cannot replace those values.

`redirect_worker` and `correct_task` accept user-authored text because the text is the action itself. Their validator contract explicitly permits only one bounded string field and rejects blank, oversized, or extra input. All other actions ignore submitted payload content and execute the persisted payload.

The global input remains the primary place to state a new outcome. Task controls are local commands attached to the semantic object that needs them.

## Live Propagation

`PostgresTaskStore#insertEvent` publishes a compact PostgreSQL notification after inserting each `RuntimeEvent`. PostgreSQL delivers the notification only after the transaction commits.

A dedicated Rails runtime-event listener process:

1. listens for committed runtime notifications;
2. loads the exact task revision from PostgreSQL;
3. broadcasts the bound task fragment through Turbo Streams;
4. enqueues surface recomposition only when the semantic phase or required decision changes;
5. records client-delivery latency;
6. reconnects with bounded backoff after database interruption.

`Procfile.dev` runs this listener with web, CSS, and Sidekiq. Production documentation names it as a required process.

The target local propagation budget is p95 below two seconds from committed runtime event to visible Rails state. Duplicate notifications are harmless because task revision is the broadcast identity.

CLI does not consume a separate Rails result. Rails actions execute through the runtime bridge and commit the same event journal the CLI reads. Before every transition, resume, or completion, the harness reloads the current task revision.

## Runtime Availability

The bridge writes a renewable runtime lease when it passes health checks or executes a command. The listener periodically checks bridge and database health and refreshes that lease.

A task binding is `fresh` only when:

- its persisted revision matches the current task revision;
- the runtime lease is current;
- the database listener has not reported a delivery failure.

If any condition fails:

- Rails renders the last committed state;
- the stage labels it as stale;
- task actions are disabled;
- no worker command is queued;
- background health recovery continues;
- a recovered lease triggers a fresh broadcast and, when necessary, recomposition.

Runtime unavailability never falls back to direct Rails mutation.

## Real Artifacts

Release 1C introduces canonical `TaskArtifact` records attached to an `AgentTask` and optionally to an assignment or worker.

Supported kinds are:

- `diff`
- `test`
- `log`
- `code`
- `image`
- `document`

Each artifact stores a stable artifact key, kind, title, media type, byte size, SHA-256 digest, verification status, source revision, and provenance metadata.

Text artifacts store bounded content:

- patch text for diffs;
- command, exit status, stdout, and stderr for tests;
- bounded structured worker output for logs;
- verified excerpts for code.

File artifacts store a repository-relative path, verified repository head, and digest. Path resolution must remain inside the project root after real-path expansion. Images may render inline only for allowlisted image MIME types. Documents download with a safe content disposition unless an existing renderer safely supports that type.

The verifier writes artifacts in the same operational flow that records assignment verification. A worker's textual completion claim cannot create a verified artifact. Integration updates artifact provenance to the integrated repository head.

Large text is truncated with an explicit byte count and full-content digest. Secrets pass through the existing redaction boundary before persistence or rendering.

## Corrections And Learning

`task.correct` records:

- the original claim or interpretation;
- the corrected value;
- the affected task and surface revision;
- the user as the confirming authority;
- provenance and supersession links.

The runtime updates the task context and emits an archive-outbox event in the same transaction. Rails-to-archive delivery remains asynchronous and idempotent. A later CLI or Rails retrieval therefore sees the same correction.

At verified completion, the runtime emits structured outcome events for:

- repository facts tied to the integrated head;
- user-confirmed decisions and corrections;
- inferred workflow preferences, still labeled as hypotheses;
- unresolved work and exact re-entry point.

Worker claims and model summaries remain evidence and cannot promote themselves.

## Rendering Requirements

The task stage must answer, at a glance:

1. What are we trying to accomplish?
2. What is happening now?
3. What changed or is blocked?
4. What does Flyd need from the user?

The screen uses one dominant semantic object and only the supporting state needed for the current judgment. Worker lists, command output, diffs, and provenance expand in place or replace the focus; they are not independent cards or a separate dashboard page.

Evidence remains inspectable behind source controls. Labels such as “Evidence” do not occupy the primary interface unless provenance is the decision being made.

## Error Handling

- Invalid bridge JSON fails closed and records a Rails operational error without mutating task state.
- A bridge timeout marks the binding stale and read-only.
- Revision conflicts return current revision and force Rails to refresh before retrying.
- Missing or unsupported local worker versions disable the affected control and expose the exact health reason.
- A worker-control failure remains a journaled failed command.
- An artifact digest or path mismatch prevents rendering and records an integrity error.
- A notification outage does not lose state because PostgreSQL remains canonical; listener recovery replays events after its last delivered revision.
- Surface composition failure preserves the last valid surface while live bindings remain truthful.

## Testing

### Contract tests

- CLI commands and the JSON bridge execute the same `RuntimeCommandService`.
- Every action has one schema, revision rule, idempotency rule, and result shape.
- Rails cannot submit an unpersisted worker, grant, assignment, or task selector.
- A duplicate command cannot repeat a signal, approval, correction, or completion.

### Model and service tests

- Proposed grants are immutable after approval and visible to both surfaces.
- Task artifacts enforce kind, digest, size, provenance, and safe path rules.
- Runtime provider references resolve through the known reference registry.
- Binding presenters reject unknown keys and stale revisions.
- Corrections write one operational event and one idempotent archive outcome.

### Controller tests

- Rails task actions invoke the bridge and never update worker or grant rows directly.
- Payload tampering cannot change persisted selectors.
- Redirect and correction accept only their declared bounded text.
- Bridge failure returns the persisted state as stale and read-only.
- Artifact delivery rejects traversal, digest mismatch, unsupported inline MIME types, and unverified records.

### Live tests

- A committed CLI runtime event reaches the Rails task fragment within two seconds.
- Duplicate and out-of-order notifications converge on the highest committed revision.
- Listener interruption leaves Rails stale and read-only.
- Listener recovery replays missed revisions and restores controls.
- A Rails stop, redirect, permission decision, correction, and completion is immediately visible to the CLI task status.

### System acceptance

- Journey 5: a correction entered in Rails changes later CLI retrieval and does not repeat the corrected claim.
- Journey 6: verified outcomes promote only allowed knowledge classes and retain provenance.
- Journey 7: one active task with workers, a grant, artifacts, and a pending action can be understood and advanced from either CLI or Rails.
- Existing fixed-stage, action-contract, intent, attachment, background-composition, and no-request-time-LLM tests continue to pass.

## Delivery Sequence

Implementation proceeds in four independently testable slices:

1. Extract the shared runtime command service, persist grant proposals, and add the versioned JSON bridge.
2. Add runtime task evidence, semantic task renderers, registered actions, and safe task artifacts.
3. Add PostgreSQL notification delivery, Turbo live bindings, latency measurement, and stale/read-only recovery.
4. Add bidirectional correction, outcome promotion, full Journey 5-7 acceptance coverage, documentation, and the Release 1C trial metrics.

Each slice lands on `main`. Release 1C is not reported complete until all four slices and the cross-surface acceptance gate pass.
