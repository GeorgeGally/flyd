# Flyd Overlay PRD

## Status

**Shipped: 2026-07-23.** M0-M2 hardware + substantial M3/M4/M5-adjacent functionality including voice INVOKED, LIVE mode, memory gate, and user agency configuration. See implementation notes below.

## Revised thesis

**Before:** The intelligence continuously prepares the next scene for you.

**After:** Flyd has no primary interface. It has a primary presence.

- Existing software is usually its interface.
- Augmentation appears when useful.
- Scenes appear when necessary.
- Agents disappear into the background when work needs doing.

Scenes are one possible manifestation of intelligence, not synonymous with it.

## Architecture

```
FLYD CORE — persistent intelligence (memory, beliefs, behaviours, skills, reasoning, policy, surface composition)
│
├── PRESENT (M0) — local, continuous, no cognition. OS notifications only. Never transmits or persists.
│
├── INVOKED (M2) — ⌃⌥. Environment + intent → cheapest sufficient resolution → native/augment/compose.
│   ├── deterministic fast path ("type hello" → focused field, no LLM)
│   ├── local/small model (paraphrase, entity extraction)
│   └── frontier model (complex intent, multi-step reasoning)
│
├── LIVE (deferred) — ⌃×3. Persistent realtime session. Visually unambiguous. GPT-Realtime-2.
│
├── DELEGATED (existing + M5) — coding/research agents. Context envelope delegation, not bare prompts.
│
└── COMPOSED (existing + M5) — Flyd creates a surface. Escalation when existing interfaces can't express the problem.
```

**Key principles:**

- **The Mac adapter is a thin OS driver.** It captures, renders, and executes. It never decides. Flyd Core owns all intelligence.
- **Use the cheapest sufficient machinery.** Intelligence is sparse; presence is continuous. That means PRESENT without cognition, deterministic routing, AX before vision, cache before re-analysis, memory gate before synthesis, and specialist delegation instead of one giant model.

**M0 implements only PRESENT and INVOKED.** No speculative code for deferred states.

## Consciousness hierarchy

