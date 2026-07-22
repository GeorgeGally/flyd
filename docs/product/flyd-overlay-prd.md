# Flyd Overlay PRD

## Status

Directional shift from `flyd-personal-agent-platform-prd.md` (21 July 2026).

The existing PRD defined Rails as Flyd's primary interface. The overlay architecture flips this: the TypeScript core is Flyd's intelligence runtime. Rails is legacy — an optional composition renderer that may be useful later or may be retired entirely. It is not Flyd Core and never will be again.

The coding harness remains the first wedge. The overlay is a second wedge that proves Flyd can be present without being a destination.

## Revised thesis

**Before:** The intelligence continuously prepares the next scene for you.

**After:** Flyd has no primary interface. It has a primary presence.

- Existing software is usually its interface.
- Augmentation appears when useful.
- Scenes appear when necessary (deferred — may reuse Rails rendering or move to native).
- Agents disappear into the background when work needs doing.

Scenes are one possible manifestation of intelligence, not synonymous with it.

## Architecture

```
                         FLYD
                          │
                   TypeScript Core
                  persistent daemon
                          │
         ┌────────────────┼────────────────┐
         │                │                │
      memory           reasoning         agents
      retrieval         routing           coding
      beliefs           models            workers
      behaviours        intent            verification
      personal          resolution        integration
         │                │                │
         └────────────────┼────────────────┘
                          │
                    core protocol
                    HTTP + JSON
                          │
              ┌───────────┴───────────┐
              │                       │
         Swift Mac Adapter        OpenCode / agents
              │                       │
     ┌────────┼────────┐          specialist
     │        │        │          execution
  PRESENT  INVOKED   LIVE
     │        │       (deferred)
     │   ⌃⌥ capture    │
     │   + execute      │
     │                  │
  existing computer UI

              optional (deferred)
                 │
          composition renderer
          (native or legacy Rails)
```

**Key principles:**

- **The Mac adapter is a thin OS driver.** It captures, renders, and executes. It never decides. Flyd Core owns all intelligence.
- **Use the cheapest sufficient machinery.** Intelligence is sparse; presence is continuous. PRESENT without cognition, deterministic routing, AX before vision, cache before re-analysis, memory gate before synthesis, specialist delegation instead of one giant model.
- **Flyd Core is the TypeScript runtime.** It already has memory (QMD + brain retrieval + graph + librarian), reasoning (LLM integration + agent loops + prompt infrastructure), personal context (interests, projects, taste profile), agent orchestration (PostgreSQL task store, harness, orchestrator, workers, verification, integration), and state export (13 evidence collections). Rails adds nothing the overlay needs.
- **Rails is legacy.** It was built for a web-app-as-product architecture that no longer exists. It may be useful later as an optional composition renderer for surfaces, or it may be retired. It is not Flyd Core. No overlay code depends on it.

## Consciousness hierarchy

| Level | What | Trigger | Cost | Phase |
|-------|------|---------|------|-------|
| PRESENT | Foreground app, window, focused element, UI structure, selection metadata. OS notification-based observation. | Always running | Zero | M0 |
| INVOKED | One-shot intelligence. Environment capture + intent → deterministic routing → frontier resolution. | ⌃⌥ | Cheapest sufficient path | M2 |
| LIVE | Persistent realtime session. Continuous voice, tool calls. Visually unambiguous state. | ⌃×3 (deferred) | GPT-Realtime-2 (expensive) | Deferred |
| DELEGATED | Coding/research agents with verification, context envelopes, grant boundaries. | Explicit task creation | Per-task LLM usage | Existing |
| COMPOSED | Flyd creates a surface. Escalation when existing interfaces can't express the problem. | INVOKED or LIVE escalation | One composition call | Deferred |

## Privacy invariants (enforced in code from M0)

Architectural constraints, not configurable settings. Each invariant is concrete and falsifiable.

