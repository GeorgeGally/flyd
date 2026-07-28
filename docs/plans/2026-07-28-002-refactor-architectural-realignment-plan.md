---
title: Flyd architectural realignment — documentation truth, LIVE reconnection, confirmation contract, delegation decision, and intelligence loop reconciliation
type: refactor
status: active
date: 2026-07-28
origin: ad-hoc architectural review (ChatGPT + DeepSeek + adversarial pass, 2026-07-28)
deepened: 2026-07-28
---

# Flyd architectural realignment

## Summary

Five workstreams that move Flyd from "working overlay with documentation debt, phantom features, and unexpressed product thesis" to "documentation-grounded overlay with intentional architecture across all shipped modes." Workstreams 1-4 clean up documentation drift, reconnect LIVE with proper protocol design, fix the confirmation safety contract, and shelve delegation cleanly. Workstream 5 reconciles the existing daemon-based continuous-intelligence loop with the overlay's memory pipeline — documenting the actual architecture rather than proposing a new one.

Each workstream is independently shippable after its predecessor completes. The LIVE shortcut is left as a design decision to be made before U2 begins.

---

## Problem Frame

The Flyd overlay shipped substantial M0-M2 functionality, but the repository describes an architecture with six "interaction modes" when only two have adapter-side implementations. LIVE mode has a running Core backend (port 4817) with zero Swift client code — and the backend's protocol has no readiness handshake, fabricates a fake execution environment for tool calls, and was designed without a real-time audio path to the adapter. DELEGATED has a full server-side validation pipeline but no adapter-side lifecycle, and its intent classifier triggers on absurdly broad patterns. The confirmation safety gate — Core's `requiresConfirmation` for consequential operations — conflates intent-level consequence ("sending email is dangerous") with execution-level consequence ("Flyd is about to click send"), when only the latter should require authorization. And the product's distinguishing thesis — that Flyd accumulates understanding across sessions — exists in the CLI daemon's attention/tension/curiosity loop, whose connection to the overlay's memory pipeline is partially broken by schema mismatches and indexing gaps.

The cost is not just documentation debt. Every agent that reads AGENTS.md assumes LIVE and DELEGATED are implemented. The realtime server listens on every Core launch with no consumer. The confirmation gate applies to intentions whose operations are already harmless (an email draft). And synthesized beliefs are persisted as JSON that neither the QMD index nor the attention loop can read.

---

## Requirements

- **R1.** AGENTS.md, README.md, and `docs/product/flyd-overlay-prd.md` accurately describe the shipped product: shortcuts, adapter modes, resolution outcomes, status indicator states, and implementation status of deferred features.
- **R2.** The architecture documentation cleanly separates adapter runtime state (PRESENT, INVOKED, LIVE), input modality (text, voice), work strategy (immediate, delegated), and manifestation (native, augment, compose). Delegation and composition remain resolution outcomes, not adapter modes.
- **R3.** A user-chosen shortcut (design decision: TBD before U2) invokes a persistent realtime voice session via the existing Core realtime WS backend. The same shortcut again exits. The shortcut is not hardcoded as Ctrl×3 — it is chosen for Flyd specifically.
- **R4.** LIVE state is integrated into the adapter's state machine, status indicator, and audit recording. LIVE uses its own internal session-state machine, separate from the one-shot `InvocationPhase` pipeline.
- **R5.** Core's `requiresConfirmation` gates only operations Flyd itself is about to execute that have external consequences — not the user's intent-level consequence. The existing replacement-size safety gate is renamed to `requiresReplacementConfirmation`. Both predicates feed a single combined confirmation prompt.
- **R6.** `isDelegationIntent()` is replaced with explicit delegation framing patterns that require the user to explicitly request delegation. Broad patterns are removed.
- **R7.** Delegation is shelved: endpoints return 501 unless `FLYD_DELEGATION_ENABLED=true` is set. Even with the flag, `/manifest` does NOT attach `delegationEnvelope`. AGENTS.md marks DELEGATED as dormant.
- **R8.** The existing continuous-intelligence architecture is documented: the daemon's capture → attention → tension → curiosity → investigation → nudge loop, its actual (partially broken) connection to the overlay's memory pipeline, and the specific gaps.
- **R9.** All five workstreams have test coverage for their feature-bearing units.

---

## Scope Boundaries

- LIVE restoration is minimum-viable: realtime voice session start/stop via chosen shortcut, bidirectional audio I/O, proper observation bridge for tool-call resolution, status indicator. Conversation history persistence and persistent LIVE panel are deferred.
- **LIVE MVP requires headphones.** Full-duplex audio (mic on, speaker output) without echo cancellation means the assistant will hear itself through the Mac speakers. Headphones eliminate the feedback loop. Echo cancellation / voice-processing I/O is deferred.
- The realtime protocol is fixed (ready handshake added, `resolution_result` replaces `resolve_operations`, `ObservedTarget`/`observationId` for execution grounding). LIVE action resolution uses fresh environment capture, not fabricated state.
- LIVE and INVOKED share a single `ResolutionApplier` component — LIVE does not create a second execution pipeline.
- Confirmation contract fixes the vocabulary clash, separates intent consequence from execution authorization, transports Core's signal, and combines both predicates into a single prompt.
- Delegation server endpoints are preserved behind a flag. `isDelegationIntent()` is rewritten for explicit framing only. `/manifest` never attaches `delegationEnvelope` in this plan, regardless of flag.
- The durable intelligence workstream documents existing architecture and actual gaps — it does not build new stores or loops.
- Shortcut customisation and re-binding UI remain out of scope.
- The PRD update is a status/shortcut accuracy pass, not a full product redefinition.
- Tool-call visualization during LIVE is deferred.

### Deferred to Follow-Up Work

- Full delegation lifecycle: progress UI, approval flow, cancellation, handoff rendering, completion polling
- LIVE conversation history and persistent LIVE panel
- Tool-call visualization during LIVE sessions
- Echo cancellation / voice-processing I/O for speaker-phone mode
- Per-operation-type confirmation UI for consequential operations
- Shortcut configuration UI
- Cross-PRD reconciliation with the coding-agent platform PRD
- Continuous-intelligence loop connection: fixing the schema and indexing gaps identified in U14

---

## Context & Research

### Relevant Code and Patterns

