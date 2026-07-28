# flyd — agent reference

## Repository workflow

- `main` is the working branch and source of truth.
- Do not leave completed work only on feature branches, PR branches, or temporary worktrees.
- If a requested change exists off `main`, fast-forward or otherwise land it on `main` before reporting completion.
- If local `main` is stale, dirty, or otherwise not the correct state, preserve any uncommitted work and make `main` match the correct source of truth.

## Product architecture

**Flyd has no primary interface. It has a primary presence.**

Flyd Core is the intelligence runtime — implemented in TypeScript (`cli/src/server.ts` + friends). Swift (`mac-adapter/`) is the thin native OS adapter/presence layer that captures environment, renders UI, and executes operations. Rails (repo root: `app/`, `bin/rails`, `config/`, `db/`, `lib/`) remains as the optional composed-surface renderer and legacy subsystem — it belongs to the separate, older coding-agent platform, not the overlay.

### Adapter modes

| Mode | Trigger | Status | Description |
|------|---------|--------|-------------|
| PRESENT | Always on | Shipped | OS notification-based foreground observation. No cognition, no network, no persistence. |
| INVOKED (text) | Double-tap fn key | Shipped | One-shot text invocation. Intent field → resolution → native/augment/compose. |
| INVOKED (voice) | fn+Ctrl hold (>300ms) | Shipped | Push-to-talk → `gpt-realtime-whisper` transcription → same `/manifest` pipeline. |
| LIVE | Ctrl×3 (triple-press) | Shipped | Persistent realtime voice session with `gpt-realtime-2.1`. Tool calling routes through Core safety. Ctrl×3 again to exit. MVP requires headphones. |

### Resolution outcomes

These are what Core returns — they are not adapter modes. A single INVOKED can produce any of them.

| Outcome | Description | Status |
|---------|-------------|--------|
| Native | Text operations (insert, replace) executed in the focused element | Shipped |
| Augment | Explanation, choice, or annotation cards overlaid on screen | Shipped |
| Compose | Full Flyd surface opened via Rails composition server | Shipped (falls back to augment when Rails is unavailable) |

### Deferred features

| Feature | Status |
|---------|--------|
| DELEGATED | Server infrastructure dormant behind `FLYD_DELEGATION_ENABLED`. Adapter-side not implemented. `/manifest` does not produce delegation responses. |

**Voice is a modality. LIVE is a consciousness/runtime state.**

### Architecture

```
Swift macOS adapter (thin OS driver)
    ├── PRESENT: NSWorkspace + AXObserver — observation only
    ├── INVOKED text/voice: environment capture → local WS relay → TypeScript Core
    ├── LIVE: audio I/O → LiveAudioBridge → TypeScript Core → OpenAI Realtime
    └── Execution: NativeExecutor (AX refs + fingerprint verification)

TypeScript Core (intelligence, memory, resolution)
    ├── HTTP server :4815 — manifest, learnings, health
    ├── Transcription WS :4816 — gpt-realtime-whisper relay
    ├── Realtime WS :4817 — gpt-realtime-2.1 session + tool relay
    ├── Memory: unified pipeline — overlay outcomes feed daemon attention → brain retrieval (5-dimension confidence profile) → Rails world state (epistemic metadata)
    └── Delegation: intent pattern matching → capability envelope (dormant behind FLYD_DELEGATION_ENABLED)

Rails (legacy composition, optional)
    └── Surface rendering, existing subsystems — not the intelligence core
```

### Privacy invariants (enforced in code)

11 falsifiable constraints — see `mac-adapter/Sources/Privacy/PrivacyInvariants.swift` for the canonical list. Key guarantees: no screenshots in PRESENT, no environment persistence after invocation, no raw audio storage, mic only during explicit user action.

Guardrails:
- Do not introduce project-first or conversation-first primary navigation.
- Do not make stored records visible merely because they exist.
- Homepage work must flow through persisted `Surface` records composed by `Flyd::Intelligence`.
- `GET /` must never call an LLM or execute provider refresh work synchronously.
- New overlay logic must not default to Rails.
- Provider output is evidence supplied to Flyd, never direct UI instructions.
- The Swift adapter never decides what to do — all intelligence routes through TypeScript Core.

