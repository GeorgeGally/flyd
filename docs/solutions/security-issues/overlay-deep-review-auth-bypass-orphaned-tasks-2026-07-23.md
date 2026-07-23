---
title: "Overlay deep review findings — auth bypass, orphaned tasks, silent failures"
date: 2026-07-23
category: security-issues
module: flyd-overlay
problem_type: security_issue
component: assistant
symptoms:
  - "HTTP endpoints on 127.0.0.1:4815 had no authentication — any local process could invoke LLM, persist memory, kill server"
  - "SCStream.startCapture() never called — screen capture completely non-functional"
  - "Orphaned async Tasks re-executed operations against wrong elements after user cancellation"
  - "flagsChanged CGEvent flood caused re-entrant invocations and resource exhaustion"
  - "Invalid LLM-generated element refs silently resolved to whatever had AX focus"
root_cause: missing_auth
resolution_type: code_fix
severity: critical
tags:
  - flyd-overlay
  - auth-bypass
  - orphaned-task
  - screen-capture
  - code-review
---

# Overlay deep review findings — auth bypass, orphaned tasks, silent failures

## Problem

A comprehensive adversarial code review of the M0-M5 Flyd Overlay implementation discovered 5 critical (P0) and 10 high-severity (P1) vulnerabilities and bugs in the cross-process communication, state machine, screen capture, and execution safety layers. The most severe: the TypeScript Core HTTP daemon had zero authentication — the Mac adapter sent a Bearer token that was never validated server-side.

## Symptoms

- **Auth bypass**: `POST /manifest`, `/manifest/outcome`, `/learnings/*`, and `/shutdown` all accepted unauthenticated requests from any local process
- **Screen capture never started**: `SCStream.startCapture()` was missing, so `t0ScreenHash` was always nil and screen fingerprinting was completely broken
- **Orphaned Tasks**: Pressing ⌃⌥ again during an in-flight LLM request cancelled the invocation in the state machine but the Swift `Task` continued running, executing text operations into whatever element currently had AX focus
- **Modifier flood**: Each individual modifier key change (Ctrl down, Alt down, Caps Lock) fired a separate CGEvent callback, causing spurious re-invocations and Task thrashing
- **Blind element fallback**: `NativeExecutor.attemptReResolution()` ignored the `ref` parameter entirely and targeted whatever element had AX focus, allowing LLM-hallucinated refs like `el_99` to silently execute

## What Didn't Work

The initial implementation went through 3 prior review rounds (9 + 17 + 6 findings fixed) without catching these issues. The auth bypass was missed because the Bearer token generation and transmission were implemented but the server-side validation was simply never written. The screen capture bug was missed because no integration test exercised the full `captureScreenshot()` → frame delivery path.

## Solution

### 1. Auth middleware (server.ts)

Added Bearer token validation on all protected endpoints. The Mac adapter's `AdapterAuth` now writes the generated credential to `~/.flyd/overlay/auth-token` with `0600` permissions. The TypeScript server reads this file on startup and validates `Authorization: Bearer <token>` headers on `/manifest`, `/manifest/outcome`, `/learnings/*`, and `/shutdown`.

```typescript
const AUTH_TOKEN_PATH = join(homedir(), ".flyd", "overlay", "auth-token");
const AUTH_TOKEN = loadAuthToken();

function checkAuth(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true; // no token configured = allow all (dev mode)
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${AUTH_TOKEN}`;
}
```

### 2. Screen capture fix (ScreenCaptureManager.swift)

Added the missing `try stream.startCapture()` call after `stream.addStreamOutput()`. Also added `stop()` before creating a new stream to prevent resource leaks from overlapping captures.

### 3. Task cancellation (main.swift)

Stored the `Task` reference and cancelled it on re-invocation:

```swift
var activeInvocationTask: Task<Void, Never>?

invocationPanel.onIntentSubmitted = { intent in
    activeInvocationTask = Task { await processInvocation(...) }
}

// On re-invocation:
activeInvocationTask?.cancel()
```

### 4. Rising-edge detection (InvocationStateMachine.swift)

Added a `wasPressed` flag to prevent spurious toggles from Caps Lock and multi-modifier events:

```swift
if flags.intersection(targetFlags) == targetFlags {
    if !machine.wasPressed {
        machine.wasPressed = true
        machine.onShortcutPressed?()
    }
} else if machine.wasPressed {
    machine.wasPressed = false
    machine.onShortcutReleased?()
}
```

Also guarded the CGEvent callback's `refcon` against nil with `guard let refcon`.

### 5. Ref validation (resolve-types.ts + NativeExecutor.swift)

Reject non-`el_01` element refs at the validation layer:

```typescript
if (op.target !== "el_01") {
    return { error: `Unknown element ref: ${op.target}`, code: "invalid_ref" };
}
```

And in the Swift executor's fallback:
```swift
guard ref == "el_01" else { return nil }
```

### Additional fixes

- **Partial execution**: Moved `verifyPreExecution()` from per-operation loop to once before the loop in `executeNativeOperations`
- **Data race**: `NSLock`-protected `ApplicationMonitor.currentApp` computed property
- **AugmentPanel**: Fixed loop that showed only the last augmentation (moved `show()` call outside shared panel creation)
- **Panel cleanup**: Dismiss `InvocationPanel` when Core is unreachable; reset checkpoints after successful invocation
- **Error sanitization**: Sanitized LLM error messages in HTTP 500 responses to prevent data exposure
- **Shutdown auth**: Protected `/shutdown` endpoint — was previously unauthenticated, allowing any process to kill the Core

## Why This Works

The auth fix closes the most critical gap: without it, any local process (malware, browser extension, npm script) could invoke the LLM at will, persist arbitrary memory receipts, and kill the server. The shared-file approach (`~/.flyd/overlay/auth-token` with `0600`) avoids the complexity of port-based or process-ID-based auth while providing meaningful protection.

The Task cancellation fix addresses a fundamental Swift concurrency anti-pattern: creating unstructured `Task {}` closures without storing the handle for later cancellation. The rising-edge detection prevents the CGEvent tap from being a re-entrancy vector — a common failure mode in accessibility-based automation tools.

The ref validation is the deepest defense: even if the LLM prompt is injected or the model hallucinates target refs, the validator rejects anything other than `el_01` from the capture payload.

## Prevention

- Always validate Bearer tokens server-side when a client sends them — a token that is generated but never checked is worse than no token at all (creates false sense of security)
- Always call `startCapture()` after configuring `SCStream` — the stream is idle until explicitly started
- Always store `Task` handles when creating unstructured concurrency — cancellation is impossible without the handle
- Use rising-edge/falling-edge detection for CGEvent modifier callbacks — `flagsChanged` fires on every individual modifier key change
- Validate element refs at the type boundary (validator layer), not just in the prompt — LLMs can and will hallucinate
- Move verification checks outside per-operation loops for multi-operation resolutions — partial execution corrupts user state

## Related

- `docs/solutions/architecture-patterns/flyd-overlay-thin-adapter-typescript-core-2026-07-23.md` — full architecture documentation
- `docs/product/flyd-overlay-prd.md` — overlay PRD with privacy invariants and safety gates
