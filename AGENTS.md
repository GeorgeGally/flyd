# flyd — agent reference

## Repository workflow

- `main` is the working branch and source of truth.
- Do not leave completed work only on feature branches, PR branches, or temporary worktrees.
- If a requested change exists off `main`, fast-forward or otherwise land it on `main` before reporting completion.
- If local `main` is stale, dirty, or otherwise not the correct state, preserve any uncommitted work and make `main` match the correct source of truth.

## Product architecture

**Flyd has no primary interface. It has a primary presence.**

Flyd = intelligence + harness + interface.

- **runtime/** makes Flyd capable: execution, memory, tools, orchestration, Git awareness, and coding-agent capabilities. It can be heavily developed without being the user-facing product.
- **work-intelligence/** makes Flyd a product: the Mac-native manifestation — overlay, voice, scenes, proactive context, interaction.
- **CLI** exposes the runtime for development, debugging, and dogfooding. It is a useful way to test and operate Flyd, not the destination. Evaluate every runtime task with one question: what capability does this unlock or improve in the Mac interface?

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
| Compose | Full generated Flyd surface when a richer temporary interface is required | Shipped for evidence dossiers through Core; renderer must never be Rails |

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
    ├── Evidence Engine: health → multi-lens planning → retrieval → fusion → clusters/conflicts
    ├── Compose: loopback-only, short-lived generated evidence dossiers
    └── Delegation: intent pattern matching → capability envelope (dormant)
```

### Evidence Engine

External provider output is evidence supplied to Flyd, never direct UI instructions.

Current E0–E4 architecture lives under `cli/src/evidence/`:

```text
external source
    ↓
CapabilityAdapter
    ↓
CapabilityRegistry health + ordered fallback
    ↓
intent-aware quick/default/deep planning
    ↓
retrieval + provenance + weighted fusion
    ↓
clusters + contradictions + coverage gaps
    ↓
EvidenceBundle
    ↓
Flyd Core reasoning
    ↓
augment or Core-owned composed dossier
```

Current capabilities:

- `web.read` — Jina Reader
- `web.search` — Jina Search (`JINA_API_KEY`)
- `github.read/search` — GitHub REST (`GITHUB_TOKEN`/`GH_TOKEN` optional for higher limits)
- `rss.read` — native Flyd RSS/Atom parser
- `youtube.read/search` — `yt-dlp`, with transcript extraction when available
- `hackernews.read/search` — anonymous Algolia/Firebase APIs
- `reddit.read/search` — public JSON in degraded mode; optional `REDDIT_ACCESS_TOKEN`
- `x.read/search` — X API v2; requires `X_BEARER_TOKEN` or `TWITTER_BEARER_TOKEN`

E2 automatically enriches INVOKED and LIVE questions that materially depend on current external facts. Stable writing and personal recall do not browse. Required current claims fail closed when evidence cannot be retrieved.

E4 deep research is explicitly bounded: weighted primary/official/community/limitations/alternatives/recent lenses, followed by at most one two-query drill-down round. Explicit deep-research requests generate a short-lived Core-owned evidence dossier on loopback port 3000. The port is a transport compatibility point for the existing Mac adapter; the process serving it is TypeScript Core, never Rails.

Use `flyd doctor` / `flyd doctor --json` for operation-level capability health. Use `flyd evidence research "topic" --deep` to dogfood the deep engine without the overlay.

PRESENT remains zero-network. External evidence is not automatically written into personal memory.

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
- Do not automate logged-in social sites or mutate social accounts through evidence adapters.
- Do not treat engagement or popularity as truth.
- Do not persist raw external evidence into personal memory without a separate governed decision.
- Deep research must remain bounded; no recursive browsing loop without a hard cap.

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
    src/evidence/              external evidence, deep research and compose layer
    src/lib/                   memory, retrieval, currentness and shared intelligence logic
    src/runtime/               harness: execution, tools, orchestration, coding-agent capabilities (flyd CLI)
    src/work/                  shared Present Model substrate and work-index (SQLite)
    src/work-intelligence/     product interface pipeline: ground/diagnose/intervene, jobs, skillify, repository action

  docs/product/                current product PRDs
  docs/solutions/              documented engineering solutions with YAML frontmatter (module, tags, problem_type); search before implementing or debugging in documented areas

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
flyd evidence research "topic"       # direct default-depth evidence research
flyd evidence research "topic" --deep
flyd evidence research "topic" --deep --json
```

Legacy Rails commands are not part of the active product workflow.

## Key files

- `docs/product/flyd-work-intelligence-prd.md` — **Active product authority** for the overlay; founder gate, product reset, work loop, and scope boundaries
- `docs/product/flyd-overlay-prd.md` — overlay product definition (superseded for work-intelligence authority by `flyd-work-intelligence-prd.md`)
- `docs/product/flyd-evidence-engine-prd.md` — evidence/reach architecture and E0–E5 sequence
- `docs/product/flyd-evidence-engine-e1.md` — E1 implementation decisions
- `docs/product/flyd-evidence-engine-e3-e4.md` — social reach and deep compose implementation
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
- `cli/src/evidence/types.ts` — evidence/capability/surface contracts
- `cli/src/evidence/capability-registry.ts` — health-aware backend selection
- `cli/src/evidence/evidence-engine.ts` — planning/retrieval/fusion/deep orchestration
- `cli/src/evidence/default-registry.ts` — current E1/E3 adapter registry
- `cli/src/evidence/clustering.ts` — evidence theme clustering and bounded drill-down
- `cli/src/evidence/contradictions.ts` — independent opposing-claim extraction
- `cli/src/evidence/compose-surface.ts` — Core-owned evidence dossier renderer
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

Explicit deep-research intents are the exception: E4 prepares a Core-owned dossier and instructs the resolution model to return `requires_compose`. If the loopback renderer cannot start, the evidence layer downgrades the request to a detailed augment response rather than returning a dead compose URL.

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