| # | Invariant | How to falsify |
|---|-----------|---------------|
| 1 | ScreenCaptureKit runs only inside an explicitly user-entered interaction context (INVOKED initially; later LIVE where separately consented). Never during passive PRESENT. | No SCStream active outside invocation state |
| 2 | EnvironmentState is invocation-scoped. No environment payload retained after completion/cancellation by adapter state, audit log, caches, or logs. | Adapter state inspection after invocation shows no lingering environment fields |
| 3 | AX observation via OS notification APIs (NSWorkspace, AXObserver), not polling timers | No NSTimer or while-loop in AX path |
| 4 | AX element refs (`el_01`) valid only within single invocation | Ref from invocation N fails on invocation N+1 |
| 5 | Adapter sends ONLY focused_element + bounded neighbourhood (≤50 AX node equivalents, no full tree) | Capture payload has ≤50 AX nodes |
| 6 | Flyd's own windows excluded from observation (bundle ID list) | Flyd windows never appear in capture |
| 7 | No clipboard access without explicit per-invocation flag | NSPasteboard not accessed in standard path |
| 8 | Mic state indicator always visible when audio path active | No audio capture without orange system indicator |
| 9 | Telemetry limited to: invocation_count, operation_count, error_rate (no string fields) | Telemetry payload has no string fields |
| 10 | Audit log contains no raw screen content, AX trees, or user text | Audit log has no base64 or >200 char values |
| 11 | PRESENT state never transmits to network or persists to disk | Network monitor shows zero traffic in PRESENT |

## M0 — PRESENT + INVOKED shell + privacy

**Swift only. No Flyd Core changes. Days, not weeks.**

```
mac-adapter/
├── Sources/
│   ├── main.swift                        # Agent entry point (LSUIElement=true, no dock)
│   ├── State.swift                       # FlydMode enum: present, invoked. InvocationPhase enum: idle, capturing, awaitingIntent, resolving, executing, cancelled.
│   ├── Privacy/PrivacyInvariants.swift   # Enforced constraints, falsifiable
│   ├── Permissions/
│   │   ├── PermissionGate.swift          # TCC state: Accessibility, Screen Recording, Microphone
│   │   └── PermissionsView.swift         # Shows what each permission enables + how to grant
│   ├── Environment/
│   │   ├── EnvironmentState.swift        # Struct: app, surface, window, focusedElement, uiStructure, selectionMetadata, timestamp
│   │   ├── ApplicationMonitor.swift      # NSWorkspace notification-based foreground app tracking
│   │   └── AccessibilityInspector.swift  # AXObserver → focused element + bounded neighbourhood. Ephemeral refs (el_01).
│   ├── Capture/
│   │   └── ShortcutMonitor.swift         # CGEvent tap: ⌃⌥ ONLY. State machine: present→invoking→capturing→present.
│   │                                      # ShortcutConfiguration struct (modifiers + optional keyCode), not hardcoded keys.
│   │                                      # Re-invocation = interrupt (cancel current, start new).
│   ├── UI/
│   │   ├── StatusItem.swift              # Menu bar: grey=present, blue=invoked, red=error
│   │   ├── OverlayWindow.swift           # Hidden NSPanel. Click-through (ignoresMouseEvents=true). Annotations, passive visuals, augmentations without interaction. canJoinAllSpaces.
│   │   └── InvocationPanel.swift         # NSPanel at cursor. Non-activating but can become key to receive typed intent. Enter submits, Escape cancels. Dismisses when invocation completes.
│   ├── Audit/
│   │   └── AuditRecorder.swift           # Local log: invocation_id, timestamp, context_sources, error (no raw content)
│   └── Auth/
│       └── AdapterAuth.swift             # First-launch keychain credential generation. Authenticates sessions with Flyd Core.
└── Resources/Info.plist                   # Stable bundle ID + signing identity from day one
```

### M0 exit criteria