## Structure

Start here for the active product (the overlay): `mac-adapter/` and `cli/src/server.ts`.
Everything under `flyd/`'s Rails tree and `cli/src/runtime/` is the older, secondary
coding-agent platform — see `README.md`'s "Coding agent platform (legacy)" section.

```
flyd/                    # repo root
  mac-adapter/           Swift Mac overlay adapter (thin OS driver — capture, render, execute)
    Makefile             build / bundle / install / run — always use `make run`, not `swift run`
    Sources/              Agent, state machine, privacy, permissions, environment, capture,
                          execution, bridge, UI, audit, auth, config

  cli/                   TypeScript — dual role, see below
    src/server.ts         "Flyd Core" — the overlay's backend (ports 4815/4816/4817)
    src/resolve.ts         Manifest → operations resolution pipeline used by the overlay
    src/transcription.ts    Voice transcription WS relay used by the overlay
    src/realtime-session.ts LIVE session WS relay used by the overlay
    src/runtime/           [legacy] Tasks, planning, routing, workers, controls, verification
    src/export-state.ts    [legacy] Versioned intelligence-state export
    package.json           npm dependencies and CLI commands (`npm run core` starts Flyd Core)

  docs/solutions/         Documented solutions to past problems (bugs, best practices,
                          workflow patterns) with YAML frontmatter (module, tags, problem_type)

  app/                    [legacy] Rails application and intelligence interfaces
  bin/rails               [legacy] Rails CLI
  config/                 [legacy] App configuration
  db/                     [legacy] Database schema and migrations
  lib/                    [legacy] LLM providers, subsystems, utilities
  test/                   [legacy] Test suite
```

## Commands

### Overlay

```bash
cd mac-adapter && make run           # Build, sign, install to ~/Applications, launch — the only supported way to run it
cd cli && npm run core                # Run Flyd Core standalone (backend only, no Mac app)
cd cli && npm test                    # Run CLI tests (also covers Core)
cd cli && npm run lint
cd cli && npm run build
```

### Coding agent platform (legacy)

```bash
bin/rails server                     # Start dev server
bin/rails test                       # Run Rails tests
bin/rails test:all                   # Include system tests
bundle exec sidekiq                  # Run provider, composition, and broadcast jobs
bin/rails flyd:runtime_listener      # Replay runtime events and update live Rails task bindings

cd cli && npm test                   # Run CLI tests
cd cli && npm run dev                # Start/resume the coding harness
cd cli && npm run dev -- code "..."  # Start with an intended outcome
cd cli && npm run dev -- task status # Inspect the exact re-entry point
cd cli && npm run dev -- task workers
cd cli && npm run dev -- task stop <worker-key>
cd cli && npm run dev -- task retry <worker-key>
cd cli && npm run dev -- task redirect <worker-key> "..."
cd cli && npm run dev -- task replace <worker-key>
cd cli && npm run dev -- task metrics
cd cli && npm run dev -- task acceptance
cd cli && npm run dev -- task acceptance review memory passed "review note"
cd cli && npm run dev -- task acceptance review rationale passed "review note"
cd cli && npm run dev -- task acceptance verify
cd cli && npm run build              # Compile dist/export-state.js
cd cli && npm run export-state       # Manual file export
cd cli && npm run export-state -- --stdout
```

## Key Files

### Overlay (active product)