- **State machine:** `mac-adapter/Sources/State.swift` — `FlydMode` (present/invoked), `InvocationPhase` (one-shot invocation sub-states), `FlydState.transition()` with NotificationCenter broadcasts. `FlydState` is a passive container — it does not own controllers. Adding `.live` follows the existing pattern. LIVE gets its own internal `LiveSessionState` enum in `LiveSessionController` — it does not contaminate `InvocationPhase`.
- **Shortcut routing:** `mac-adapter/Sources/Capture/ShortcutRouter.swift` — case-less enum, pure functions on `CGEventFlags` (`.flagsChanged` only), returns `ShortcutRouteEvent`. Adding a new shortcut requires rising-edge detection, not key-down semantics. `mac-adapter/Sources/Capture/InvocationStateMachine.swift` — CGEvent tap bridge with callback properties. `handleShortcutPress()` returns early when `state.phase == .idle` — LIVE (which leaves InvocationPhase idle) must be explicitly handled there.
- **WebSocket client:** `mac-adapter/Sources/Bridge/VoiceTranscriptionRelay.swift` — singleton, serial DispatchQueue, sessionToken invalidation, `[weak self]` callbacks, JSON message protocol.
- **Voice capture:** `mac-adapter/Sources/Capture/VoiceCapture.swift` — mic capture, level metering, FFT spectrum.
- **Realtime server protocol:** `cli/src/realtime-session.ts` — adapter→Core: `start`, `audio`, `stop`. Core→adapter: `audio_output`, `transcript_delta`, `resolve_operations`, `error`. No `ready` handshake. Tool-call handler (lines 231-243) fabricates `application: "LIVE session"`, `element: "el_01"`. Early audio packets silently dropped when `openaiWs` is null.
- **Resolution response:** `mac-adapter/Sources/Bridge/FlydClient.swift` — `ResolutionResponse` uses NO CodingKeys. `mac-adapter/Sources/main.swift` — resolution switch at line 604 dispatches native/augment/compose, with execution logic including stale-revision checks, target verification, confirmation, outcome reporting, undo.
- **Replacement gate:** `mac-adapter/Sources/Execution/ReplacementGate.swift` — `requiresConfirmation()` checks text-change magnitude.
- **Core server:** `cli/src/server.ts` — `startRealtimeServer()` called unconditionally (line 520). `cli/src/resolve.ts` — `assessConsequence()` at line 596-598, `requiresConfirmation` set at line 597. Consequence currently assessed on intent (e.g., "send email" → consequential), but resolved operations are always insert/replace text (harmless). The gate fires on intent-level danger, not execution-level danger.
- **Status indicator:** `mac-adapter/Sources/UI/StatusItem.swift` — `updateColor(for:)` switch on `FlydMode` (grey/blue).
- **Attention/intelligence daemon:** `cli/src/commands/daemon.ts` — incremental poll loop using `findNewCapturesSince()` (non-recursive). `loadCaptureDocs()` (recursive via `RAW_DIR`). `cli/src/lib/attention.ts` — `AttentionSignal` type. `cli/src/lib/tension.ts`, `cli/src/lib/curiosity.ts`.
- **Memory pipeline — overlay side:** `cli/src/server.ts:257-288` — receipts written to `~/.flyd/raw/overlay/*.md`. Synthesized beliefs written as `~/.flyd/raw/overlay/synthesis-*.json`. BELIEF_STORE is in-process memory.
- **Memory pipeline — daemon side:** `loadCaptureDocs()` reads `**/*.md` recursively, so overlay receipts are physically discovered. But receipts use `generated_at`, `category`, `confidence` in body/frontmatter, while attention expects `timestamp`/`date`/`created`, `event_type`/`type`, `outcome`, `signal`. Receipts enter attention with empty date, `observation` eventType, null outcome/signal — losing semantics. `findNewCapturesSince()` is non-recursive, so overlay receipts are never processed incrementally. Synthesized `.json` files are invisible to QMD (indexes `.md` only) and to `loadCaptureDocs()`.

### Institutional Learnings

- **Orphaned Tasks** (`docs/solutions/security-issues/overlay-deep-review-auth-bypass-orphaned-tasks-2026-07-23.md`): Store `activeInvocationTask` and cancel on re-invocation. LIVE needs `liveSessionTask` storage and cancellation.
- **CGEvent modifier flood**: Rising-edge detection required. New shortcut detection must guard against modifier floods.
- **Thin-adapter architecture**: Adapter never decides. LIVE tool-call resolution must request fresh observation, not fabricate state.
- **`handleShortcutPress()` early return**: Returns immediately while `state.phase == .idle`. LIVE shortcuts during idle mode must be explicitly handled before this early return or in a separate callback path.

### External References

No external research was conducted. All work follows existing conventions.

---

## Key Technical Decisions

- **Separate adapter mode vocabulary from resolution manifestation.** AGENTS.md and README.md use distinct terms: adapter modes (PRESENT, INVOKED, LIVE) describe the Swift adapter's operational state; resolution outcomes (native, augment, compose) describe how Core's answer manifests; input modality (text, voice) describes the user's invocation method.
- **LIVE shortcut is a design decision, not hardcoded.** The exact gesture is chosen for Flyd specifically. Placeholder `[LIVE_SHORTCUT]` resolved before U2. Rising-edge detection on `.flagsChanged`, not key-down semantics.
- **LiveSessionController owns LIVE lifecycle, not main.swift.** Holds `VoiceCapture`, `LiveAudioBridge`, and audio playback. main.swift delegates start/stop. FlydState remains a passive container — it does not hold controller references.
- **Realtime protocol adds a ready handshake and uses `resolution_result` for shared execution.** Core sends `connecting` → `ready` after OpenAI connects. Tool-call resolution returns the full `Resolution` object as `resolution_result` (not `resolve_operations`). Both INVOKED and LIVE invoke the same `ResolutionApplier` component for execution — no second pipeline.
- **Execution is grounded in ObservedTarget, not fabricated environment.** Each `observation_request` carries `request_id`. Swift retains AXUIElement + TargetDescriptor locally keyed by `observationId`. Core echoes `observationId` in the `resolution_result`. Swift executes only against the retained target for that observation — same TOCTOU guarantee as INVOKED, without abusing `InvocationStateMachine`'s t1 checkpoint.
- **`requiresConfirmation` gates execution consequences, not intent consequences.** Core's `assessConsequence()` identifies dangerous intents (constrains reasoning to safe operations like drafting). But `requiresConfirmation` is only set when the actual resolved operations have external effects. Currently all native operations are text insertion/replacement — none have external consequences. This fixes the bug where "send an email" triggers confirmation for a harmless draft insertion. The gate is architecturally correct for future operations like click, send, delete, purchase.
- **Confirmation gating: separate predicates, single prompt.** Both `requiresConfirmation` (execution consequence) and `requiresReplacementConfirmation` (destructive text change) feed one `ConfirmationDecision` → ONE prompt.
- **Delegation is dormant even with the flag.** Endpoints behind `FLYD_DELEGATION_ENABLED`. `/manifest` never attaches `delegationEnvelope`.
- **U14 documents actual architecture, not aspirational.** Overlay receipts are physically connected to daemon (files under `~/.flyd/raw/overlay/`) but semantically broken by frontmatter schema mismatch and non-recursive incremental processing. Synthesized beliefs are persisted as JSON invisible to QMD. Goals/tensions already integrated into resolution. Attention signals are not. The findings are specific and falsifiable.

---

## Open Questions

### Resolved During Planning

