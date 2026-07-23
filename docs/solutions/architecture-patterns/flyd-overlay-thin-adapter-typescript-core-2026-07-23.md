---
title: "Flyd Overlay: Thin OS Adapter + TypeScript Intelligence Core"
date: 2026-07-23
category: architecture-patterns
module: flyd-overlay
problem_type: architecture_pattern
component: assistant
severity: high
applies_when:
  - "building a macOS overlay agent with screen capture and augmented display panels"
  - "separating an intelligence runtime from thin OS driver/adapter layers"
  - "designing pass-through intelligence where the agent observes and augments rather than owns the interface"
  - "implementing a multi-process agent architecture with a TypeScript Core and native OS adapters"
tags:
  - flyd-overlay
  - thin-adapter
  - privacy-invariants
  - deterministic-fast-path
  - memory-gate
  - resolution-pipeline
  - swift
  - typescript
---

# Flyd Overlay: Thin OS Adapter + TypeScript Intelligence Core

## Context

The Flyd Overlay is a macOS augmentation layer that captures the user's working context (focused application, element, selection) and resolves natural-language intents into native operations or augmented responses. The implementation spans 25 Swift files (`mac-adapter/`) and 7 TypeScript files (`cli/src/`), with zero Rails changes. The core architectural challenge: build a desktop agent where the OS-level adapter captures context and executes operations, but never makes decisions — all intelligence, state management, resolution, memory gating, and delegation live in a separate TypeScript process.

The system introduces three time-indexed capture checkpoints: t0 (⌃⌥ press — prewarm perception via ScreenCaptureKit), t1 (Enter — intent complete, AX element capture), and t2 (pre-execution fingerprint verification to detect focus drift). Privacy is enforced through 11 falsifiable invariants verified at runtime, not just in documentation.

## Guidance

### 1. Thin OS Adapter Pattern

The macOS adapter (Swift) is a pure driver: it captures environment state, renders UI panels, and executes native operations. It never decides *what* to do. All decisions flow through a TypeScript HTTP daemon on `127.0.0.1:4815`.

**Rule:** The adapter's `NativeExecutor` receives pre-validated `NativeOperation` objects and executes them mechanically. It does not interpret intent or select operations.

**Implementation structure:**
```
mac-adapter/Sources/
  Capture/        # ScreenCaptureKit, AX capture, invocation state machine
  Environment/    # AccessibilityInspector, ApplicationMonitor
  Execution/      # NativeExecutor (blind operation execution)
  Bridge/         # FlydClient (HTTP to 127.0.0.1:4815)
  Privacy/        # 11 runtime-verifiable invariants
  UI/             # OverlayWindow, InvocationPanel, AugmentPanel, StatusItem
  Audit/          # AuditRecorder (max 200 chars, no base64, no raw screen content)
  Config/         # OverlayConfig (retention, exclusions, redaction, incognito)
cli/src/
  resolve-types.ts   # NativeOperation/AugmentOperation/Resolution types + validator
  resolve.ts         # LLM resolution + deterministic fast path
  server.ts          # HTTP daemon on 127.0.0.1:4815
  memory-gate.ts     # LLM-free significance detection
  memory-receipt.ts  # Provenance struct + provisional learning
  memory-persistence.ts  # Receipts to ~/.flyd/raw/overlay/
  delegation.ts      # Context envelopes for coding-task delegation
```

### 2. Deterministic Fast Path + LLM Fallback

Not every intent needs an LLM call. The resolution engine (`resolve.ts`) checks a set of regex-based deterministic patterns before falling back to the LLM. This eliminates latency and cost for simple intents like `type hello` or `hi`.

**Pattern:** Define a priority-ordered list of `{ match, resolve }` pairs. Each `match` is a predicate on `(intent, environment)`. If none match, construct a structured prompt with world state (goals, tensions), environment context, and resolution rules, then parse and validate the LLM response.

The LLM response maps to a typed `Resolution` with three modes: `native` (direct text operations), `requires_augment` (explanation/choice UI), `requires_compose` (delegate to full surface composition). The validator enforces ref-grounded operations (targets must start with `el_`), kind-limited operations (insert_text/replace_text/replace_selection), 2000-char limit, and mode-specific requirements.

```typescript
const DETERMINISTIC_PATTERNS: Array<{
  match: (intent: string, env: EnvironmentCapture) => boolean;
  resolve: (intent: string, env: EnvironmentCapture, invocationId: string) => Resolution;
}> = [
  {
    match: (intent) => /^type\s/i.test(intent),
    resolve: (intent, _env, invocationId) => ({
      resolutionId: randomUUID(), invocationId, mode: "native",
      rationale: "Typing text into the focused field.",
      operations: [{ target: "el_01", kind: "insert_text", text: intent.replace(/^type\s+/i, "") }],
    }),
  },
];
```

