# Continuous Intelligence Architecture

Flyd's continuous intelligence runs across two independent processes: the CLI daemon and the overlay Core server. This document describes the actual architecture — what exists, what's connected, and what isn't.

## The daemon loop

`cli/src/commands/daemon.ts` runs an incremental poll cycle:

```
capture → index(QMD) → embed(QMD) → interest extraction → link creation
    ↓
attention ← loadCaptureDocs() ← ~/.flyd/raw/**/*.md
    ↓
tension ← computeTension(goals, docs)
    ↓
curiosity ← generateQuestions(attention, tension)
    ↓
investigation ← investigateQuestion() → LLM-powered research
    ↓
nudge ← generateNudges(signals) → wiki/nudges.md
    ↓
wiki/attention-report.md, wiki/tension-report.md, wiki/curiosity-log.md
```

The daemon also watches for new captures in real time via `fs.watch` on `~/.flyd/raw/`.

## Attention signal model

`cli/src/lib/attention.ts` — `AttentionSignal` type:

| Field | Weight | What it measures |
|-------|--------|-----------------|
| recency | 0.15 | How recently was this topic active? (0-1, 1 = today) |
| velocity | 0.20 | How many recent captures mention this topic? (0-1, scaled to 10) |
| unresolved | 0.20 | How many captures have pending/blocked outcomes? (0-1) |
| surprise | 0.20 | Unexpected signals: pivoted, cancelled, negative feedback (0-1) |
| importance | 0.15 | Does this match the user's declared active interests? (0.8 or 0.3) |
| tension | 0.10 | Goal-derived tension score (0-1 from tension.ts) |
| composite | — | Weighted sum of the above |

`computeAttention()` groups captures by topic, applies weights, and surfaces signals above threshold. `generateNudges()` writes high-composite signals to `wiki/nudges.md`.

## Goal and tension system

`cli/src/lib/tension.ts` — track goals and compute tension:

- Goals are created explicitly (`flyd goal create`) or extracted from capture content
- Each goal has: title, topics, status (active/dormant/achieved), description
- `computeTension(goals, docs)` scores each active goal against recent captures
- Goals/tensions are exported to `~/.flyd/wiki/goals/*.md`

## Curiosity and investigation

`cli/src/lib/curiosity.ts` — LLM-powered research loop:

1. `generateQuestions(attention, tension)` — produces 3-5 insightful questions about patterns, tensions, or opportunities
2. `investigateQuestion()` — LLM analyzes relevant documents, produces findings + insights + missing evidence
3. Results written to `wiki/curiosity-log.md`

## Overlay memory pipeline

`cli/src/server.ts` — memory-gate → receipt → provisionalLearn:

```
manifest/outcome → memoryGate() → shouldRemember?
    ↓ (yes)
createMemoryReceipt() → persistReceipt() → ~/.flyd/raw/overlay/*.md
    ↓
provisionalLearn() → in-memory BELIEF_STORE/BEHAVIOUR_STORE
    ↓
/learnings/synthesize → persistLearnings() → ~/.flyd/raw/overlay/synthesis-*.md
     ↓
loadLearnings() on Core restart → repopulates BELIEF_STORE/BEHAVIOUR_STORE
```

`export-state.ts` reads from both pipelines and exports unified evidence for Rails consumption.

## Actual integration points

### ✓ Overlay receipts → daemon: physically connected, semantically broken

Files land under `~/.flyd/raw/overlay/*.md`. `loadCaptureDocs()` is recursive — it discovers them.

But receipts use `generated_at`, `category`, `confidence` in frontmatter, while `CaptureDoc` parsing (`attention.ts:109-130`) expects `timestamp`/`date`/`created`, `event_type`/`type`, `outcome`, `signal`. Result: receipts enter attention with empty date, `observation` eventType, null outcome/signal — losing all semantics.

**Status (2026-07-28, Plan 003): RESOLVED.** Receipts now carry `timestamp`, `event_type`, `outcome`, `signal`, `topics` in frontmatter matching the daemon schema. `daysAgo()` fixed to handle already-Z-terminated timestamps.

### ✓ Goals/tensions → resolver: already integrated

`resolve.ts` reads goals and tensions from the intelligence state into the resolution context prompt. Goal-derived tension scores influence the world state the LLM sees.

### ✗ Attention signals → resolver: not integrated

`AttentionSignal` data is built into `IntelligenceState` (via `export-state.ts`) but the resolution prompt in `resolve.ts` does not consume it. A nudge about "project X has high tension" does not influence how `/manifest` resolves intents about project X.

**Status (2026-07-28): DEFERRED.** Tracked for follow-up plan.

### ✗ Synthesized beliefs → durable operational memory: broken

`persistLearnings()` writes `~/.flyd/raw/overlay/synthesis-*.json`. QMD indexes `**/*.md` only — `.json` files are invisible. `loadCaptureDocs()` reads `.md` only. BELIEF_STORE is process-memory and does not survive restart. Synthesis output is effectively lost.

**Status (2026-07-28, Plan 003): RESOLVED.** `persistLearnings()` now writes `.md` files with `promoted: false` and `epistemic_status: inferred`. `loadLearnings()` repopulates belief/behaviour stores from disk on Core startup. Synthesis files are indexed by QMD (`**/*.md`) and read by `loadCaptureDocs()`.

### ✗ Overlay receipts → incremental daemon: broken

`findNewCapturesSince()` in `linking.ts:136-151` is non-recursive — it reads only the top level of `~/.flyd/raw/`. Overlay receipts in `raw/overlay/` are never treated as new captures by the incremental link/interest path. They only appear in full batch attention scans.

**Status (2026-07-28, Plan 003): RESOLVED.** `findNewCapturesSince()` now scans `raw/overlay/` alongside top-level `raw/`. Overlay receipts trigger incremental interest extraction and auto-linking.

### ✗ Daemon-side trigger for overlay outcomes: none

No trigger fires when overlay outcomes suggest a new tension or resolved goal. The daemon polls on its own cycle, unaware of overlay activity.

**Status (2026-07-28): DEFERRED.** Tracked for follow-up plan.

## Non-goals (not in the current architecture)

- Real-time monitoring or push notifications
- Cross-device sync
- NLP-based intent parsing in the attention loop
- Automatic goal extraction from overlay outcomes

## Plan 003 — Memory Convergence & Epistemic Integrity

**Shipped 2026-07-28.** All five integration gaps between overlay and daemon are resolved:

| Gap | Status |
|-----|--------|
| Receipt schema mismatch | RESOLVED — event-semantic frontmatter + `daysAgo()` fix |
| Synthesis JSON dead end | RESOLVED — `.md` format + `loadLearnings()` on startup + `promoted: false` anti-corroboration |
| BELIEF_STORE volatility | RESOLVED — file-backed store loaded on Core restart |
| `findNewCapturesSince()` non-recursive | RESOLVED — explicit `raw/overlay/` scan |
| Attention signals → resolver | DEFERRED — tracked for follow-up |

Additionally shipped: epistemic status flattening fix (8 wiki statuses → distinct values), 5-dimension confidence profile (epistemic ≠ freshness ≠ utility), graph neighbor discovery (behind `FLYD_GRAPHDISCOVERY_ENABLED`), Memory Pack preserving metadata to intelligence, contradiction count population, and MemoryEdge operationalization in Rails.