- `docs/product/flyd-overlay-prd.md` — authoritative overlay PRD
- `mac-adapter/Sources/main.swift` — app entry point, invocation flow, panel lifecycle, Core process launch
- `mac-adapter/Makefile` — build/bundle/install/run; bakes `FlydRepoRoot` into `Info.plist` at build time
- `mac-adapter/Sources/UI/InvocationPanel.swift` — the "Ask Flyd" command bar (text input)
- `mac-adapter/Sources/UI/AugmentPanel.swift` — `requires_augment` resolution mode UI
- `mac-adapter/Sources/Permissions/PermissionsView.swift` — first-run onboarding (permissions, mic test, shortcut practice)
- `mac-adapter/Sources/Capture/VoiceCapture.swift` — mic capture, level metering, FFT spectrum for voice UI
- `mac-adapter/Sources/Bridge/FlydClient.swift` — HTTP client to Core's `/manifest` endpoint (port 4815)
- `mac-adapter/Sources/Bridge/VoiceTranscriptionRelay.swift` — WS client to Core's transcription relay (port 4816)
- `mac-adapter/Sources/Bridge/LiveAudioBridge.swift` — WS client to Core's realtime relay (port 4817) for LIVE mode
- `mac-adapter/Sources/Bridge/LiveSessionController.swift` — owns LIVE lifecycle: VoiceCapture, LiveAudioBridge, playback
- `mac-adapter/Sources/Audio/StreamingAudioPlayer.swift` — streaming PCM audio playback for LIVE TTS
- `mac-adapter/Sources/Execution/ConfirmationDecision.swift` — combined confirmation predicate for native execution
- `mac-adapter/Sources/Execution/ObservedTarget.swift` — execution grounding for LIVE tool-call resolution
- `mac-adapter/Sources/Auth/AdapterAuth.swift` — generates/reads the shared bearer token at `~/.flyd/overlay/auth-token`
- `cli/src/server.ts` — Flyd Core: HTTP `/manifest` + WS servers, loads `AUTH_TOKEN` once at startup from the same shared file
- `cli/src/resolve.ts` — manifest → operations/augmentations/compose resolution logic
- `cli/src/transcription.ts`, `cli/src/realtime-session.ts` — voice WS relays

### Coding agent platform (legacy)

- `docs/architecture/intelligence-generated-interface.md` — product architecture and interface contract
- `docs/product/flyd-personal-agent-platform-prd.md` — authoritative personal-agent platform PRD and release sequence
- `app/models/surface.rb` — persisted surface lifecycle and activation
- `app/models/surface_item.rb` — persisted semantic presentation objects
- `app/models/intelligence_snapshot.rb` — shared provider snapshots and health
- `app/services/surfaces/persist_plan.rb` — stores Flyd plans as drafts
- `app/services/flyd/intelligence.rb` — Flyd's surface-composition boundary
- `app/services/intelligence_state/provider.rb` — provider contract
- `app/services/intelligence_state/cli_provider.rb` — PostgreSQL-backed CLI adapter
- `app/services/intelligence_state/cli_query_provider.rb` — targeted shared-archive evidence adapter
- `app/services/intelligence_state/cli_bridge.rb` — JSON-only CLI retrieval boundary
- `app/services/intelligence_state/registry.rb` — provider aggregation
- `lib/flyd/archive_event_writer.rb` — Rails-to-shared-archive event writer
- `app/jobs/refresh_intelligence_state_job.rb` — CLI stdout ingestion
- `app/jobs/archive_event_job.rb` — background Rails event export
- `app/jobs/compose_surface_job.rb` — background composition and activation
- `app/jobs/broadcast_surface_job.rb` — retryable live surface delivery
- `cli/src/export-state.ts` — CLI state producer
- `cli/src/bridge.ts` — targeted retrieval bridge
- `cli/src/lib/brain-retrieval.ts` — shared ask/search/librarian retrieval service
- `cli/src/runtime/harness.ts` — continuity, interpretation, grant, and user-confirmation boundary
- `cli/src/runtime/assignment-planner.ts` — bounded one-or-two assignment planning
- `cli/src/runtime/orchestrator.ts` — capability routing, lifecycle, intervention, verification, and integration
- `cli/src/runtime/flyd-worker-adapter.ts` — Flyd-native worker process boundary
- `cli/src/runtime/flyd-worker-loop.ts` — resumable model/tool execution loop
- `cli/src/runtime/flyd-worker-tools.ts` — grant-scoped repository, command, and network tools
- `cli/src/runtime/flyd-worker-config.ts` — configured model/provider resolution
- `cli/src/runtime/repository-roots.ts` — explicit multi-repository grant discovery
- `cli/src/runtime/verification-commands.ts` — repository-derived independent verification commands
- `cli/src/runtime/task-store.ts` — PostgreSQL task, grant, worker, event, and session authority
- `cli/src/runtime/archive-outbox.ts` — idempotent runtime outcome delivery into `~/.flyd/raw`
- `cli/src/runtime/worktree-manager.ts` — Flyd-managed assignment isolation
- `cli/src/runtime/result-verifier.ts` — independent patch and command evidence
- `cli/src/runtime/result-integrator.ts` — unchanged-main integration boundary
- `cli/src/runtime/worker-controller.ts` — durable stop, retry, redirect, and replace controls
- `cli/src/runtime/recovery.ts` — stale-process reconciliation on restart
- `app/models/agent_task.rb` — canonical coding task state
- `app/models/task_grant.rb` — approved worker scope and lifecycle
- `app/models/worker_session.rb` — durable worker process/session state
- `app/models/runtime_event.rb` — transactional task event journal
- `app/models/task_artifact.rb` — immutable verified runtime artifacts
- `app/models/task_correction.rb` — user-authoritative task corrections
- `app/services/agent_runtime/event_listener.rb` — leased PostgreSQL notification replay
- `app/jobs/broadcast_runtime_observation_job.rb` — high-frequency worker activity delivery without recomposition
- `app/services/runtime_tasks/action_executor.rb` — Rails-to-runtime command boundary
- `app/services/runtime_tasks/binding_presenter.rb` — revision-safe task scene binding
- `app/services/context_resolver.rb` — temporary context-routing support
- `app/services/surface/planner.rb` — compatibility delegate only; contains no intelligence
- `config/flyd.yml` — app configuration
- `lib/llm/provider.rb` — LLM provider abstraction
- `lib/subsystems/` — memory, belief, and behaviour evidence systems

