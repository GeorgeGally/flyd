# flyd — agent reference

## Repository workflow

- `main` is the working branch and source of truth.
- Do not leave completed work only on feature branches, PR branches, or temporary worktrees.
- If a requested change exists off `main`, fast-forward or otherwise land it on `main` before reporting completion.
- If local `main` is stale, dirty, or otherwise not the correct state, preserve any uncommitted work and make `main` match the correct source of truth.

## Product architecture

**Flyd has no primary interface. It has a primary presence.**

Flyd Core is the intelligence runtime, implemented in TypeScript (`cli/src/server.ts` + friends). Swift (`mac-adapter/`) is the thin native OS adapter/presence layer that captures environment, renders native UI, handles audio, and executes grounded operations.

**Rails is retired from the active Flyd architecture.** The repository still contains Rails code under `app/`, `bin/rails`, `config/`, `db/`, `lib/`, and `test/`, but it is legacy code only. Do not add new Flyd intelligence, evidence, memory, composition, UI, provider, or runtime work to Rails. Do not make active functionality depend on Rails or PostgreSQL Rails models.

### Adapter modes

| Mode | Trigger | Status | Description |
|------|---------|--------|-------------|
| PRESENT | Always on | Shipped | OS notification-based foreground observation. No cognition, no network, no persistence. |
| INVOKED (text) | Double-tap fn key | Shipped | One-shot text invocation. Intent field → resolution → native/augment/compose. |
| INVOKED (voice) | fn+Ctrl hold (>300ms) | Shipped | Push-to-talk → `gpt-realtime-whisper` transcription → same `/manifest` pipeline. |
| LIVE | Ctrl×3 (triple-press) | Shipped | Persistent realtime voice session with `gpt-realtime-2.1`. Tool calling routes through Core safety. Ctrl×3 again to exit. MVP requires headphones. |

### Resolution outcomes

These are Core outcomes, not adapter modes.

| Outcome | Description | Status |
|---------|-------------|--------|
| Native | Text operations (insert, replace) executed in the focused element | Shipped |
| Augment | Explanation, choice, or annotation cards overlaid on screen | Shipped |
| Compose | Full generated Flyd surface when a richer temporary interface is required | Active architectural outcome; renderer must be Core/native, never Rails |

### Deferred features

| Feature | Status |
|---------|--------|
| DELEGATED | Server infrastructure dormant behind `FLYD_DELEGATION_ENABLED`. Adapter-side not implemented. `/manifest` does not produce delegation responses. |

**Voice is a modality. LIVE is a consciousness/runtime state.**

### Architecture

```text
Swift macOS adapter (thin OS driver)
    ├── PRESENT: NSWorkspace + AXObserver — observation only
    ├── INVOKED text/voice: environment capture → TypeScript Core
    ├── LIVE: audio I/O → LiveAudioBridge → TypeScript Core → OpenAI Realtime
    └── Execution: NativeExecutor (AX refs + fingerprint verification)

TypeScript Core (intelligence, memory, evidence, resolution)
    ├── HTTP server :4815 — manifest, learnings, health
    ├── Transcription WS :4816 — gpt-realtime-whisper relay
    ├── Realtime WS :4817 — gpt-realtime-2.1 session + tool relay
    ├── Memory: unified archive/retrieval/currentness pipeline
    ├── Evidence Engine: capability health → planning → retrieval → provenance → fusion
    └── Delegation: intent pattern matching → capability envelope (dormant)
```

### Evidence Engine

External provider output is evidence supplied to Flyd, never direct UI instructions.

Current E0/E1 architecture lives under `cli/src/evidence/`:

```text
external source
    ↓
CapabilityAdapter
    ↓
CapabilityRegistry
    ↓
Evidence Engine
    ↓
EvidenceBundle
    ↓
Flyd Core reasoning
```

E1 capabilities:

- `web.read` — Jina Reader
- `web.search` — Jina Search (`JINA_API_KEY`)
- `github.read/search` — GitHub REST (`GITHUB_TOKEN`/`GH_TOKEN` optional for higher limits)
- `rss.read` — native Flyd RSS/Atom parser
- `youtube.read/search` — `yt-dlp`, with transcript extraction when available

Use `flyd doctor` / `flyd doctor --json` for operation-level capability health.

PRESENT remains zero-network. E1 adapters are not invoked automatically by `/manifest` until E2 evidence-need routing is implemented.

### Privacy invariants

11 falsifiable constraints live in `mac-adapter/Sources/Privacy/PrivacyInvariants.swift`. Key guarantees: no screenshots in PRESENT, no environment persistence after invocation, no raw audio storage, mic only during explicit user action.

Guardrails:

- Do not introduce project-first or conversation-first primary navigation.
- Do not make stored records visible merely because they exist.
- Do not introduce Rails as an active runtime, composition, evidence, provider, or memory dependency.
- Provider output is evidence supplied to Flyd, never direct UI instructions.
- The Swift adapter never decides what to do; intelligence routes through TypeScript Core.
- PRESENT must remain zero-network and zero-persistence.
- External credentials must be scoped to the adapter that needs them.

## Structure

Start with `mac-adapter/` and `cli/src/server.ts` for the active product.

```text
flyd/
  mac-adapter/                 Swift Mac presence layer
    Makefile                   supported build/install/run path
    Sources/                   capture, execution, UI, audio, bridge, privacy, auth

  cli/                         TypeScript Core
    src/server.ts              Core HTTP + WS runtime
    src/resolve.ts             manifest → resolution
    src/transcription.ts       invoked voice transcription relay
    src/realtime-session.ts    LIVE realtime relay
    src/evidence/              external evidence/capability layer
    src/lib/                   memory, retrieval, currentness and shared intelligence logic
    src/runtime/               older coding-task subsystem; do not confuse with overlay Core

  docs/product/                current product PRDs
  docs/solutions/              documented engineering solutions

  app/, db/, lib/, test/       legacy Rails tree — historical only; do not extend for active Flyd
```