1. Adapter launches as agent (no dock icon, `LSUIElement=true`)
2. Status item visible in menu bar, grey dot (PRESENT)
3. Permissions view accurately reports TCC state and explains what each permission enables
4. Overlay window exists: hidden, non-activating, click-through, all-Spaces
5. All 11 privacy invariants have passing tests
6. ⌃⌥ registered; state machine: present → invoking → capturing → present. Re-press during invocation = cancel + restart.
7. On ⌃⌥: status item blue (INVOKED), EnvironmentState captured, intent field appears at cursor. Enter logs capture to console. No Flyd Core connection needed.
8. Adapter auth generates per-install Keychain credential on first launch
9. Stable bundle ID + signing identity configured (prevents TCC invalidation)
10. Audit recorder writes invocation records (meaning only, no raw content)
11. EnvironmentState observed via NSWorkspace notifications + AXObserver (no polling timers)
12. Flyd adapter windows never appear in environment capture output
13. Shortcut uses ShortcutConfiguration struct (⌃⌥ is current binding, not hardcoded in logic)

### M0 does NOT:

- Connect to Flyd Core (no network calls in M0)
- Make any LLM calls
- Execute any operations
- Capture screenshots
- Register ⌃×3
- Implement LIVE, augment, or compose paths
- Persist environment data
- Have any user-configurable settings
- Have stub classes for deferred systems
- Touch any Rails code

## M1 — Reliable observation

**Swift only. No Flyd Core changes.** Perception engineering.

### Additions

| Component | Purpose |
|-----------|---------|
| `ObservationCoordinator` | Deduplicate observation requests. Only one expensive analysis per source. Coalesce new observations while analysis runs. Stale candidates dropped. Latest meaningful state wins. |
| `ScreenFingerprint` | Tiny grayscale hash for change detection. Cursor blinks, animations, JPEG noise don't invalidate context. Same revision → reuse semantic interpretation. |
| `ScreenCaptureKit` integration | On-demand screenshot. Only when AX context is insufficient. Captured screenshot → fingerprint hash → if unchanged within this invocation, reuse current-invocation analysis. If changed or first capture, run OCR/VLM. ~1280px downsized. Excludes own windows. No cross-invocation caching — environment data disappears after invocation. |
| Time-indexed capture | t₀ = ⌃⌥ press freeze (fingerprint + prewarm). t₁ = Enter key (intent complete, verify + refresh context). t₂ = pre-execution fingerprint check. |
| Prewarm perception | AX read starts at ⌃⌥ press. If AX insufficient, capture screenshot + compute fingerprint. Context ready by Enter. VLM only if OCR fingerprint confirms meaningful change from any prior capture within this invocation. |
| `ShortcutMonitor` → `InvocationStateMachine` | Renamed. Full lifecycle: present → invoking → capturing → resolving → executing → present. Cancellation at any state. Interrupt on re-invocation. |
| Semantic neighbourhood extraction | Bounded parent container context. Patterns for Mail.app and Gmail. Other apps get partial context marked as `sufficiency: partial`. |

### M1 exit criteria

1. ⌃⌥ press: prewarm begins (AX read). Intent field appears at cursor.
2. Screen capture pipeline: AX sufficient? → stop. No → capture screenshot → fingerprint → unchanged within invocation? reuse → changed? OCR/VLM.
3. Enter (intent complete): full context packet ready within 100ms of intent submission
4. Focus drift between t₀ and t₁ is detectable
5. Context packet matches environment capture contract (see Contracts section)
6. Cursor blinks and animations don't trigger false screen-change detection
7. Invocation fingerprint (app + window + element) captured and verifiable
8. Intent field accepts text, Enter submits (t₁), Escape cancels
9. Rapid re-invocation cancels current and starts fresh

## M2 — Pass-through intelligence (the existential test)

**First Flyd Core changes. TypeScript only. No Rails code touched. Must answer: does this feel magical?**

