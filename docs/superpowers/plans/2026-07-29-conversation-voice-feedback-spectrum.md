# Conversation Voice Feedback and Spectrum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immediate local acknowledgment, explicit dictation routing, bounded follow-up context, and a dense real FFT spectrum to Flyd voice interaction.

**Architecture:** The Swift shortcut router emits separate conversation and dictation events. A small local acknowledgment speaker owns interruptible system speech, while a pure spectrum mapper makes FFT behavior testable. Flyd Core stores bounded in-memory conversation turns keyed by a manifest conversation identifier and injects them into resolution prompts.

**Tech Stack:** Swift 5.9, AppKit, AVFoundation, Accelerate/vDSP, TypeScript, Vitest.

---

### Task 1: Separate conversation and dictation shortcuts

**Files:**
- Modify: `mac-adapter/Sources/Capture/ShortcutRouter.swift`
- Modify: `mac-adapter/Sources/Capture/InvocationStateMachine.swift`
- Modify: `mac-adapter/Sources/main.swift`
- Test: `mac-adapter/Tests/ShortcutRoutingTests.swift`

- [ ] Add failing tests asserting `⌃fn` emits conversation press/release and `⇧⌃fn` emits dictation press/release without cross-firing.
- [ ] Run `swift test --package-path mac-adapter --filter ShortcutRoutingTests` and confirm the new dictation cases fail.
- [ ] Add dictation route events and include Shift in relevant modifier matching.
- [ ] Thread the new events through the state machine and add a dictation capture mode that bypasses Core and inserts only into a safe editable role.
- [ ] Run the focused shortcut tests and confirm they pass.

### Task 2: Add immediate local acknowledgment

**Files:**
- Create: `mac-adapter/Sources/Audio/VoiceAcknowledgementSpeaker.swift`
- Modify: `mac-adapter/Sources/main.swift`
- Test: `mac-adapter/Tests/VoiceAcknowledgementPolicyTests.swift`

- [ ] Add failing policy tests for one acknowledgment on conversational release, none on dictation release, and cancellation on a new turn.
- [ ] Run `swift test --package-path mac-adapter --filter VoiceAcknowledgementPolicyTests` and confirm failure because the policy is missing.
- [ ] Implement a pure acknowledgment policy plus an `AVSpeechSynthesizer` owner that says “On it.” and supports immediate stop.
- [ ] Invoke it after conversational capture stops and stop it from cleanup, Escape, errors, and new-turn startup.
- [ ] Run the focused acknowledgment tests and confirm they pass.

### Task 3: Replace the pseudo-wave with a dense FFT spectrum

**Files:**
- Create: `mac-adapter/Sources/Capture/SpectrumBandMapper.swift`
- Modify: `mac-adapter/Sources/Capture/VoiceCapture.swift`
- Modify: `mac-adapter/Sources/UI/InvocationPanel.swift`
- Test: `mac-adapter/Tests/SpectrumBandMapperTests.swift`

- [ ] Add failing tests for a 48-value result, normalized bounds, dominant-frequency localization, and decaying prior peaks.
- [ ] Run `swift test --package-path mac-adapter --filter SpectrumBandMapperTests` and confirm failure because the mapper is missing.
- [ ] Move logarithmic band mapping and attack/decay smoothing into the pure mapper; configure 48 bands over 80 Hz–8 kHz.
- [ ] Render 48 narrow bars and remove both the sine fallback and the uniform `latestVoiceLevel` addition.
- [ ] Run focused spectrum tests and confirm they pass.

### Task 4: Preserve bounded conversational follow-ups

**Files:**
- Modify: `mac-adapter/Sources/Bridge/FlydClient.swift`
- Modify: `mac-adapter/Sources/main.swift`
- Create: `cli/src/conversation-history.ts`
- Modify: `cli/src/server.ts`
- Modify: `cli/src/resolve.ts`
- Test: `cli/src/__tests__/conversation-history.test.ts`
- Test: `cli/src/__tests__/resolve.test.ts`

- [ ] Add failing tests for a maximum of 10 exchanges, 10-minute expiration, isolation by conversation identifier, and prompt history injection.
- [ ] Run `npm test --prefix cli -- conversation-history resolve` and confirm the new cases fail.
- [ ] Add optional `conversation_id` to voice manifests and reuse an adapter-owned identifier for conversational follow-ups.
- [ ] Record answer-panel text in an in-memory Core history only after resolution and inject the active history into the next resolution prompt.
- [ ] Ensure dictation bypasses manifests and never enters the history.
- [ ] Run the focused Core tests and confirm they pass.

### Task 5: Repair outcome acknowledgment decoding

**Files:**
- Modify: `mac-adapter/Sources/Bridge/FlydClient.swift`
- Test: `mac-adapter/Tests/FlydClientResponseContractTests.swift`

- [ ] Add a failing decoding test for `{"acknowledged":true}`.
- [ ] Replace the incorrect `ResolutionResponse` decoding with a dedicated acknowledgment response.
- [ ] Run the focused contract test and confirm it passes.

### Task 6: Full verification and installation

**Files:**
- Modify only files required by failures found during verification.

- [ ] Run `swift test --package-path mac-adapter`.
- [ ] Run `npm test --prefix cli`.
- [ ] Run `npm run build --prefix cli`.
- [ ] Run `git diff --check`.
- [ ] Install and relaunch from the landed `main` checkout with `cd mac-adapter && make run`.
- [ ] Verify `http://127.0.0.1:4815/health`, authenticated `/voice/status`, fresh installed logs, immediate acknowledgment, exclusive dictation shortcut, and the 48-band display.