- **Should the LIVE gesture be hardcoded as Ctrl×3?** No. Design decision before U2. Placeholder `[LIVE_SHORTCUT]`.
- **Should LIVE phases live inside InvocationPhase?** No. `LiveSessionState` enum is separate.
- **Should audio playback be deferred?** No. Bidirectional audio I/O with streaming PCM playback is essential.
- **Should LIVE create a second execution pipeline?** No. Shared `ResolutionApplier` for both INVOKED and LIVE.
- **Should the confirmation prompt be one or two prompts?** One combined prompt.
- **Should /manifest ever attach delegationEnvelope?** Not in this plan.
- **Should LIVE require headphones?** Yes, for MVP. Echo cancellation deferred.
- **Should FlydState own controller references?** No. FlydState is passive. Controllers cause transitions.

### Deferred to Implementation

- Exact LIVE shortcut gesture
- Rising-edge detection timing parameters
- `observation_request` / `observation` exact message shape
- Shortcut conflict detection with system bindings

---

## High-Level Technical Design

### Shared ResolutionApplier

Both INVOKED and LIVE resolve through the same execution path. Core returns a full `Resolution`, Swift applies it:

```
                    resolve() by Core
                         ↓
                  full Resolution
                         ↓
                ResolutionApplier.apply(resolution, target?)
                    ↙      ↓      ↘
                native  augment  compose
                  ↓
            collect confirmation reasons
                  ↓
            ONE confirmation prompt (if needed)
                  ↓
            target verify (revision + fingerprint + ObservedTarget)
                  ↓
            NativeExecutor.execute()
                  ↓
            outcome report + undo
```

`ResolutionApplier` is extracted from the existing INVOKED execution path in `processInvocation()`. Both callers invoke the same component.

### LIVE protocol (after fix)

```
Swift LiveSessionController                    Core realtime server (4817)
        │                                                  │
        │──── {"type":"start"} ──────────────────────────→│
        │←── {"type":"connecting"} ───────────────────────│
        │                                                  │──→ wss://api.openai.com/v1/realtime
        │←── {"type":"ready"} ────────────────────────────│   (OpenAI WS open)
        │                                                  │
        │──── {"type":"audio","audio":"<base64>"} ───────→│  (mic chunks begin — only after ready)
        │←── {"type":"transcript_delta","text":"..."} ────│
        │←── {"type":"audio_output","audio":"<base64>"} ──│  (TTS PCM deltas → headphones)
        │                                                  │
        │  [Model calls flyd_resolve_intent]               │
        │←── {"type":"observation_request",                │
        │      "request_id":"req_01"} ────────────────────│
        │                                                  │
        │  [Swift: capture env, create ObservedTarget]     │
        │  ObservedTarget {                                 │
        │    observationId: "obs_01"                        │
        │    revision: N                                   │
        │    environment: {...}     (serializable, to Core) │
        │    fingerprint: {...}                             │
        │    target: AXUIElement    (Swift-only, retained)  │
        │    descriptor: TargetDescriptor                   │
        │  }                                               │
        │                                                  │
        │──── {"type":"observation","request_id":"req_01",  │
        │      "observation_id":"obs_01","env":{...}} ────→│
        │                                                  │──→ resolve() with real env
        │←── {"type":"resolution_result",                  │
        │      "call_id":"call_01",                         │
        │      "observation_id":"obs_01",                   │
        │      "resolution":{...full Resolution...}} ──────│
        │                                                  │
        │  [Swift: lookup ObservedTarget by observationId]  │
        │  [Swift: ResolutionApplier.apply(resolution,      │
        │           target: observedTarget)]                 │
        │                                                  │
        │──── {"type":"stop"} ────────────────────────────→│
        │←── connection closed ───────────────────────────│
```

### LIVE state machine

```
FlydMode: .present | .invoked | .live

LiveSessionState (internal to LiveSessionController, NOT InvocationPhase):
    disconnected → connecting → active → disconnecting → (disconnected | failed)

PRESENT  ──[LIVE_SHORTCUT]──→  LIVE
LIVE     ──[LIVE_SHORTCUT]──→  PRESENT
LIVE     ──[INVOKE]─────────→  PRESENT (cancel LIVE, then invoke)
INVOKED  ──[LIVE_SHORTCUT]──→  No-op
```

`handleShortcutPress()` returns early during idle phases. Since LIVE leaves InvocationPhase idle, the LIVE toggle callback runs independently of the invocation state machine. `handleInvocation()` / `handleVoiceInvocation()` must explicitly check `state.mode == .live` and call `liveSessionController.stop()` before starting one-shot invocation.

### Confirmation flow (after fix)

```
Core resolve() → assessConsequence() → constrains reasoning to safe ops
    ↓
Operations resolved as insert_text / replace_text (safe)
    ↓
If operations have external consequence (click, send, delete — future):
    resolution.requiresConfirmation = true
    ↓
Server sends ResolutionResponse { requiresConfirmation: true, ... }
    ↓
Swift collects ConfirmationDecision:
    reasons: []
    if resolution.requiresConfirmation → .executionConsequence
    if ReplacementGate.requiresReplacementConfirmation(op) → .destructiveReplacement
    ↓
    ONE prompt (if reasons non-empty)
    ↓ (confirmed)
ResolutionApplier executes
```

Today no native operation types have external consequences. The gate is architecturally correct for future operation kinds. The intent-level `assessConsequence()` remains — it constrains the LLM to safe operations — but does not directly set `requiresConfirmation`.

### Continuous intelligence architecture (reconciled from existing code)

```
CLI daemon (cli/src/commands/daemon.ts)       Overlay Core (cli/src/server.ts)
        │                                                │
        │  capture → index → embed                        │  memory-gate ← manifest/outcome
        │         ↓                                       │         ↓
        │  attention ← loadCaptureDocs()                  │  createMemoryReceipt
        │  tension ← computeTension(goals, docs)           │         ↓
        │         ↓                                       │  persistReceipt → ~/.flyd/raw/overlay/*.md
        │  curiosity ← generateQuestions(attn, tension)    │         ↓
        │         ↓                                       │  provisionalLearn (in-memory)
        │  investigation ← investigateQuestion()           │         ↓
        │         ↓                                       │  /learnings/synthesize
        │  nudge ← generateNudges(signals)                 │         ↓
        │         ↓                                       │  BELIEF_STORE (in-memory)
        │  wiki/nudges.md                                  │  synthesis → ~/.flyd/raw/overlay/synthesis-*.json
        │  wiki/attention-report.md                        │
        │  wiki/tension-report.md                          │
        │  wiki/curiosity-log.md                           │
        │  wiki/goals/*.md                                 │
        │                                                │
        │  export-state.ts reads both pipelines           │
        │  and exports unified evidence payload            │

Existing connections:
✓ Overlay receipts → daemon: PHYSICALLY connected (files land under
  ~/.flyd/raw/overlay/*.md, loadCaptureDocs() is recursive). SEMANTICALLY
  broken: receipts use generated_at / category / confidence fields, while
  attention expects timestamp/date/created, event_type/type, outcome, signal.
  Receipts enter attention with empty date, observation eventType, null
  outcome/signal — losing all semantics.

✓ Goals/tensions → resolver: ALREADY integrated. resolve() reads goals and
  tensions into the resolution context prompt.

✗ Attention signals → resolver: NOT integrated. AttentionSignal data is
  built into IntelligenceState (export-state.ts) but the resolution prompt
  does not consume it.

✗ Synthesized beliefs → durable operational memory: BROKEN. Synthesis
  writes ~/.flyd/raw/overlay/synthesis-*.json. QMD indexes *.md only.
  loadCaptureDocs() reads *.md only. BELIEF_STORE is process-memory and
  does not survive restart. Synthesis output is effectively invisible.

✗ Overlay receipts → incremental daemon processing: BROKEN.
  findNewCapturesSince() is non-recursive — overlay receipts in
  ~/.flyd/raw/overlay/ are never treated as new captures by the incremental
  link/interest path. They only appear in full batch attention scans.

✗ Daemon-side trigger for overlay outcomes: NONE. No daemon-side trigger
  when overlay outcomes suggest a new tension or resolved goal.
```