### What the TypeScript core already provides for M2

The TypeScript CLI (`cli/src/`) already has everything M2 needs — no Rails dependency required:

| Need | Existing TypeScript capability |
|------|-------------------------------|
| Memory for resolution context | `brain-retrieval.ts` — hybrid QMD search, graph traversal, librarian corroboration |
| Personal context | `interests.ts`, `config.ts` (project detection, taste profile), `personal-context-memory.ts` |
| Active task state | `task-store.ts` — reads PostgreSQL directly (same tables Rails reads) |
| LLM integration | `llm.ts` — OpenAI + Anthropic providers, streaming, agent loops, tool use. `flyd-worker-config.ts` — FLYD_MODEL chain with fallbacks |
| World state | `export-state.ts` — 13 evidence collections (goals, tensions, signals, curiosity, nudges, reports, events, brain health, profile, knowledge, review, suggestions, capabilities) |
| Communication | `runtime-bridge.ts` — JSON-in/JSON-out protocol. Trivially extended to HTTP. |
| Provider chain | `FLYD_MODEL_*` → `OPENCODE_MODEL` → `OPENROUTER_MODEL` fallback |

### New TypeScript Core files (3 files)

| File | Purpose |
|------|---------|
| `cli/src/resolve.ts` | `resolve(worldState, environment, intent)` → `Resolution`. Calls LLM with resolution prompt. M2 produces native operations only. May recognize `requires_augment` and `requires_compose` as mode values (returning a rationale, no payload), but does not produce augment or compose payloads. |
| `cli/src/resolve-types.ts` | `NativeOperation`, `Resolution` types. Resolution validator (rejects hallucinated refs, invalid kinds, empty text, invalid modes). `AugmentOperation` type added in M3. |
| `cli/src/server.ts` | Simple HTTP daemon. Two endpoints. `POST /manifest` — receives environment + intent, returns proposed resolution. `POST /manifest/outcome` — receives execution result (succeeded/rejected/failed/cancelled). Loopback only (127.0.0.1). Single instance. Graceful shutdown. Uses existing `FLYD_MODEL_*` provider chain. |

### Mac adapter additions (2 files)

| File | Purpose |
|------|---------|
| `Sources/Execution/NativeExecutor.swift` | Resolves `el_01` via adapter-held invocation ref. Verifies fingerprint (t₂): app + window + element must still match capture. If ref can't safely resolve (element destroyed, AX tree restructured), fail with "Target no longer available." Never silently substitute a different focused element. Accepts element-level drift only when the same semantic target is reachable via AX role+description re-resolution. |
| `Sources/Bridge/FlydClient.swift` | Per-install Keychain credential auth. HTTP POST to Flyd Core `/manifest` and `/manifest/outcome`. Sends intent + environment. Receives proposed resolution. Reports execution outcome. Handles offline: "Cannot reach Flyd Core — is it running?" |

### Daemon contract

The TypeScript server must satisfy a minimal operational contract from M2:

- **Loopback only.** Bind to `127.0.0.1`. No external network exposure.
- **Single instance.** Second launch attempt detects existing process and fails cleanly. No port conflicts.
- **Graceful shutdown.** SIGTERM → drain in-flight requests → exit. SIGINT → same.
- **Start/stop/status.** `flyd core start` / `flyd core stop` / `flyd core status` — CLI commands for lifecycle management.
- **Authenticated requests.** The Mac adapter generates a per-install credential on first launch and stores it in macOS Keychain. The TypeScript daemon reads the same Keychain entry to validate incoming requests. No request is processed without a matching credential.

### Invocation correlation

Every request carries an `invocation_id` and receives a `resolution_id`:

```
POST /manifest
{
  "invocation_id": "uuid",
  "environment_revision": 4,
  ...
}

Response:
{
  "resolution_id": "uuid",
  "invocation_id": "uuid (echoed)",
  ...
}
```