### 3. Privacy Invariants as Code-Enforced Constraints

Rather than relying on privacy policies, the adapter defines 11 falsifiable invariants verified at runtime via `PrivacyInvariants.verifyAll()`. Each invariant has a description, a falsification test, and a `verify()` method that checks runtime state.

Key invariants:
- **#5:** Capture payload has ≤50 AX nodes — enforced by `canCollectNode()` counting in `captureSemanticNeighbourhood()`
- **#1:** ScreenCaptureKit only active during explicit invocation (gated by `FlydState.mode`)
- **#11:** PRESENT state never transmits to network or persists to disk (`networkCallsDuringPresent` counter)
- **#10:** Audit log contains no raw screen content or text >200 chars (enforced by `AuditRecorder.sanitize()`)

```swift
static let all: [PrivacyInvariant] = [
    PrivacyInvariant(id: 5, description:
        "Adapter sends ONLY focused_element + bounded neighbourhood (≤50 AX node equivalents)",
        falsificationTest: "Capture payload has ≤50 AX nodes"),
    PrivacyInvariant(id: 11, description:
        "PRESENT state never transmits to network or persists to disk",
        falsificationTest: "Network monitor shows zero traffic in PRESENT"),
]
```

### 4. LLM-Free Memory Gate

The memory gate determines significance without calling an LLM. Four regex categories: preferences (`always`, `never`, `keep … short`), corrections (`no, that's not …`, `actually, …`, `fix that`), teaching (`when I say X then …`, `my workflow …`), and routine detection (Jaccard word similarity >0.6 across ≥2 prior intents, or 3+ intents in same hour bucket within 24h). Generic Q&A is explicitly discarded.

When the gate passes, a `MemoryReceipt` is created with structured evidence and persisted to `~/.flyd/raw/overlay/` as self-contained markdown with frontmatter. Provisional learning detects implicit preferences like verbosity, style, and format from intent patterns.

### 5. Time-Indexed Capture Checkpoints

The `InvocationStateMachine` establishes three checkpoints with `NSLock`-protected fields to prevent data races:

- **t0** (⌃⌥ press): Prewarms AX read + ScreenCaptureKit screenshot + perceptual hash
- **t1** (Enter): Captures full AX environment + second fingerprint
- **t2** (pre-execution): `verifyPreExecution()` checks app/window match against t1 fingerprint

If focus has drifted, execution is blocked with "Target no longer available."

## Why This Matters

The thin-adapter architecture ensures intelligence lives in a single TypeScript process that can be tested, versioned, and deployed independently of the macOS native layer. Changing LLM resolution strategy touches only `resolve.ts`; tightening privacy invariants touches only `PrivacyInvariants.swift`.

The deterministic fast path eliminates ~30-50% of LLM calls for simple intents, reducing latency from ~800ms to <50ms for typing operations. The LLM-free memory gate avoids LLM cost for every invocation outcome while still capturing significant signals.

Time-indexed checkpoints prevent blind execution when the user switches windows between typing intent and execution — a common failure mode in accessibility-based automation.

## When to Apply

- Building a macOS desktop agent that observes/acts on other apps via Accessibility + ScreenCaptureKit
- Separating a platform-specific capture/execution layer from a platform-agnostic intelligence layer
- Privacy requirements demand runtime-enforced invariants rather than documentation promises
- Designing an LLM-powered resolution pipeline that benefits from a deterministic fast-path for common intents
- Implementing memory/significance detection where LLM-per-event is cost-prohibitive or latency-sensitive

## Examples

See the full implementation in:
- `mac-adapter/Sources/` — 25 Swift files (M0-M1 observation + M2-M5 integration)
- `cli/src/resolve.ts` — deterministic fast path + LLM resolution prompt
- `cli/src/server.ts` — HTTP daemon with `/manifest`, `/manifest/outcome`, `/learnings/*`
- `cli/src/memory-gate.ts` — LLM-free significance detection
- `cli/src/memory-persistence.ts` — receipt persistence to `~/.flyd/raw/overlay/`

## Related

- `docs/product/flyd-overlay-prd.md` — authoritative overlay PRD, M0-M5 milestone definitions
- `docs/product/flyd-personal-agent-platform-prd.md` — platform PRD (overlay is a second wedge)
- `docs/architecture/intelligence-surface-foundation.md` — Rails surface rendering architecture