Identified gaps are documented, not implemented. Their resolution belongs to a follow-up plan.

---

## Implementation Units

### U1. Baseline documentation truth

**Goal:** AGENTS.md, README.md, and the overlay PRD accurately describe the shipped product. Architecture documentation cleanly separates adapter modes, input modality, and resolution manifestation.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- `AGENTS.md`
- `README.md`
- `docs/product/flyd-overlay-prd.md`

**Approach:**

AGENTS.md:
- Replace the "Interaction modes" table with "Adapter modes" table (PRESENT, INVOKED text, INVOKED voice) with an implementation-status column.
- Add a separate "Resolution outcomes" table (native, augment, compose) with status.
- Fix all shortcut references: INVOKED text = double-tap fn key, INVOKED voice = fn+Ctrl hold.
- Add a "Deferred features" subsection: LIVE (server infrastructure, adapter pending — shortcut TBD), DELEGATED (server infrastructure dormant behind feature flag).
- Replace architecture ASCII diagram's LIVE and DELEGATED lines with status annotations.

README.md:
- Fix Shortcuts table: double-tap fn for text, fn+Ctrl hold for voice. Remove Ctrl×3 / LIVE row.
- Fix status indicator description: remove green/LIVE since it's not shipped.
- Update architecture diagram to match.

PRD:
- Update Status line to reflect actual shipped state.
- Update consciousness hierarchy table: mark LIVE as "server infrastructure only."
- Fix shortcut references.

**Patterns to follow:** AGENTS.md bold thesis statements, table conventions; README.md two-tier overlay/legacy structure; PRD milestone naming.

**Test scenarios:**
- Every shortcut in docs matches `ShortcutRouter.swift` routing
- Every mode in AGENTS.md's "adapter modes" table has a case in `FlydMode` or is marked not shipped
- README.md status indicator matches `StatusItem.updateColor(for:)` switch cases
- PRD doesn't claim shipped status for features without adapter code

**Verification:** A reviewer unfamiliar with the codebase can accurately predict what shortcuts trigger what behaviors.

---

### U2. Add LIVE shortcut detection to ShortcutRouter

**Goal:** `ShortcutRouter.route()` detects the chosen LIVE gesture and emits a `.liveToggle` event.

**Requirements:** R3

**Dependencies:** None (parallelizable with U1). Shortcut gesture must be decided before implementation.

**Files:**
- `mac-adapter/Sources/Capture/ShortcutRouter.swift`
- `mac-adapter/Tests/ShortcutRoutingTests.swift`

**Approach:**

The `[LIVE_SHORTCUT]` placeholder is resolved before this unit begins. Implementation uses rising-edge detection on `.flagsChanged` (not key-down semantics). For modifier-chord: detect exact flag match when previous state was unmatched. For multi-press: track press count + timing window with rising-edge detection.

Add `case liveToggle` to `ShortcutRouteEvent`.

Guard: `.liveToggle` never fires when voice is active or during `.invoked` mode (checked at InvocationStateMachine layer — router remains a pure flag classifier). LIVE shortcut must also be handled in `handleShortcutPress()` which currently returns early for `.idle` phase — the toggle fires via a separate callback, not through the invocation start path.

**Execution note:** Start with failing tests for gesture detection, wrong modifiers, rapid repeat, timeout.

**Patterns to follow:** `ShortcutRouter`'s pure-function pattern, rising-edge voice-chord detection (lines 40-45), `ShortcutRouteEvent` enum convention.

**Test scenarios:**
- Gesture detected → `.liveToggle`
- Gesture with wrong modifiers → `.none`
- Rapid repeat → clean toggle each time
- Gesture during voice chord → no `.liveToggle`
- Timeout after partial gesture → state resets

**Verification:** `swift test` passes all new shortcut test cases. Existing tests unchanged.

---

### U3. Gate realtime server behind feature flag

**Goal:** Core's realtime WS server on port 4817 does not start unless `FLYD_LIVE_ENABLED=true`.

**Requirements:** R3 (pre-work for LIVE units)

**Dependencies:** None

**Files:**
- `cli/src/server.ts`

**Approach:**

- Add `const LIVE_ENABLED = process.env.FLYD_LIVE_ENABLED === "true"`.
- Wrap `startRealtimeServer()` and `stopRealtimeServer()` in `if (LIVE_ENABLED)`.
- Log: `console.log("[core] LIVE mode disabled (set FLYD_LIVE_ENABLED=true to enable)")`.

Remove the conditional when LIVE ships — added to U15's file list.

**Patterns to follow:** Same pattern as U12 delegation gate.

**Test scenarios:**
- `FLYD_LIVE_ENABLED` unset → port 4817 has no listener
- `FLYD_LIVE_ENABLED=true` → port 4817 listening

**Verification:** `cd cli && npm test` passes. Manual: verify port with `lsof -i :4817`.

---

### U4. Add ready handshake and fix realtime server protocol

**Goal:** Core realtime server sends `connecting` and `ready` messages after `start`. Tool-call resolution returns `resolution_result` (full Resolution object, not `resolve_operations`). `observation_request` includes `request_id`.

**Requirements:** R3

**Dependencies:** None (must complete before U5 can be verified end-to-end)

**Files:**
- `cli/src/realtime-session.ts`
- `cli/src/__tests__/realtime-session.test.ts`

**Approach:**

In the `connection` handler, after receiving `{"type":"start"}`:
1. Send `{"type":"connecting"}` immediately.
2. Call `connectRealtime()` (existing code).
3. After OpenAI WS opens + session.update sent: send `{"type":"ready"}`.
4. If `connectRealtime()` fails: send `{"type":"error"}` and close.

Change tool-call response protocol:
- Replace `adapterWs.send({ type: "resolve_operations", ... })` with `adapterWs.send({ type: "resolution_result", call_id, observation_id, resolution })`.
- The resolution is the full validated Resolution object — Core does not pre-digest operations.

Add `request_id` to observation_request messages for request/response correlation.

Final protocol: adapter→Core: `start`, `audio`, `stop`, `observation`. Core→adapter: `connecting`, `ready`, `transcript_delta`, `audio_output`, `resolution_result`, `error`, `observation_request` (with `request_id`).