## Overlay Gotchas

### JSON key format — Core sends camelCase, Swift must match

`server.ts:65` uses `JSON.stringify(body)` which produces camelCase. The Swift decoder in `FlydClient.post()` must NOT use `.convertFromSnakeCase` — properties match the JS keys directly. Response types (ResolutionResponse, AugmentPayload, etc.) should omit CodingKeys entirely since property names match server keys.

Manifest REQUEST structs (ManifestPayload, EnvironmentPayload, etc.) DO use explicit CodingKeys mapping to snake_case (`invocationId = "invocation_id"`). The encoder no longer uses `.convertToSnakeCase`; the CodingKeys are the sole source of the key name.

### Main thread safety — processInvocation runs on a background Task

`handleInvocation()` and `handleVoiceInvocation()` create `Task { await processInvocation(...) }`. This runs on a cooperative background thread — NOT the main actor. Every AppKit call inside `processInvocation` must be wrapped in `await MainActor.run {}`:

```swift
await MainActor.run {
    invocationPanel.dismiss()
    state.transition(to: .present)
}
```

`state.cancelInvocation()` and `stateMachine.cancel()` are thread-safe (they touch in-memory state, not AppKit). But `invocationPanel.dismiss()` and `invocationPanel.updateState()` are not — they call `NSPanel.orderOut()` and `NSTextField.stringValue =` which require the main thread.

### No deadline task — let FlydClient timeout be the sole timeout

The old `deadlineTask` in `processInvocation` fired after 10s, showed "Timed out — try again", then the error auto-dismiss (8s later) called `activeInvocationTask?.cancel()`. This cancelled the in-flight URLSession `data(for:)` call, producing `NSURLErrorCancelled (-999)` and showing "Cannot reach Flyd" — even though Core was running fine.

Don't add a deadline task. `FlydClient.post()` has `request.timeoutInterval = 60` which is sufficient. The only timeout should be the network timeout.

### AugmentPanel — mouse events, dragging, and multiple cards