The Swift adapter discards any response whose `invocation_id` doesn't match the active invocation. This prevents late responses (from cancelled invocations) from acting on the wrong computer state.

```
POST /manifest/outcome
{
  "resolution_id": "uuid",
  "invocation_id": "uuid",
  "status": "succeeded" | "rejected" | "failed" | "cancelled",
  "correction": null | "user feedback"
}
```

The outcome endpoint feeds `MemoryGate` in M2.5 — intent → resolution → actual result → correction → learning.

### Intent routing tiers

M2 implements two tiers. The local-model tier exists architecturally but is deferred until measurement demands it.

```
INVOKED
↓
deterministic fast path (M2)
  "type hello" → focused field (~100ms)
  repetitive commands → cached resolution
  no LLM call
↓
frontier model (M2)
  full resolve() with memory + personal context + environment
  uses existing FLYD_MODEL_* → OPENCODE_MODEL → OpenRouter chain
↓
local/small model (architectural, deferred)
  paraphrase, entity extraction, simple rewrites
  built only if latency/cost data justifies an intermediate tier
```

### Safety gates

1. **Ref-grounded operations.** Flyd targets only `el_01` refs from capture. Never invents targets.
2. **Fingerprint verification (t₂).** App + window verified before execution. If element ref can't safely resolve, fail — never silently substitute. Element-level re-resolution by AX role+description permitted when semantics match. Otherwise: "Target no longer available."
3. **Write-only Phase 1.** `insert_text`, `replace_text`, `replace_selection`. No click, submit, delete, shell, launch.
4. **Character limit.** 2000 char max per operation.
5. **Content threshold.** Replace operations affecting >75% of element content prompt confirmation.
6. **Single invocation at a time.** Re-invocation cancels current and starts fresh. 10s timeout.
7. **Environment discarded.** Environment structs deallocated after execution. Only meaning persists.
8. **Undo primitive.** Text operations are reversible. "Undo" banner appears after execution. Prefer reversible over confirmed actions.
9. **Adapter auth.** Every request authenticated with per-install Keychain credential.

### Latency instrumentation (core M2 KPI)

```
⌃⌥ → intent field visible         target: <100ms
intent complete → request dispatched
request → first byte of response
first byte → action rendered/executed
```

### Three test interactions

1. **Gmail reply:** "reply warmly and say Tuesday works" → text inserted in compose field
2. **Terminal:** "ask it what it wants me to fix" → text inserted at cursor
3. **Any text field:** "rewrite this more directly" → selected text replaced

### M2 exit criteria

1. All three test interactions work correctly and repeatedly
2. Flyd never returns a target ref not present in the environment capture
3. Invocation fingerprint verified before every execution
4. Focus drift triggers "Target changed. Apply here?" (not blind execution)
5. Only `insert_text`, `replace_text`, `replace_selection` are executable
6. No click, submit, delete, shell, or launch operations possible
7. Environment context discarded after execution (adapter state + audit log + caches inspected for no lingering environment fields)
8. Audit record contains meaning, not raw content
9. Existing CLI (coding harness, task store, memory, retrieval) works unchanged
10. Latency instrumentation reports actuals
11. Measured drift rate across 100+ real invocations

### Success criterion (qualitative, after one day of use)

**"Does talking to the thing I'm already looking at feel fundamentally better than opening Flyd?"**

## M2.5 — Memory gate + learning

**Cheap significance detection. No LLM in the critical path for acknowledging learning.**

### Additions

| Component | Purpose |
|-----------|---------|
| `MemoryGate` | Cheap significance check (no LLM). Explicit preference, correction, repeated topic, multi-step teaching, confirmation, recurring routine → pass. Generic Q&A → discard. |
| `MemoryReceipt` | First-class provenance struct: WHAT Flyd believes, WHY, WHEN changed, WHAT evidence changed it. Self-contained evidence (raw session can be deleted). |
| Provisional learning | Synchronous, ~500ms. "always keep answers short" → immediately: `response_verbosity = concise`. Acknowledge to user. |
| Async synthesis | Batched, later. Deduplicate, reconcile, persist to beliefs/behaviours store. |