**Patterns to follow:** Existing `ws.send(JSON.stringify(...))` pattern, existing `switch(msg.type)` dispatch.

**Test scenarios:**
- Adapter sends `start` → Core sends `connecting`, then `ready`
- Audio before `ready` → Core buffers or drops gracefully
- OpenAI connection fails → Core sends `error`, closes adapter WS

**Verification:** `cd cli && npm test` passes. Integration: `FLYD_LIVE_ENABLED=true npm run core`, connect with `wscat -c ws://127.0.0.1:4817`, send `{"type":"start"}`, verify `connecting` then `ready`.

---

### U5. Create LiveAudioBridge WebSocket client

**Goal:** Swift WebSocket client connects to Core's realtime server, handles the full protocol (ready handshake, `resolution_result`), and manages persistent session lifecycle.

**Requirements:** R3

**Dependencies:** U4 (protocol fixed server-side first)

**Files:**
- `mac-adapter/Sources/Bridge/LiveAudioBridge.swift` (new file)
- `mac-adapter/Tests/LiveAudioBridgeTests.swift` (new file)

**Approach:**

Mirror `VoiceTranscriptionRelay.swift`'s pattern: singleton, serial DispatchQueue, sessionToken invalidation, `[weak self]` callbacks, bearer auth.

Protocol handling (matching U4):
- Send `{"type":"start"}` after WebSocket connects.
- Only send audio after receiving `{"type":"ready"}`.
- Handle incoming: `transcript_delta` → callback, `audio_output` → decode base64 → callback, `resolution_result` → deliver full Resolution to LiveSessionController for ResolutionApplier, `error` → disconnect, `observation_request` → capture env + respond with observation.
- On `stop`: send `{"type":"stop"}`, close WebSocket.

Connection lifecycle: `connect()` → `.connecting` → receive `ready` → `.active`. `disconnect()` → send `stop` → `.disconnecting` → closed → `.disconnected`. Error → `.failed`.

**Execution note:** Build with TDD. Connection lifecycle is pure state-machine logic testable with mocked URLSessionWebSocketTask.

**Patterns to follow:** `VoiceTranscriptionRelay.swift` singleton + queue + token pattern.

**Test scenarios:**
- Connect → send `start` → receive `connecting` → receive `ready` → state `.active`
- Send audio only after ready
- Receive `audio_output` → base64 decoded → callback
- Receive `resolution_result` → full Resolution delivered
- Disconnect during active session → `stop` sent, state `.disconnected`

**Verification:** Unit tests with mocked WS. Integration with live Core.

---

### U6. Add streaming PCM audio playback

**Goal:** Core's `audio_output` messages (24kHz PCM base64 deltas) are decoded and played through system audio output in real time. Audio output goes to headphones (MVP requirement).

**Requirements:** R3

**Dependencies:** U5 (bridge delivers audio data)

**Files:**
- `mac-adapter/Sources/Audio/StreamingAudioPlayer.swift` (new file)
- `mac-adapter/Tests/StreamingAudioPlayerTests.swift` (new file)

**Approach:**

`AVAudioEngine` + `AVAudioPlayerNode` + PCM buffer scheduling:
- 24kHz sample rate, mono, 16-bit PCM.
- `schedulePCM(base64Encoded:)` decodes → `AVAudioPCMBuffer` → schedule.
- `start()` / `stop()` on engine + player node.
- Handle buffer underrun gracefully.

LiveSessionController integration: `bridge.onAudioReceived = { streamingAudioPlayer.schedulePCM($0) }`.

**Patterns to follow:** Existing `AVAudioEngine` conventions, `VoiceCapture`'s audio format approach.

**Test scenarios:**
- Valid base64 PCM → decoded and scheduled
- Invalid base64 → handled gracefully
- Rapid succession → scheduled in order
- Start/stop/start → clean restart

**Verification:** Integration: send mock `audio_output` with valid PCM → audio plays through system output.

---

### U7. Create LiveSessionController and wire LIVE toggle

**Goal:** LiveSessionController owns the LIVE lifecycle: VoiceCapture, LiveAudioBridge, and playback. It handles toggle start/stop. InvocationStateMachine delivers the shortcut event. main.swift delegates to the controller. INVOKED cancels LIVE first.

**Requirements:** R3, R4

**Dependencies:** U5 (bridge exists), U6 (playback exists), U2 (shortcut detected)

**Files:**
- `mac-adapter/Sources/Bridge/LiveSessionController.swift` (new file)
- `mac-adapter/Sources/Capture/InvocationStateMachine.swift`
- `mac-adapter/Sources/main.swift`

**Approach:**

LiveSessionController:
- Singleton owning: `VoiceCapture`, `LiveAudioBridge`, `StreamingAudioPlayer`.
- Internal `LiveSessionState`: `.disconnected`, `.connecting`, `.active`, `.disconnecting`, `.failed`.
- `func start()` — transition to `.live`, `voiceCapture.start()`, wire `onAudioChunk → bridge.sendAudioChunk`, `bridge.connect()`, `streamingAudioPlayer.start()`.
- `func stop()` — `voiceCapture.stop()`, `bridge.disconnect()`, `streamingAudioPlayer.stop()`, transition to `.present`.
- Stores `liveSessionTask: Task<Void, Never>?` for cancellation.
- `func handleResolutionResult(_ resolution: Resolution, observedTarget: ObservedTarget)` — invokes `ResolutionApplier.apply()`.

InvocationStateMachine:
- Add `onLiveToggle: (() -> Void)?` callback.
- In event callback: `.liveToggle` → fire `onLiveToggle?()` on main thread. Guard: ignore if `isVoiceInvocation` or Flyd is in `.invoked` mode.

main.swift:
- Wire `stateMachine.onLiveToggle = { liveController.handleToggle() }`.
- `handleToggle()`: if `isLiveActive`, call `stop()`. If not, call `start()`.
- `handleInvocation()` / `handleVoiceInvocation()`: before starting invocation, check `state.mode == .live` → call `liveController.stop()` first.
- Remove any audio wiring from main.swift — all in the controller.

**Critical:** `handleShortcutPress()` returns early when `state.phase == .idle`. LIVE toggle fires via `onLiveToggle`, not through the invocation start path. The voice/text invocation handlers (`handleInvocation`/`handleVoiceInvocation`) must explicitly handle live-mode cancellation.

**FlydState remains passive.** It does not hold a reference to LiveSessionController. The controller calls `state.transition(to:)`, not vice versa.

**Patterns to follow:** Existing callback wiring in `startFlyd()`, Task handle pattern from `activeInvocationTask`, `VoiceTranscriptionRelay` architecture.

**Test scenarios:**
- Shortcut enters LIVE → state `.connecting` → `.active`
- Shortcut during LIVE exits to `.present`
- Shortcut during invocation → ignored
- Invocation during LIVE → LIVE cancelled, then invocation starts
- Rapid toggle → clean each time, no orphaned sessions

**Verification:** Manual: `make run`, shortcut enters/exits LIVE, invocation cancels LIVE cleanly.

---

### U8. Wire LIVE microphone and add observation bridge with ObservedTarget