| Level | What | Trigger | Cost | Phase |
|-------|------|---------|------|-------|
| PRESENT | Foreground app, window, focused element, UI structure, selection metadata. OS notification-based observation. | Always running | Zero | M0 |
| INVOKED | One-shot intelligence. Environment capture + intent → deterministic routing → frontier resolution. | ⌃⌥ | Cheapest sufficient path | M2 |
| LIVE | Persistent realtime session. Continuous voice, tool calls. Visually unambiguous state. | ⌃×3 (deferred) | GPT-Realtime-2 (expensive) | Deferred |
| DELEGATED | Coding/research agents with verification, context envelopes, grant boundaries. | Explicit task creation | Per-task LLM usage | Existing + M5 |
| COMPOSED | Flyd creates a surface. Multi-source synthesis, decisions, investigations. | INVOKED or LIVE escalation | One composition call | Existing + M5 |

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
│   ├── State.swift                       # FlydState enum: present, invoked
│   ├── Privacy/PrivacyInvariants.swift   # Enforced constraints, falsifiable
│   ├── Permissions/
│   │   ├── PermissionGate.swift          # TCC state: Accessibility, Screen Recording, Microphone
│   │   └── PermissionsView.swift         # Shows what each permission enables + how to grant
│   ├── Environment/
│   │   ├── EnvironmentState.swift        # Struct: app, surface, window, focusedElement, uiStructure, selectionMetadata, clipboardChanged, timestamp
│   │   ├── ApplicationMonitor.swift      # NSWorkspace notification-based foreground app tracking
│   │   └── AccessibilityInspector.swift  # AXObserver → focused element + bounded neighbourhood. Ephemeral refs (el_01).
│   ├── Capture/
│   │   └── ShortcutMonitor.swift         # CGEvent tap: ⌃⌥ ONLY. State machine: present→invoking→capturing→present.
│   │                                      # ShortcutConfiguration struct (modifiers + optional keyCode), not hardcoded keys.
│   │                                      # Re-invocation = interrupt (cancel current, start new).
│   ├── UI/
│   │   ├── StatusItem.swift              # Menu bar: grey=present, blue=invoked, red=error
│   │   └── OverlayWindow.swift           # Hidden NSPanel (non-activating, ignoresMouseEvents=true, canJoinAllSpaces)
│   ├── Audit/
│   │   └── AuditRecorder.swift           # Local log: invocation_id, timestamp, context_sources, error (no raw content)
│   └── Auth/
│       └── AdapterAuth.swift             # First-launch keychain credential generation. Authenticates localhost sessions.
└── Resources/Info.plist                   # Stable bundle ID + signing identity from day one
```

### M0 exit criteria

1. Adapter launches as agent (no dock icon, `LSUIElement=true`)
2. Status item visible in menu bar, grey dot (PRESENT)
3. Permissions view accurately reports TCC state and explains what each permission enables
4. Overlay window exists: hidden, non-activating, click-through, all-Spaces
5. All 11 privacy invariants have passing tests
6. ⌃⌥ registered; state machine: present → invoking → capturing → present. Re-press during invocation = cancel + restart.
7. On ⌃⌥: status item blue (INVOKED), EnvironmentState captured, intent field appears at cursor. Enter logs capture to console. No Flyd connection needed.
8. Adapter auth generates per-install Keychain credential on first launch
9. Stable bundle ID + signing identity configured (prevents TCC invalidation)
10. Audit recorder writes invocation records (meaning only, no raw content)
11. EnvironmentState observed via NSWorkspace notifications + AXObserver (no polling timers)
12. Flyd adapter windows never appear in environment capture output
13. Shortcut uses ShortcutConfiguration struct (⌃⌥ is current binding, not hardcoded in logic)

### M0 does NOT:

- Connect to Flyd Rails (no network calls in M0)
- Make any LLM calls
- Execute any operations
- Capture screenshots
- Register ⌃×3
- Implement LIVE, augment, or compose paths
- Persist environment data
- Have any user-configurable settings
- Have stub classes for deferred systems

## M1 — Reliable observation

**Swift only. No Flyd Core changes.** Perception engineering.

### Additions

| Component | Purpose |
|-----------|---------|
| `ObservationCoordinator` | Deduplicate observation requests. Only one expensive analysis per source. Coalesce new observations while analysis runs. Stale candidates dropped. Latest meaningful state wins. |
| `ScreenFingerprint` | Tiny grayscale hash for change detection. Cursor blinks, animations, JPEG noise don't invalidate context. Same revision → reuse semantic interpretation. |
| `ScreenCaptureKit` integration | On-demand screenshot. Only when AX context is insufficient AND fingerprint indicates meaningful change. ~1280px downsized. Excludes own windows. |
| Time-indexed capture | t₀ = ⌃⌥ press freeze (fingerprint + prewarm). t₁ = Enter key (intent complete, verify + refresh context). t₂ = pre-execution fingerprint check. |
| Prewarm perception | AX read + cache check + screen fingerprint starts at ⌃⌥ press, before user finishes typing. Context ready by Enter. VLM fallback only if AX insufficient. |
| `ShortcutMonitor` → `InvocationStateMachine` | Renamed. Full lifecycle: present → invoking → capturing → resolving → executing → present. Cancellation at any state. Interrupt on re-invocation. |
| Semantic neighbourhood extraction | Bounded parent container context. Patterns for Mail.app and Gmail. Other apps get partial context marked as `sufficiency: partial`. |

### M1 exit criteria

1. ⌃⌥ press: prewarm begins (AX read, fingerprint check, cache hit/no-hit). Intent field appears at cursor.
2. Enter (intent complete): full context packet ready within 100ms of intent submission
3. ScreenCaptureKit only fires when AX context is insufficient AND fingerprint indicates meaningful change
4. Same screen fingerprint → no re-capture on subsequent invocations
5. Focus drift between t₀ and t₁ is detectable
6. Context packet matches environment capture contract (see Contracts section)
7. Cursor blinks and animations don't trigger false screen-change detection
8. Invocation fingerprint (app + window + element) captured and verifiable
9. Intent field accepts text, Enter submits (t₁), Escape cancels
10. Rapid re-invocation cancels current and starts fresh

## M2 — Pass-through intelligence (the existential test)

**First Flyd Core changes. Must answer: does this feel magical?**

### Flyd Core additions (8-10 files)

| File | Type | Purpose |
|------|------|---------|
| `app/services/flyd/manifestation.rb` | New | `Data.define(:mode, :reasoning, :operations, :surface_plan)` |
| `app/services/flyd/native_operation.rb` | New | `Data.define(:target, :kind, :text)` — target is `el_01` ref, kind is `insert_text/replace_text/replace_selection` |
| `app/services/flyd/intelligence.rb` | Modified | Add `resolve(world_state, intent, environment:)` method. Separate LLM prompt for resolution. Existing `compose_surface` preserved unchanged. |
| `app/services/flyd/manifestation_validator.rb` | New | Validates operations against environment refs. Rejects hallucinated targets, invalid kinds, empty text. |
| `app/controllers/api/manifestations_controller.rb` | New | `POST /api/manifest`. Calls `resolve()`. Returns JSON. Records outcome as archive event (meaning only). |
| `app/services/flyd/intent_router.rb` | New | Deterministic fast path first. "type hello" → STT cleanup → focused field. No LLM. Cheapest sufficient resolution. Ambiguous → local model → frontier model. |
| `config/routes.rb` | Modified | Add `POST /api/manifest` route |
| `app/services/intelligence_state/mac_provider.rb` | New | Optional: if we want environment evidence in WorldStateCompiler for memory/belief context |

### Mac adapter additions (2 files)

| File | Purpose |
|------|---------|
| `Sources/Execution/NativeExecutor.swift` | Resolves `el_01` via adapter-held invocation ref. Verifies fingerprint (t₂): app + window + element must still match capture. If ref can't safely resolve (element destroyed, AX tree restructured), fail with "Target no longer available." Never silently substitute a different focused element. Accepts element-level drift only when the same semantic target is reachable via AX role+description re-resolution. |
| `Sources/Bridge/FlydClient.swift` | Per-install Keychain credential auth. HTTP POST to `/api/manifest`. Sends intent + environment. Receives resolution. Handles offline: "Cannot reach Flyd — start your Rails server." |

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
  full Flyd::Intelligence.resolve with memory + beliefs + environment
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
6. **Single invocation.** ⌃⌥ ignored while in flight. 10s timeout. Re-invocation cancels current.
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
9. Existing Flyd (Rails surface composition, CLI harness) works unchanged
10. `GET /` never calls LLM or executes provider refresh synchronously (unchanged)
11. Latency instrumentation reports actuals
12. Measured drift rate across 100+ real invocations

### Success criterion (qualitative, after one day of use)

**"Does talking to the thing I'm already looking at feel fundamentally better than opening Flyd?"**

## M2.5 — Memory gate + learning

**Cheap significance detection. No LLM in the critical path for acknowledging learning.**

### Additions

| Component | Purpose |
|-----------|---------|
| `MemoryGate` | Cheap significance check (no LLM). Explicit preference, correction, repeated topic, multi-step teaching, confirmation, recurring routine → pass. Generic Q&A → discard. |
| `MemoryReceipt` | First-class provenance struct: WHAT Flyd believes, WHY, WHEN changed, WHAT evidence changed it. Self-contained evidence (raw session can be deleted). |
| Provisional learning | Synchronous, ~500ms. "always keep answers short" → immediately: `interaction_style = keyboard`. Acknowledge to user. |
| Async synthesis | Batched, later. Deduplicate, reconcile, persist to beliefs/behaviours store. |

## M3 — Augment + designer companion

**Transient augmentation. Designer companion as the proving interaction.**

### Additions

| Component | Purpose |
|-----------|---------|
| `app/services/flyd/augment_operation.rb` | `Data.define(:kind, :content, :placement, :options)`. Kind: `explanation/choice/annotation/control`. Placement: `beside_selection/below_element/cursor`. |
| `Flyd::Intelligence` prompt extended | Augment mode grammar |
| `ManifestationValidator` extended | Augment payload validation |
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

## M5 — Compose escalation

**Connect overlay to existing Rails surface pipeline.**

### Additions

- `Flyd::Intelligence.resolve` returns `mode: "compose"` with a surface plan
- Surface created via existing `PersistPlan` + `Surface.activate!`
- Response includes `surface_url`
- Mac adapter opens browser to surface URL

**Note:** Browser launch is an M5 implementation shortcut, not the composed-interface architecture. Long term, COMPOSE routes to a Flyd manifestation host — not necessarily a browser and not necessarily leaving the current software context. The M5 shortcut is pragmatic for V1 but does not recreate the old "Flyd is a destination" pattern as permanent architecture.

### DELEGATED integration

- Delegation sends context envelopes, not bare prompts
- Envelope: intent + world_state + observation refs + memory + goal + grant + capabilities
- Specialist returns resolution, not UI. Flyd decides manifestation.

## Contracts

### Environment capture (Mac Adapter → Flyd)

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

### Resolution contract (Flyd → Mac Adapter)

```json
{
  "mode": "native",
  "reasoning": "Replying to Farza's email about Tuesday catch-up.",
  "operations": [
    { "target": "el_01", "kind": "insert_text", "text": "Hey Farza — Tuesday works great! What time were you thinking?" }
  ]
}
```

### Delegation envelope (Flyd → Specialist, M5)

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
| Compose escalation pulls user from their context | Medium | Only triggers when existing interfaces genuinely fail. Acceptable tradeoff. Deferred to M5. |
| Latency (1.5-6s) makes product feel slow | Medium | Deterministic fast path for common operations. Prewarm perception. Instrument and optimize in M2. M0-M1 prove capture is fast before we add LLM. |

## What this plan does NOT change

- Existing Rails intelligence pipeline (`compose_surface`, `WorldStateCompiler`, `InterfaceDirector`)
- Existing surface rendering (all renderers)
- Existing CLI coding harness (worker lifecycle, task store, grant model, verification)
- Existing memory, beliefs, behaviours, scenes, models
- `GET /` behavior (no LLM call, no provider refresh)
- The existing PRD's product thesis, founder decisions, and product promise
- The coding harness as the first wedge (overlay is a second wedge)

## Implementation principle

**Design ahead. Implement one milestone ahead at most.**

- M0 should take days, not weeks. Its success criterion: Flyd launches reliably, quietly understands where the user is, and pressing the invocation key produces a correctly grounded invocation without destabilizing macOS permissions.
- Then immediately M1 → M2.
- The existential test is M2. Everything before M2 validates infrastructure. Everything after M2 depends on whether it feels magical.