## M3 — Augment + designer companion

**Transient augmentation. Designer companion as the proving interaction.**

### Additions

| Component | Purpose |
|-----------|---------|
| `cli/src/resolve-types.ts` extended | `AugmentOperation` type: kind (`explanation/choice/annotation/control`), content, placement (`beside_selection/below_element/cursor`), options. |
| `cli/src/resolve.ts` prompt extended | Augment mode grammar in the resolution LLM prompt |
| Resolution validator extended | Augment payload validation |
| `Sources/UI/AugmentPanel.swift` | NSPanel. Never steals application focus. Interactive augmentations (choices, controls) receive mouse input without becoming the active application. Non-interactive augmentations (explanations, annotations) remain click-through (`ignoresMouseEvents=true`). 2-4 options max. Auto-dissolves on interaction or 30s. canJoinAllSpaces. |

### Note for M3: manifestation timeline

From fork analysis: augmentation can be temporally orchestrated. The response returns `(semantic_span, augmentation)` pairs, not one static payload. Multiple augmentations can appear/update as the response unfolds. This is a design note for M3 implementation, not additional scope for M0-M2.

### Designer companion demo

1. User in Figma, selects text layer with a font
2. ⌃⌥ → "show me something less corporate"
3. Flyd resolves → augment with 3 font alternatives, a memory reference, one question
4. Transient panel appears beside selection
5. User picks → disappears. Ignores → auto-dissolves.

## M4 — User agency

**Make M0 privacy invariants visible, configurable, and inspectable.**

### Additions

- Privacy settings pane: retention modes (Private/Balanced/Contextual), per-app exclusions, redaction rules, incognito toggle
- Audit trail view: readable invocation history, meaning only, no raw content
- `~/.flyd/overlay/config.json` — user configuration
- M0 privacy invariants remain enforced regardless of settings
- **Retention settings govern derived knowledge and invoked interactions, never raw PRESENT observations.** PRESENT never persists — full stop. No setting can weaken this.

## M5 — Compose escalation (deferred)

**When existing interfaces + augmentation can't express the problem, escalate to a Flyd surface.** Implementation deferred — M2 is the existential test.

### Options for compose rendering

| Option | Description | When |
|--------|-------------|------|
| Reuse legacy Rails surfaces | Existing `app/views/surfaces/` renderers. Browser-based. Quickest path. | If Rails still runs and surface rendering is needed before native rendering exists |
| Native Swift rendering | Render decision/investigation/comparison surfaces natively in the Mac adapter. No browser, no Rails. | Preferred long-term — keeps the user in context |
| WebView overlay | Embed a WKWebView in an NSPanel. Renders HTML without leaving the application context. | Middle ground if native rendering is too expensive |

Whichever path is chosen: browser launch is an implementation shortcut, not the architecture. COMPOSE routes to a Flyd manifestation host — not necessarily a browser and not necessarily leaving the current software context.

### DELEGATED integration (existing)

The coding harness (`cli/src/runtime/`) already handles DELEGATED: specialist workers with verification, isolated worktrees, grant boundaries, and context envelopes. The overlay can invoke delegation by routing a resolution through the existing task store — no new infrastructure needed beyond the intent router in M2.

## Contracts

### Environment capture (Mac Adapter → Flyd Core)