**Goal:** Core can request fresh environment observation when the model calls `flyd_resolve_intent`. Swift retains `ObservedTarget` locally and executes only against it. Tool-call resolution uses real environment, not fabricated state.

**Requirements:** R3

**Dependencies:** U7 (controller + bridge exist)

**Files:**
- `mac-adapter/Sources/Bridge/LiveSessionController.swift` (extend)
- `mac-adapter/Sources/Execution/ObservedTarget.swift` (new file)
- `mac-adapter/Sources/Execution/ResolutionApplier.swift` (new file — extracted from main.swift)
- `mac-adapter/Sources/main.swift` (extract ResolutionApplier, update callers)
- `cli/src/realtime-session.ts` (fix fabricated environment)

**Approach:**

ObservedTarget (new file):
- `observationId: String` — Core echoes this back in `resolution_result`.
- `revision: Int`, `environment: EnvironmentPayload`, `fingerprint: InvocationFingerprint` (serializable — sent to Core).
- `target: AXUIElement` (Swift-only, NOT serialized, retained locally).
- `descriptor: TargetDescriptor` (Swift-only).
- Keyed by `observationId` in a dictionary within LiveSessionController.

Swift side — observation capture:
- When bridge receives `{"type":"observation_request","request_id":"req_N"}`: capture current environment, create `ObservedTarget`, store keyed by `observationId`. Send `{"type":"observation","request_id":"req_N","observation_id":"obs_N","environment":{...},"fingerprint":{...},"revision":N}`.

Swift side — resolution handling:
- When bridge receives `{"type":"resolution_result","call_id":"...","observation_id":"obs_N","resolution":{...}}`: lookup `ObservedTarget` by `observationId`. Call `ResolutionApplier.apply(resolution, target: observedTarget)`. Clear stored target after execution.

ResolutionApplier (new file — extracted from main.swift `processInvocation()`):
- Shared execution component for INVOKED and LIVE.
- `apply(resolution: Resolution, target: ObservedTarget?)`:
  - Switch on resolution.mode (native/augment/compose).
  - For native: collect confirmation reasons (execution consequence + replacement), show ONE prompt if needed, verify target (revision + fingerprint + ObservedTarget), canonicalize refs, NativeExecutor.execute, outcome report, undo.
  - For augment: show augmentation panels.
  - For compose: open URL.

