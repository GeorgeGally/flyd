---
title: "Flyd Overlay Architectural Realignment — Modes, Confirmation, Delegation, LIVE"
date: 2026-07-28
category: architecture-patterns
module: flyd-overlay
problem_type: architecture_pattern
component: assistant
severity: high
applies_when:
  - "realigning an agent's interaction vocabulary so runtime state, input modality, and manifestation are separate axes"
  - "auditing a cross-process safety contract where a server-side gate is silently dropped by the client decoder"
  - "hardening delegation intent detection against regex-driven false positives"
  - "connecting a previously stub-only realtime WebSocket modality with full client lifecycle code"
tags:
  - architectural-realignment
  - interaction-modes
  - confirmation-safety
  - delegation
  - live-mode
  - privacy-invariants
  - thin-adapter
---

# Flyd Overlay Architectural Realignment

## Context

The Flyd overlay shipped with PRESENT and INVOKED (text+voice) working, but the documentation, code, and product vocabulary collapsed three orthogonal concepts into a single "interaction modes" table: **adapter mode** (the Swift adapter's runtime state), **resolution outcome** (what Core returns from `/manifest`), and **input modality** (how the user triggered invocation). Shortcuts were documented incorrectly (⌃⌥ instead of double-tap fn). LIVE mode had a running Core realtime WebSocket server (port 4817) with zero Swift client code, and its tool-call handler fabricated a fake environment (`"application": "LIVE session"`). The confirmation safety contract was broken: Core's `requiresConfirmation` field was sent but silently dropped by Swift's decoder, while Swift had its own unrelated `requiresConfirmation` for text replacement magnitude. The delegation classifier matched absurdly broad patterns like `/implement\s+/i`. And the continuous-intelligence daemon's attention loop was physically connected to the overlay's memory pipeline but semantically broken by frontmatter schema mismatches.

A 15-unit architectural realignment was planned, built, code-reviewed, and debugged in a single session. Five code-review P0 bugs were found and fixed before completion.

## Guidance

### 1. Separate three orthogonal concepts

| Concept | Definition | Values | Where defined |
|---------|-----------|--------|---------------|
| **Adapter mode** | Swift adapter's runtime state | PRESENT, INVOKED (text), INVOKED (voice), LIVE | `mac-adapter/Sources/State.swift:3` |
| **Resolution outcome** | Core's response to `/manifest` | native, augment, compose | `cli/src/server.ts`, `cli/src/resolve.ts` |
| **Input modality** | User trigger method | text (double-tap fn), voice (fn+Ctrl hold), live (Ctrl×3) | `mac-adapter/Sources/main.swift:444` |

A single INVOKED invocation can produce any resolution outcome. Voice is a modality; LIVE is a runtime state. Never collapse these into one vocabulary.

### 2. Use rising-edge detection for modifier-only shortcuts

`ShortcutRouter` processes only `.flagsChanged` events — never `keyDown`/`keyUp`. Ctrl×3 triple-press detection uses rising-edge state tracking with timestamp windowing:

```swift
// mac-adapter/Sources/Capture/ShortcutRouter.swift
// Rising-edge: Ctrl was not down before, is down now
let ctrlOnly = flags.contains(.maskControl) && !flags.contains(.maskSecondaryFn) && !flags.contains(.maskAlternate)
if ctrlOnly && !state.ctrlWasDown {
    // register press, track count within timing window
    if state.ctrlPressCount >= 3 { return .liveToggle }
}
state.ctrlWasDown = ctrlOnly
```

Guard liveToggle dispatch against active invocation state in `InvocationStateMachine.swift`:
```swift
case .liveToggle:
    guard FlydState.shared.mode != .invoked else { break }
    DispatchQueue.main.async { machine.onLiveToggle?() }
```

### 3. Use observation request/response for real-time environment capture

LIVE tool-call resolution must use real environment, not fabricated state. Core sends `observation_request`, Swift captures AX context on-demand, and Core resolves against the actual environment:

```
Core: {"type":"observation_request","request_id":"req_01"}
Swift: capture AX element → create ObservedTarget → store by observationId
Swift: {"type":"observation","request_id":"req_01","observation_id":"obs_01",...}
Core: resolve() with real environment → {"type":"resolution_result","observation_id":"obs_01","resolution":{...}}
Swift: lookup ObservedTarget by observationId → execute against retained AXUIElement
```

The `LiveAudioBridge` (`mac-adapter/Sources/Bridge/LiveAudioBridge.swift`) mirrors the `VoiceTranscriptionRelay` singleton pattern: serial DispatchQueue, sessionToken invalidation, `[weak self]` callbacks, bearer auth in URLRequest headers, JSON message protocol. The `LiveSessionController` (`mac-adapter/Sources/Bridge/LiveSessionController.swift`) owns the full LIVE lifecycle: `VoiceCapture` (mic), `LiveAudioBridge` (WS), `StreamingAudioPlayer` (AVAudioEngine 24kHz PCM).

**Critical: register the observed AXUIElement before execution.** Without this, `NativeExecutor.execute()` can't resolve the element and every LIVE tool call fails silently:
```swift
// LiveSessionController.swift — executeLiveNative():
executor.registerObservedElement(ref: "el_01", element: target.element, descriptor: target.descriptor)
let results = await executeNativeOperations(resolution: resolution, fingerprint: target.fingerprint, observedTarget: target)
```

### 4. Decouple intent consequence from execution consequence

Core's `assessConsequence()` constrains LLM reasoning (e.g., "send email → draft only, don't send"). `requiresConfirmation` gates only operations with external execution consequences — currently none (all native operations are text insert/replace). The two are architecturally separate:

```typescript
// OLD: auto-set requiresConfirmation from consequence class
if (consequence.class === "consequential") {
  resolution.requiresConfirmation = true;  // removed
}

// NEW: requiresConfirmation only for operations with external effect
// Today: never set (all operations are safe text manipulation)
// Future: set for click, send, delete, purchase operation kinds
```

Swift side: rename `ReplacementGate.requiresConfirmation()` → `requiresReplacementConfirmation()`. Both predicates feed ONE `ConfirmationDecision` → ONE `NSAlert`:
```swift
struct ConfirmationDecision {
    var reasons: [Reason]  // .executionConsequence, .destructiveReplacement
}
// ONE prompt lists all reasons
```

Add `requiresConfirmation: Bool?` to `ResolutionResponse` in `FlydClient.swift` without CodingKeys (Core sends camelCase).

### 5. Narrow delegation intent; gate behind feature flag

Before (11 patterns — absurdly broad):
```typescript
/implement\s+/i, /research\s+/i, /investigate\s+/i, /refactor\s+/i, /optimize\s+/i, /deploy\s+/i, ...
```

After (5 patterns — explicit framing only):
```typescript
/delegate\s+/i, /spawn\s+(a|an)\s+agent\s+(to|for)\s+/i, /run\s+(a|an)\s+agent\s+(to|for)\s+/i,
/create\s+(a|an)\s+agent\s+(to|for)\s+/i, /do\s+this\s+in\s+the\s+background/i
```

Gate delegation endpoints in `server.ts`: return 501 unless `FLYD_DELEGATION_ENABLED=true`. `/manifest` never attaches `delegationEnvelope` regardless of flag.

### 6. Privacy invariants must account for all valid states

`PrivacyInvariants.verifyMicIndicator()` must exempt `.live` mode:
```swift
if mode == .invoked && phase == .listening { return (true, ...) }
if mode == .live { return (true, "Audio active during LIVE session") }
```

Without the LIVE exemption, legitimate LIVE sessions produce false privacy violations.

### 7. Share execution pipeline between INVOKED and LIVE

`executeNativeOperations` accepts optional `ObservedTarget`:
- When present (LIVE): verify against `NativeExecutor.verifyObservedTarget()` — checks element role/identifier AND foreground app bundleId
- When nil (INVOKED): verify via `InvocationStateMachine.verifyPreExecution()` — checks app/window/fingerprint drift

```swift
func executeNativeOperations(
    resolution: FlydClient.ResolutionResponse,
    fingerprint: InvocationFingerprint,
    observedTarget: ObservedTarget? = nil
) async -> [(success: Bool, kind: String, text: String, message: String)]
```

## Why This Matters

- **Separation of concerns**: Without distinguishing adapter mode from resolution outcome, agents and developers can't reason about what the system actually does. The old documentation implied INVOKED was a "mode" when it can produce any of the three resolution outcomes. This caused concrete bugs — e.g., the Ctrl×3 shortcut firing during active INVOKED mode before the guard was added.

- **Observation accuracy**: Fabricating environment in LIVE mode gave the LLM stale or nonexistent context. The observation request/response protocol gives Core just-in-time, real AX data from the actual focused element on the user's screen.

- **Confirmation safety**: The old `requiresConfirmation` was silently dropped by Swift, creating a false sense of a safety gate. The new design separates intent-level consequence (constrains LLM reasoning to safe operations) from execution-level consequence (gates actual operations the user must approve), and combines both into a single user-facing prompt.

- **Delegation defense-in-depth**: The old pattern matching was so broad it would fire on normal overlay intents. Narrowing to explicit framing plus gating endpoints behind a feature flag ensures delegation cannot be accidentally triggered.

- **Privacy integrity**: A privacy invariant that flags legitimate microphone use as a violation undermines the entire invariant system. Every valid system state must pass verification.

## When to Apply

- When adding a new adapter mode, resolution outcome, or input modality — consult the three-axis separation table and slot the new concept into the correct axis
- When modifying confirmation flow — always consider intent-level (LLM reasoning) and execution-level (user-facing gate) separately
- When adding real-time observation (WebSocket, voice) — use the observation request/response protocol; never bake fabricated environment into session init
- When adding feature-flagged code — gate at the HTTP handler level (501) in addition to intent detection
- When touching the state machine — always guard mode transitions (e.g., don't allow LIVE toggle during INVOKED)
- When adding new microphone usage paths — update `verifyMicIndicator()` to exempt the new state

## Examples

### Three-axis documentation in AGENTS.md

Before (collapsed):
```
| PRESENT | Always on | OS notification-based foreground observation |
| INVOKED (text) | ⌃⌥ tap | One-shot text invocation |
| LIVE | Ctrl×3 | Persistent realtime voice session |
```

After (separated):
```
### Adapter modes
| PRESENT | Always on | Shipped | OS notification-based observation |
| INVOKED (text) | Double-tap fn | Shipped | One-shot text invocation |
| INVOKED (voice) | fn+Ctrl hold | Shipped | Push-to-talk voice invocation |
| LIVE | Ctrl×3 | Shipped | Persistent realtime voice session |

### Resolution outcomes
| Native | Text operations in focused element | Shipped |
| Augment | Explanation/annotation cards | Shipped |
| Compose | Full surface via Rails | Shipped |
```

### LIVE bridging pattern

```swift
// LiveAudioBridge — mirrors VoiceTranscriptionRelay pattern
// serial DispatchQueue + sessionToken + [weak self] + bearer auth
func connect() {
    queue.async { [weak self] in
        self?.state = .connecting
        self?.webSocket?.send(.string(#"{"type":"start"}"#)) { _ in }

        // Server sends "connecting" → opens OpenAI WS → sends "ready"
        // Only after "ready" do we start sending audio chunks
    }
}
```

### State machine guard

```swift
case .liveToggle:
    guard FlydState.shared.mode != .invoked else { break }
    DispatchQueue.main.async { machine.onLiveToggle?() }
```

### Confirmation combined prompt

```swift
var reasons: [ConfirmationDecision.Reason] = []
if resolution.requiresConfirmation == true { reasons.append(.executionConsequence) }
for op in resolution.operations {
    if executor.requiresReplacementConfirmation(kind: op.kind, text: op.text) {
        reasons.append(.destructiveReplacement); break
    }
}
if !reasons.isEmpty {
    let confirmed = await requestCombinedConfirmation(rationale: resolution.rationale, reasons: reasons)
    guard confirmed else { return }
}
```

## Related

- `docs/solutions/architecture-patterns/flyd-overlay-thin-adapter-typescript-core-2026-07-23.md` — origin architecture pattern for thin adapter
- `docs/solutions/security-issues/overlay-deep-review-auth-bypass-orphaned-tasks-2026-07-23.md` — auth bypass, orphaned Tasks, CGEvent flood patterns
- `docs/plans/2026-07-28-002-refactor-architectural-realignment-plan.md` — full 15-unit implementation plan
- `docs/architecture/continuous-intelligence.md` — daemon/overlay pipeline reconciliation
- `docs/product/flyd-overlay-prd.md` — authoritative overlay PRD
- `AGENTS.md` — canonical architecture documentation
- `mac-adapter/Sources/Capture/ShortcutRouter.swift` — shortcut routing with rising-edge detection
- `mac-adapter/Sources/Execution/ConfirmationDecision.swift` — combined confirmation predicate
- `mac-adapter/Sources/Privacy/PrivacyInvariants.swift` — 11 falsifiable privacy invariants
- `cli/src/realtime-session.ts` — LIVE session relay with observation protocol