```json
{
  "environment": {
    "application": {
      "bundle_id": "com.google.Chrome",
      "name": "Google Chrome"
    },
    "surface": {
      "kind": "web_app",
      "host": "mail.google.com",
      "title": "Tuesday catch-up - user@gmail.com - Gmail"
    },
    "window": {
      "title": "Tuesday catch-up - user@gmail.com - Gmail",
      "ref": "win_01"
    },
    "focused_element": {
      "ref": "el_01",
      "role": "AXTextArea",
      "description": "reply compose body",
      "value": "",
      "placeholder": "",
      "selected_text": ""
    },
    "semantic_neighbourhood": {
      "parent_type": "email_thread",
      "context": {
        "subject": "Tuesday catch-up",
        "from": "Farza",
        "preview": "Hey — want to meet up next week?"
      }
    },
    "selection": "",
    "sufficiency": "semantic"
  },
  "intent": "reply warmly and say Tuesday works",
  "modality": "text",
  "invocation_fingerprint": {
    "app": "com.google.Chrome",
    "surface": "mail.google.com",
    "window": "win_01",
    "element": "el_01"
  }
}
```

### Resolution contract (Flyd Core → Mac Adapter)

```json
{
  "resolution_id": "uuid",
  "invocation_id": "uuid (echoed from request)",
  "mode": "native",
  "rationale": "Replying to Farza's email about Tuesday catch-up.",
  "operations": [
    { "target": "el_01", "kind": "insert_text", "text": "Hey Farza — Tuesday works great! What time were you thinking?" }
  ]
}
```

### Outcome contract (Mac Adapter → Flyd Core)

```json
{
  "resolution_id": "uuid",
  "invocation_id": "uuid",
  "status": "succeeded",
  "correction": null
}
```

### Delegation envelope (Flyd → Specialist)

```json
{
  "intent": "diagnose this crash",
  "world_state": { },
  "observation_refs": ["el_01"],
  "memory": { },
  "current_project": { },
  "available_capabilities": [],
  "goal": "",
  "grant": { }
}
```

## Key risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| AX ref staleness during LLM roundtrip | High | App+window fingerprint. Element-level tolerance. Re-resolve by AX role+description. Measure drift rate in M2. |
| Semantic neighbourhood extraction complexity | High | M1 provides patterns for Mail.app/Gmail. Other apps get partial context marked `sufficiency: partial`. Acceptable. |
| TCC permission denial = product death | High | M0's only job: make this state clear, guide user. No product without Accessibility. Honest error handling. |
| Latency (1.5-6s) makes product feel slow | Medium | Deterministic fast path for common operations. Prewarm perception. Instrument and optimize in M2. M0-M1 prove capture is fast before we add LLM. |
| Compose escalation requires rendering infrastructure | Low (deferred) | Surface composition is deferred to M5+. Multiple options exist (legacy Rails, native Swift, WebView). Decision deferred until M2 proves the primitive is worth building more of. |

## What is NOT changed (existing TypeScript core unaffected)

- `cli/src/runtime/` — coding harness, task store, worker lifecycle, grant model, verification
- `cli/src/lib/` — memory, retrieval, librarian, graph, attention, tension, staleness
- `cli/src/export-state.ts` — intelligence state export
- `cli/src/bridge.ts` — targeted retrieval bridge
- `cli/src/runtime-bridge.ts` — PostgreSQL command bridge
- Existing `~/.flyd/` directory structure (raw, wiki, context, plans)
- The coding harness as the first wedge (overlay is a second wedge)
- M0-M1 touch zero Flyd Core code — they're Swift only

## What is deliberately left alone

- **Rails** — `app/`, `config/`, `db/`, `lib/` — untouched. Not deleted. Not depended on. The overlay has zero Rails dependencies. Rails remains on disk as legacy code that may be useful for surface rendering in M5+ or may be retired entirely when native rendering exists.

## Implementation principle

**Design ahead. Implement one milestone ahead at most.**

- M0 should take days, not weeks. Its success criterion: Flyd launches reliably, quietly understands where the user is, and pressing the invocation key produces a correctly grounded invocation without destabilizing macOS permissions.
- Then immediately M1 → M2.
- The existential test is M2. Everything before M2 validates infrastructure. Everything after M2 depends on whether it feels magical.