Core side — fix fabricated environment:
- In `handleToolCalls()`: instead of fabricating environment, send `observation_request` with `request_id`, wait for `observation` response, use that in `ManifestRequest`.
- Remove the hardcoded `application: "LIVE session"`, `window: "LIVE"`, `element: "el_01"` block.
- `environment_revision` comes from actual observation.
- On timeout (adapter doesn't respond): send error to model, do not crash.

**Execution note:** Extracting ResolutionApplier from main.swift is a refactor — ensure existing INVOKED path still works before adding LIVE integration. The extraction should be a no-op behavior change.

**Patterns to follow:** Existing environment capture in `processInvocation()`, existing operation execution in `executeNativeOperations()`, `VoiceTranscriptionRelay`'s audio wiring.

**Test scenarios:**
- Mic active → audio flows to Core
- Model calls tool → Core sends `observation_request` with `request_id`
- Adapter captures env → sends `observation` with matching `request_id` + `observation_id`
- Core resolves with real context → sends `resolution_result` with same `observation_id`
- Swift looks up ObservedTarget by `observationId` → ResolutionApplier executes
- Adapter doesn't respond to observation_request → Core sends error to model
- Multiple concurrent tool calls → distinct `request_id`/`observation_id` pairs, no cross-talk

**Verification:** End-to-end: `make run`, enter LIVE, speak request that triggers tool call. Verify resolution uses real focused element. Verify operation executes on actual target.

---

### U9. Add LIVE state management and status indicator

**Goal:** `FlydState` handles `.live` mode transitions, `StatusItem` shows green LIVE indicator, and audit records capture LIVE session lifecycle.

**Requirements:** R4

**Dependencies:** U7 (LiveSessionController exists)

**Files:**
- `mac-adapter/Sources/State.swift`
- `mac-adapter/Sources/UI/StatusItem.swift`
- `mac-adapter/Sources/Audit/AuditRecorder.swift`

**Approach:**

FlydState (State.swift):
- Add `.live` to `FlydMode` enum.
- `transition(to mode:)`: when entering `.live`, post `Notification.Name.flydModeDidChange`.
- `cancelInvocation()`: if in `.live` mode, post notification. The notification observer (registered in main.swift or LiveSessionController) calls `liveController.stop()`. FlydState remains passive — it does not hold controller references.

StatusItem (StatusItem.swift):
- In `updateColor(for:)` switch: `case .live: color = .systemGreen`.

AuditRecorder:
- `recordLiveSessionStart()` and `recordLiveSessionEnd(duration:error:)`.
- Fields: sessionId, timestamps, error string. No raw audio or transcript.

**Patterns to follow:** `FlydMode` enum convention, `StatusItem.updateColor()` switch, privacy-preserving audit fields.

**Test scenarios:**
- `.present` → `.live` → StatusItem green
- `.live` → `.present` → StatusItem grey
- LIVE session start/end create audit records

**Verification:** `swift test` passes. Manual: `make run`, shortcut → green dot, shortcut → grey dot.

---

### U10. Rename ReplacementGate.requiresConfirmation to requiresReplacementConfirmation

**Goal:** Eliminate vocabulary clash between Core's `requiresConfirmation` (execution consequence gate) and Swift's text-size confirmation gate.

**Requirements:** R5

**Dependencies:** None (parallelizable with any unit)

**Files:**
- `mac-adapter/Sources/Execution/ReplacementGate.swift`
- `mac-adapter/Sources/main.swift` (call site)
- `mac-adapter/Tests/ReplacementGateTests.swift`

**Approach:**

Rename: `requiresConfirmation(opKind:, current:, proposed:)` → `requiresReplacementConfirmation(opKind:, current:, proposed:)`. Update all call sites and tests. Add comment: "This gate checks text replacement magnitude. Separate from Core's `requiresConfirmation`, which gates operations with external consequences."

**Test scenarios:**
- All existing tests pass (pure rename)
- `replace_text` → returns true
- `insert_text` → returns false

**Verification:** `swift test` passes. No bare `requiresConfirmation` in adapter outside `ResolutionResponse`.

---

### U11. Transport Core's requiresConfirmation and unify confirmation prompt

**Goal:** Core's `requiresConfirmation` reaches Swift, gates only operations with external execution consequences (not intent-level danger). Both predicates feed a single combined prompt.

**Requirements:** R5

**Dependencies:** U10 (renamed replacement gate)

**Files:**
- `mac-adapter/Sources/Bridge/FlydClient.swift` (ResolutionResponse)
- `mac-adapter/Sources/Execution/ConfirmationDecision.swift` (new file)
- `mac-adapter/Sources/Execution/ResolutionApplier.swift` (confirmation logic)
- `cli/src/resolve.ts` (fix requiresConfirmation semantics)

**Approach:**

Core side (resolve.ts):
- `assessConsequence()` continues to classify intents as consequential — this constrains the LLM to safe operations (e.g., "draft, don't send").
- But `requiresConfirmation` is only set when the resolved operations themselves have external consequences. Today: no native operation kind has external consequences — `requiresConfirmation` is effectively never set. The field exists for future operation kinds (click, send, delete, purchase).
- Remove the automatic `resolution.requiresConfirmation = true` from `assessConsequence()`. The consequence assessment constrains reasoning; operation-level execution authorization is separate.

Swift side:
- ConfirmationDecision (new file): `enum Reason: String { case executionConsequence = "execution_consequence"; case destructiveReplacement = "destructive_replacement" }`. `let reasons: [Reason]`.
- ResolutionResponse: add `let requiresConfirmation: Bool?`.
- ResolutionApplier: before execution, collect reasons — if `resolution.requiresConfirmation == true` → `.executionConsequence`, if `ReplacementGate.requiresReplacementConfirmation(op)` → `.destructiveReplacement`. If any reasons: show ONE prompt. If cancelled: no operations, outcome `rejected`.

**Patterns to follow:** `ResolutionResponse` field addition (no CodingKeys), modal prompt pattern.

**Test scenarios:**
- `requiresConfirmation: true` + destructive replacement → single prompt with both reasons
- `requiresConfirmation: false` or absent + no destructive replacement → no prompt
- User confirms → operations execute
- User cancels → no operations, outcome `rejected`

**Verification:** Integration: send manifest with consequential intent (e.g., "send email"), verify LLM is constrained to drafting (insert_text only), verify no confirmation prompt fires for a draft insertion. Future: add executable consequential operation kind, verify prompt fires.

---

### U12. Fix isDelegationIntent() for explicit framing only

**Goal:** `isDelegationIntent()` only returns true when the user explicitly requests delegation.

**Requirements:** R6

**Dependencies:** None (parallelizable with any unit)

**Files:**
- `cli/src/delegation.ts`
- `cli/src/__tests__/delegation.test.ts`

**Approach:**

Replace all 11 patterns with explicit framing only:
- `/delegate\s+/i`
- `/spawn\s+(a|an)\s+agent\s+(to|for)\s+/i`
- `/run\s+(a|an)\s+agent\s+(to|for)\s+/i`
- `/create\s+(a|an)\s+agent\s+(to|for)\s+/i`
- `/do\s+this\s+in\s+the\s+background/i`

Remove all broad patterns. Write test corpus: 50 overlay intents → 0 false positives, 20 delegation intents → all detected.

**Test scenarios:**
- "write a reply to this email" → false
- "optimize this headline" → false
- "delegate a code review of this PR" → true
- "spawn an agent to investigate" → true
- Corpus: 50 overlay intents → 0 false positives

**Verification:** `cd cli && npm test` passes.

---

### U13. Gate delegation endpoints and sever /manifest from delegation

**Goal:** Delegation endpoints return 501 unless `FLYD_DELEGATION_ENABLED=true`. `/manifest` never attaches `delegationEnvelope`. AGENTS.md marks DELEGATED as dormant.

**Requirements:** R7

**Dependencies:** U12 (regex fixed)

**Files:**
- `cli/src/server.ts`
- `AGENTS.md`

**Approach:**

- `const DELEGATION_ENABLED = process.env.FLYD_DELEGATION_ENABLED === "true"`.
- `POST /delegation/complete` and `GET /delegation/completions`: if `!DELEGATION_ENABLED`, return 501.
- In `/manifest` handler: remove `isDelegationIntent()` check and `delegationEnvelope` attachment entirely.
- Keep `delegation.ts` and types preserved.

AGENTS.md: mark DELEGATED as dormant server infrastructure.

**Test scenarios:**
- `FLYD_DELEGATION_ENABLED` unset → `/delegation/complete` returns 501
- `FLYD_DELEGATION_ENABLED=true` → `/delegation/complete` returns 200/400
- Manifest with any intent → response has no `delegationEnvelope`

**Verification:** `cd cli && npm test` passes.

---

### U14. Reconcile and document the continuous-intelligence architecture

**Goal:** Document the existing continuous-intelligence architecture with its actual connections and specific, falsifiable gaps.

**Requirements:** R8

**Dependencies:** None (independent documentation unit)

**Files:**
- `docs/architecture/continuous-intelligence.md` (new file)

**Approach:**

Document eight sections:

1. **The daemon loop** — `cli/src/commands/daemon.ts` incremental poll cycle, `loadCaptureDocs()` recursive read from `RAW_DIR`, pipeline stages.

2. **Attention signal model** — `AttentionSignal` type, `computeAttention()` scoring, `generateNudges()`.

3. **Goal and tension system** — `cli/src/lib/tension.ts` goal tracking and tension computation.

4. **Curiosity and investigation** — `cli/src/lib/curiosity.ts` question generation and LLM investigation.

5. **Nudge generation** — `generateNudges()` + `writeNudges()` to `wiki/nudges.md`.

6. **Overlay memory pipeline** — `cli/src/server.ts` memory-gate → receipt → provisionalLearn → synthesis. Receipts land in `~/.flyd/raw/overlay/*.md`. Synthesized beliefs land in `~/.flyd/raw/overlay/synthesis-*.json`.

7. **Actual integration points** (verified, with status):
   - Overlay receipts → daemon: PHYSICALLY CONNECTED (files under `~/.flyd/raw/overlay/`, `loadCaptureDocs()` is recursive). SEMANTICALLY BROKEN: receipts use `generated_at`/`category`/`confidence` fields while attention expects `timestamp`/`date`/`created`, `event_type`/`type`, `outcome`, `signal`. Receipts enter attention with empty date, `observation` eventType, null outcome/signal.
   - `findNewCapturesSince()`: NON-RECURSIVE — overlay receipts are never incremental. Only found in full batch attention scans.
   - Synthesized beliefs: PERSISTED AS JSON — invisible to QMD (`.md` index only) and `loadCaptureDocs()` (`.md` filter only). BELIEF_STORE is process-memory only. Synthesis output is effectively lost on restart.
   - Goals/tensions → resolver: INTEGRATED. `resolve()` reads goals and tensions into resolution context.
   - Attention signals → resolver: NOT INTEGRATED. Built into `IntelligenceState` (via `export-state.ts`) but resolution prompt does not consume them.

8. **Identified gaps** (not implemented):
   - Receipt semantics not preserved in attention pipeline (frontmatter schema mismatch)
   - Receipts not incremental (non-recursive `findNewCapturesSince`)
   - Synthesized beliefs not reloadable (`.json` format, no QMD indexing, no process reload)
   - Attention signals not consumed by resolution
   - No daemon-side trigger for overlay outcome events

**Patterns to follow:** `docs/architecture/` conventions, ASCII diagrams, concrete file paths and type references.

**Test scenarios:**
- Doc references existing types by name and file path
- Each integration point states a verifiable true/false claim
- Each gap is concrete and falsifiable
- Reviewer can trace data flow through both pipelines

**Verification:** Document reviewed against actual daemon and server code. Each gap statement verifiable by code inspection.

---

### U15. Final documentation reconciliation and feature flag removal

**Goal:** After LIVE ships (U2-U9 complete), update AGENTS.md, README.md, and the PRD to reflect the final shipped architecture. Remove `FLYD_LIVE_ENABLED` gate from server. No stale references remain.

**Requirements:** R1, R2

**Dependencies:** U2, U3, U4, U5, U6, U7, U8, U9 (LIVE fully shipped)

**Files:**
- `AGENTS.md`
- `README.md`
- `docs/product/flyd-overlay-prd.md`
- `cli/src/server.ts` (remove LIVE feature flag)

**Approach:**

AGENTS.md:
- Add LIVE to "Adapter modes" table with actual shortcut and "shipped" status.
- Update architecture diagram: full Swift → Core → OpenAI Realtime path.
- Add LiveSessionController, LiveAudioBridge, StreamingAudioPlayer, ObservedTarget, ResolutionApplier to Key Files.
- Remove LIVE from "Deferred features" subsection.

README.md:
- Add LIVE row to Shortcuts table.
- Update status indicator: grey (PRESENT), blue (INVOKED), green (LIVE), red (error).
- Update architecture diagram: port 4817 active.

PRD:
- Update Status: LIVE mode shipped.
- Update consciousness hierarchy: LIVE marked "Shipped" with date.

server.ts:
- Remove `LIVE_ENABLED` conditional. `startRealtimeServer()` called unconditionally. Remove `console.log` about LIVE being disabled.

**Verification:** All docs match shipped behaviour. `npm run core` starts realtime server without flag. `make run` shows green dot during LIVE.

---

## System-Wide Impact

### Interaction graph

```
U1 (docs baseline) ─────────────────────────────────────────────────
U2 (shortcut router) ─┐
U3 (realtime gate) ───┤
                       │
U4 (protocol fix) ────┤
U5 (LiveAudioBridge) ─┤
U6 (playback) ────────┤
                       ├──→ U7 (LiveSessionController + shortcut integration)
U8 (observation + ObservedTarget + ResolutionApplier) ← U7
                       │
                       ↓
                 U9 (state + status)

U10 (rename gate) ──→ U11 (transport + unified prompt)

U12 (delegation regex) ──→ U13 (gate + sever from manifest)

U14 (intelligence architecture doc) — independent

U15 (final docs + remove flag) ← depends on U2-U9 complete
```

### Error propagation

- **LIVE connection failure:** LiveAudioBridge → `.failed`, LiveSessionController → `.present` with audit.
- **Observation request timeout:** Core sends error to model. Session continues. No crash.
- **Confirmation prompt dismissed:** No operations, outcome `rejected`.
- **Delegation gate 501:** Adapter never calls delegation endpoints.

### State lifecycle risks

- **Orphaned LIVE session:** `liveSessionTask` cancelled on mode transition. sessionToken invalidation in bridge.
- **LIVE during invocation:** Guarded at InvocationStateMachine — shortcut ignored.
- **Invocation during LIVE:** `handleInvocation()`/`handleVoiceInvocation()` explicitly stop controller first.

### Unchanged invariants

- Thin-adapter: adapter never decides. ResolutionApplier is mechanical execution.
- Privacy #8: mic only during voice INVOKED or LIVE.
- Privacy #10: audit records contain sessionId, timestamps, errors only.
- All PRESENT and INVOKED behaviour unchanged.
- INVOKED execution path unchanged (ResolutionApplier extracted, not modified).

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LIVE shortcut conflicts with system or user bindings | Medium | Medium | Shortcut is a deliberate design choice. Tested against macOS defaults before finalizing. |
| Streaming PCM playback has audio glitches | Medium | Medium | AVAudioEngine + player node is Core Audio's intended path. Buffer underrun handled explicitly. |
| Headphone-less operation causes echo/feedback | High | Medium | MVP explicitly requires headphones. Echo cancellation deferred to follow-up. |
| Extracting ResolutionApplier from main.swift introduces regression in INVOKED path | Low | High | Extraction is a no-op refactor. All existing INVOKED tests must pass before LIVE integration. |
| Observation bridge latency adds noticeable delay to LIVE tool calls | Low | Medium | Environment capture is <100ms. Acceptable for tool-call frequency during voice. |

---

## Documentation / Operational Notes

- During development: `FLYD_LIVE_ENABLED=true` in `cli/.env`. Removed in U15.
- `FLYD_DELEGATION_ENABLED=true` to exercise delegation endpoints directly. Default disabled.
- After U11: `requiresConfirmation` = execution consequence. `requiresReplacementConfirmation` = text magnitude. Combined in `ConfirmationDecision`.
- After U15: all docs describe shipped architecture. Real-time server starts unconditionally.
- LIVE shortcut: placeholder `[LIVE_SHORTCUT]` resolved before U2.
- LIVE MVP requires headphones.

---

## Sources & References

- AGENTS.md — architecture doc (lines 10-60)
- README.md — shortcuts and configuration (lines 22-65)
- `docs/product/flyd-overlay-prd.md` — product definition
- `mac-adapter/Sources/State.swift` — FlydMode + InvocationPhase
- `mac-adapter/Sources/Capture/ShortcutRouter.swift` — `.flagsChanged` routing
- `mac-adapter/Sources/Capture/InvocationStateMachine.swift` — CGEvent tap bridge
- `mac-adapter/Sources/Bridge/FlydClient.swift` — ResolutionResponse
- `mac-adapter/Sources/Bridge/VoiceTranscriptionRelay.swift` — WS client pattern
- `mac-adapter/Sources/Capture/VoiceCapture.swift` — mic capture
- `mac-adapter/Sources/Execution/ReplacementGate.swift` — replacement gate
- `mac-adapter/Sources/UI/StatusItem.swift` — status indicator
- `mac-adapter/Sources/main.swift` — resolution dispatch, shortcut wiring
- `cli/src/server.ts` — Core HTTP + WS, manifest handler, memory pipeline
- `cli/src/resolve.ts` — resolution, `assessConsequence()`, `requiresConfirmation`
- `cli/src/realtime-session.ts` — realtime WS, fabricated environment, tool-call handler
- `cli/src/delegation.ts` — delegation detection
- `cli/src/commands/daemon.ts` — daemon poll loop, `findNewCapturesSince()` (non-recursive)
- `cli/src/lib/attention.ts` — `AttentionSignal`, `computeAttention()`, `generateNudges()`, `loadCaptureDocs()`
- `cli/src/lib/tension.ts` — goal tracking, `computeTension()`
- `cli/src/lib/curiosity.ts` — `generateQuestions()`, `investigateQuestion()`
- `cli/src/export-state.ts` — unified evidence export
- `docs/solutions/security-issues/overlay-deep-review-auth-bypass-orphaned-tasks-2026-07-23.md`
- `docs/solutions/architecture-patterns/flyd-overlay-thin-adapter-typescript-core-2026-07-23.md`