- `panel.ignoresMouseEvents` is `false` for interactive kinds (`choice`/`control` — has options or is a control) so their buttons and close button work, and `true` for non-interactive kinds (`explanation`/`annotation`) so the user can click through to the app underneath, per the PRD's click-through requirement. Non-interactive cards **omit the close button entirely** rather than leaving it visible-but-dead — a prior attempt gated the flag on `!hasOptions` without hiding the button, which broke it (`ignoresMouseEvents=true` makes the whole window transparent at the window-server level, so nothing inside it, including the close button, can receive clicks). The fix must hide the button, not just flip the flag.
- `panel.isMovableByWindowBackground = true` enables dragging the card by its background (green-hued glass area, not the close button) — interactive cards only, since drag is itself a mouse event.
- Card position must be clamped to `screen.visibleFrame` bounds — otherwise it renders off-screen near the bottom or right edge. `AugmentPanel.measure()` and `AugmentPanel.stackedFrames()` are pure functions (see `AugmentPanelTests.swift`) that compute size and clamped layout independently of any live `NSPanel`/`NSScreen`.
- Multiple augmentations in one resolution each get their own `AugmentPanel` instance, stacked vertically from a single anchor point (`showAugmentations()` in `AugmentPanel.swift`) — do not reuse one panel instance across a loop calling `.show()` repeatedly. `.show()`'s first line is `dismiss()`, so reusing one instance silently drops every augmentation but the last.
- Escape key and click-outside global monitor both dismiss the card.
- 30-second auto-dismiss timer prevents orphaned cards.

### Resolution prompt — general questions must route to augment mode

The prompt in `resolve.ts` `buildResolutionPrompt()` instructs the LLM to use `requires_augment` for general questions (rule 4). Without this rule, the LLM inserts answers into the focused element (e.g., the browser URL bar) via `insert_text` operations. The prompt template includes separate JSON formats for `native`, `requires_augment`, and `requires_compose` modes so the LLM produces valid augmentations with `kind`, `content`, and `placement` fields.

### Build & install cycle

```bash
make -C mac-adapter install    # builds → signs → copies to ~/Applications → kills old process
```

The old Core process is also killed (`lsof -ti tcp:4815,4816,4817 | xargs -r kill -9`). User must reopen `~/Applications/Flyd.app` — the adapter auto-launches Core. After kill, Core may take ~2s to restart before requests succeed.

Do NOT run `xcodebuild` from Terminal — it invalidates TCC permissions. Use `make run` or `make install`.

## Known Issues

### Overlay

- Local dev signing (no Developer ID, no notarization) means every rebuild resets Accessibility/Input Monitoring/Screen Recording/Microphone grants — expected, re-grant after each `make run`.
- Without `FLYD_MODEL_API_KEY` set in `cli/.env`, `resolve()` falls back to `requires_compose` (opens a browser tab) instead of answering inline — this is a Core config gap, not an adapter bug.
- GUI-launched processes inherit a minimal `PATH` (no Homebrew, nvm, `.local/bin`) and a `/` working directory — never assume either is set; `main.swift` resolves both explicitly (login shell for `npm`, baked `FlydRepoRoot` for `cli/`).
- Launching the raw `FlydMacAdapter` binary directly from Terminal (instead of via `open`/`make run`) can make macOS attribute TCC permission checks to the wrong "responsible process," showing grants as revoked even when they aren't — always test via `make run`.

### Coding agent platform (legacy)

- World state is bounded by serialized character count, not model-specific tokens.
- Large archive queries can be slow while the local QMD index or embedding model warms up.
- Production web and worker processes must share the configured `FLYD_DIR` volume for Rails-to-CLI memory parity.
- The current context resolver still assumes project-shaped persistence after interpretation.
- The native worker currently uses an OpenAI-compatible chat-completions provider; broader provider protocols still need first-class support.
- Additional repositories are grant-scoped context; each repository that needs edits requires its own isolated assignment and integration boundary.
- The local propagation target is below two seconds, but production latency still needs measurement under the Release 1C dogfood window.