## Commands

### Active Flyd

```bash
cd mac-adapter && make run           # build, sign, install, launch
cd cli && npm run core               # run Flyd Core only
cd cli && npm test                   # CLI/Core tests
cd cli && npm run lint               # TypeScript typecheck
cd cli && npm run build
cd cli && npm run dev -- doctor      # evidence capability diagnostics during development
flyd doctor                          # installed CLI diagnostics
flyd doctor --json                   # structured diagnostics
```

Legacy Rails commands are not part of the active product workflow.

## Key files

- `docs/product/flyd-overlay-prd.md` — overlay product definition
- `docs/product/flyd-evidence-engine-prd.md` — evidence/reach architecture and E0–E5 sequence
- `docs/product/flyd-evidence-engine-e1.md` — E1 implementation decisions
- `mac-adapter/Sources/main.swift` — app entry point and invocation lifecycle
- `mac-adapter/Makefile` — build/bundle/install/run
- `mac-adapter/Sources/UI/InvocationPanel.swift` — text invocation command bar
- `mac-adapter/Sources/UI/AugmentPanel.swift` — augment UI
- `mac-adapter/Sources/Capture/VoiceCapture.swift` — mic capture / spectrum
- `mac-adapter/Sources/Bridge/FlydClient.swift` — `/manifest` client
- `mac-adapter/Sources/Bridge/VoiceTranscriptionRelay.swift` — port 4816 client
- `mac-adapter/Sources/Bridge/LiveAudioBridge.swift` — port 4817 LIVE client
- `mac-adapter/Sources/Execution/ObservedTarget.swift` — LIVE execution grounding
- `mac-adapter/Sources/Auth/AdapterAuth.swift` — shared Core/adapter bearer token
- `cli/src/server.ts` — Flyd Core runtime
- `cli/src/resolve.ts` — resolution logic
- `cli/src/realtime-session.ts` — LIVE session relay
- `cli/src/evidence/types.ts` — evidence/capability contracts
- `cli/src/evidence/capability-registry.ts` — health-aware backend selection
- `cli/src/evidence/evidence-engine.ts` — planning/retrieval/fusion orchestration
- `cli/src/evidence/default-registry.ts` — current E1 adapter registry
- `cli/src/evidence/doctor.ts` — capability diagnostics
- `cli/src/lib/brain-retrieval.ts` — shared personal-memory evidence retrieval

## Overlay gotchas

### JSON key format — Core sends camelCase, Swift must match

Core uses `JSON.stringify(body)`, producing camelCase responses. The Swift decoder in `FlydClient.post()` must NOT use `.convertFromSnakeCase`; response properties match JS keys directly.

Manifest request structs DO use explicit `CodingKeys` mapping to snake_case (`invocationId = "invocation_id"`). The encoder does not use `.convertToSnakeCase`; CodingKeys are authoritative.

### Main thread safety

`handleInvocation()` and `handleVoiceInvocation()` create `Task { await processInvocation(...) }`. AppKit work inside `processInvocation` must run on the main actor:

```swift
await MainActor.run {
    invocationPanel.dismiss()
    state.transition(to: .present)
}
```

`state.cancelInvocation()` / state-machine cancellation are thread-safe. `NSPanel`, `NSTextField`, and other AppKit calls are not.

### No deadline task

Do not add a separate invocation deadline task. A prior 10-second deadline later cancelled an in-flight URLSession request and converted a slow response into `NSURLErrorCancelled (-999)`. `FlydClient.post()` owns the network timeout.

### AugmentPanel

- Interactive `choice`/`control` cards accept mouse events; non-interactive explanation/annotation cards click through.
- Non-interactive cards omit the close button because `ignoresMouseEvents=true` makes the whole window event-transparent.
- Interactive cards may be dragged by their background.
- Clamp card layout to `screen.visibleFrame`.
- Multiple augmentations require separate `AugmentPanel` instances; reusing one silently drops previous cards because `.show()` begins with `dismiss()`.
- Escape and click-outside dismiss cards.
- Auto-dismiss prevents orphaned cards.

### Resolution routing

General questions must resolve to `requires_augment`, not insert answers into the focused element. `buildResolutionPrompt()` in `resolve.ts` carries this rule and defines distinct native/augment/compose response shapes.

### Build & install cycle

```bash
make -C mac-adapter install
```

The old Core process is killed during install. Reopen `~/Applications/Flyd.app`; the adapter auto-launches Core.

Do not run `xcodebuild` directly from Terminal for normal testing; it can invalidate TCC permission attribution. Use `make run` or `make install`.

## Known issues

- Local dev signing can require re-granting Accessibility/Input Monitoring/Screen Recording/Microphone after rebuilds.
- Without `FLYD_MODEL_API_KEY` in `cli/.env`, model-backed resolution cannot answer normally; this is a Core configuration issue.
- GUI-launched processes inherit a minimal `PATH` and may start with `/` as the working directory. Never assume Homebrew/nvm/local bin paths; native startup must resolve them explicitly.
- Launching the raw adapter binary directly from Terminal can make macOS attribute TCC checks to the wrong responsible process; test with `make run`.
- The TypeScript baseline currently has unrelated pre-existing type errors in older memory/graph tests/files. Do not attribute those to new evidence code unless an error points into `cli/src/evidence/`.
- Rails CI/schema failures are legacy noise and must not drive active Flyd architecture decisions.
