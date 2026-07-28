---
title: Memory Convergence & Epistemic Integrity
type: feat
status: active
date: 2026-07-28
origin: Memory Runtime PRD (user-provided, 2026-07-28) + validated against codebase in ce-plan session
deepened: 2026-07-28
supersedes: deferred claim model, memory events, and canonical persistence layer to a follow-up Claim/Event Runtime plan
---

# Memory Convergence & Epistemic Integrity

## Summary

Repairs the seven broken semantic boundaries across Flyd's three separate memory systems — overlay gate→receipt, CLI brain-retrieval/librarian, and Rails decision/belief/MemoryEdge — so they communicate correctly and preserve epistemic provenance through every retrieval boundary. Fixes: epistemic status flattening, confidence/conflation (epistemic vs. freshness vs. utility), overlay→daemon receipt schema mismatch, synthesis JSON invisibility, graph-only-boosts-no-discovery, metadata stripping before intelligence injection, and non-recursive incremental scan. Establishes five independent confidence dimensions, event-semantic receipt frontmatter, a file-backed belief store, graph neighbor discovery with proper node resolution, and a structured Memory Pack that preserves metadata to the intelligence layer.

**This plan specifically does NOT introduce a canonical claim store or event-sourced persistence layer.** Markdown files, Rails Beliefs/Decisions, and in-process belief arrays remain transitional representations. The canonical Claim/Event Runtime is deferred to a follow-up plan. This plan repairs the existing systems so they communicate correctly and preserve epistemic boundaries — it closes the broken pipes before replacing the plumbing.

Each Phase A unit is independently shippable. Phase B (Memory Pack) depends on the fixed epistemic statuses and confidence dimensions from Phase A. Phase C (Rails alignment + integration fixes) runs in parallel to Phase B.

---

## Problem Frame

Flyd maintains three independent memory systems that operate without semantic integration:

1. **Overlay memory gate** (`cli/src/memory-gate.ts`): LLM-free regex gating that writes receipts to `~/.flyd/raw/overlay/*.md` and synthesizes beliefs as `~/.flyd/raw/overlay/synthesis-*.json`. Stores beliefs/behaviours in process-local arrays that do not survive restart.

2. **CLI personal memory** (`cli/src/lib/brain-retrieval.ts`, `librarian.ts`, etc.): File-based wiki + raw capture system with QMD hybrid search, librarian scoring, graph augmentation, and context bundle compilation.

3. **Rails relational memory** (`lib/subsystems/memory_engine.rb`, `belief_engine.rb`): PostgreSQL-based decision extraction, belief synthesis with LLM contradiction detection, world state compilation.

These systems are not merely separate — their integration points are broken:

| Gap | System pair | Severity | Root cause |
|-----|------------|----------|------------|
| Epistemic status flattening | Wiki → brain-retrieval | **P0** | `memoryEpistemicStatus()` maps all wiki entries to `user_confirmed`, ignoring the 8-state `status` field (canon/working/speculative/questioned/unresolved/contradictory/dormant/episodic) |
| Confidence conflation | CLI librarian + Rails MemoryEdge | **P0** | `librarianScore` combines recency, reliability, keyword density, interest boost — retrieval relevance, not truth confidence. `MemoryEdge#cite!` increments confidence by 0.05 on citation |
| Receipt schema mismatch | Overlay → daemon | **P1** | 6 field mismatches: `generated_at` vs `timestamp\|date\|created`, `category` vs `event_type\|type`, no `outcome` field, no `signal` field, no `topics` field. Result: receipts invisible to attention scoring |
| Synthesis JSON dead end | Overlay → QMD + daemon | **P1** | Synthesized beliefs written as `.json` — QMD indexes only `.md`, `loadCaptureDocs()` reads only `.md`. BELIEF_STORE is process-memory lost on restart |
| Graph-only-boosts | CLI retrieval → graph | **P2** | `augmentWithGraph()` only boosts scores of already-retrieved entries; never adds graph neighbors as new candidates. `MemoryEdge` table has `relationship_type` column but zero application code creates edges |
| Metadata stripping | CLI retrieval → resolution prompt | **P1** | `retrieveMemories()` discards all metadata (epistemic status, confidence, staleness, corroboration) reducing to `{path, excerpt}` — then prompt uses only excerpt |
| Non-recursive incremental scan | Daemon → overlay receipts | **P3** | `findNewCapturesSince()` uses `readdirSync()` (top-level only), so `raw/overlay/` receipts never trigger incremental interest extraction |

The product thesis — Flyd accumulates understanding across sessions — cannot be fulfilled while wiki entries with `status: speculative` cross the retrieval boundary as `user_confirmed`, retrieval relevance and truth confidence are the same score, overlay outcomes produce receipts the daemon cannot semantically read, synthesized beliefs evaporate on process restart, and graph edges are purely decorative.

---

## Requirements

### R1. Epistemic integrity

Wiki entries carry their `status` field through the entire retrieval pipeline. `memoryEpistemicStatus()` maps each of the 8 wiki states to a distinct value. The intelligence layer receives the actual epistemic status, not a flattened binary.

**Acceptance:** A wiki entry with `status: speculative` produces `epistemicStatus: "speculative"` at the retrieval boundary and in the Memory Pack. `status: contradicted` carries through as `epistemicStatus: "contradicted"`.

### R2. Independent confidence dimensions

Five dimensions replace the single `librarianScore`/`confidence`:
- `epistemicConfidence` — how likely the claim is true. Derived from source authority (user-stated > verified > observed > inferred), independent corroboration count, and contradiction signals. **Does NOT decay with age.** An old fact doesn't become less true because it's old.
- `freshness` — whether the information is still current. Derived from temporal decay with per-type half-life and revalidation policy. Old repository state is not epistemically dubious — it is stale.
- `interestAffinity` — whether this memory matches the user's known active interests. Derived from active interest topic/keyword overlap. (Precursor to future `retrievalUtility`.)
- `retrievalUtility` — whether this memory has previously helped Flyd in similar contexts. Derived from RetrievalTrace. **Null/neutral in this release** — RetrievalTrace is deferred.
- `associationStrength` — how strongly two memories are related. Derived from graph edge confidence.

Epistemic confidence must never be changed by retrieval frequency, interest match, or recency. A frequently-accessed memory is more retrievable, not more true.

**Acceptance:** Unit test asserts changing `freshness` does not change `epistemicConfidence`. Unit test asserts verifying a claim via corroboration increments `epistemicConfidence` but not `freshness`. Unit test asserts an old claim with high source authority retains high `epistemicConfidence` while `freshness` drops.

### R3. Overlay receipts carry event-semantic frontmatter

Receipt files write frontmatter fields matching the daemon/attention expected schema: `timestamp`, `event_type`, `outcome`, `signal`, `topics`. A receipt for a user correction produces `event_type: "correction"`, `outcome: "confirmed"`, `signal: "correction_feedback"`. A receipt for a repeated topic produces `event_type: "repeated_topic"`, `outcome: "confirmed"`, and extracted `topics`.

**Acceptance:** Daemon `loadCaptureDocs()` parses an overlay receipt and produces a `CaptureDoc` with non-empty `date`, correct `eventType`, correct `outcome`, correct `signal`, and non-empty `topics`.

### R4. Synthesized beliefs are loadable, indexable, and survive restart

Belief synthesis writes output in a format readable by both QMD indexing and `loadCaptureDocs()`. BELIEF_STORE is replaced by a persistent store. On Core restart, previously synthesized beliefs are loaded and available.

**Acceptance:** Core starts, `POST /learnings/synthesize` runs, process restarts, `GET /learnings` returns previously synthesized beliefs.

### R5. Graph expansion discovers neighbors

`augmentWithGraph()` adds graph neighbors (1 hop, budget-capped, relationship-weighted) to the candidate set. Superseded/expired items are excluded by default; contradictory claims are retrieved together when one side is relevant.

**Acceptance:** A graph edge `claimA --supports--> claimB` where claimA matches retrieval but claimB does not → claimB appears in candidates. Graph expansion is benchmark-gated: if precision@5 degrades, expansion is disabled until fixed.

### R6. Memory Pack preserves metadata to intelligence

The `RetrievedMemory` type is replaced by `MemoryPack` carrying: `current` (active context), `relevant` (retrieved claims), `conflicts` (competing claims), `gaps` (known knowledge gaps), `sources` (evidence references). Each claim carries `claimId`, `content`, `kind`, `scope`, `epistemicStatus`, `epistemicConfidence`, `freshness`, `sourceRefs`, `relevance`. The resolution prompt formats these as structured context with guidance on how to use each metadata dimension.

**Acceptance:** The resolution prompt includes a formatted memory block with epistemic status annotations, confidence indicators, and conflict annotations. A speculative claim is marked as such. A verified claim carries its verification evidence reference.

### R7. Receipt incremental processing

`findNewCapturesSince()` is recursive, or overlay receipts are written to `raw/` top-level (not `raw/overlay/`), or the daemon's incremental path explicitly includes the overlay directory.

**Acceptance:** An overlay outcome that produces a receipt triggers incremental interest extraction within the next daemon poll cycle.

### R8. Rails alignment

The `MemoryEdge` model's `relationship_type` column is used operationally. Decision extraction and belief synthesis carry epistemic status through to the world state. The world state compiler surfaces claims with structured metadata, not just content text. Rails beliefs use the same confidence dimension separation as the CLI pipeline.

**Acceptance:** `MemoryEdge.create` is called from application code (between related Beliefs). `WorldStateCompiler` includes `epistemic_status` and `epistemic_confidence` per belief in project snapshots.

### R9. No regressions

All existing memory functionality — search, ask, context compilation, consolidation, memory gate, receipt persistence, overlay resolution — continues to work with identical or improved behavior. The `corroborationCount` continues to function. The `contradictionCount` is populated from actual contradiction detection.

**Acceptance:** All existing tests pass. Manual: `flyd ask "what do I do"` returns results. Overlay invocation → outcome reported → receipt written.

---

## Scope Boundaries

### In scope

- Fix epistemic status flattening in `memoryEpistemicStatus()` and the retrieval boundary
- Separate confidence dimensions in `scoreEvidence()`, `librarian.ts`, and the `ScoredEvidence` type
- Add receipt frontmatter fields matching the daemon event schema (`timestamp`, `event_type`, `outcome`, `signal`, `topics`)
- Replace `.json` synthesis output with `.md` and add load path
- Replace in-process `BELIEF_STORE` with file-backed belief store
- Implement graph neighbor discovery in `augmentWithGraph()`
- Replace `RetrievedMemory` with `MemoryPack` and update the resolution prompt format
- Make `findNewCapturesSince()` discover overlay receipts (explicit overlay directory path)
- Use `MemoryEdge.relationship_type` in operational code (Rails belief synthesis)
- Surface epistemic metadata in `WorldStateCompiler`
- Populate `contradictionCount` from existing wiki contradiction detection (consolidate.ts)
- All corresponding test coverage

### Explicit non-goal: This plan does NOT establish a canonical claim store

Markdown files, Rails Beliefs/Decisions, overlay in-process belief arrays, and QMD-indexed wiki files remain **transitional representations** pending a canonical Claim/Event Runtime (deferred to a follow-up plan). This plan repairs the broken pipes between existing stores — it establishes correct semantic boundaries and epistemic provenance — but does not unify them into a single persistence model. No new database tables, no new file format authority, no claim ID namespace. The existing systems continue to operate independently, now communicating correctly.

### Deferred to Follow-Up Work

- Canonical Claim/Event Runtime — unified claim model, event-sourced persistence, authoritative claim ID namespace
- Full claim model schema — identity, kind, scope, validity periods, revalidation policy, source_refs
- Memory events system — ADD/SUPPORT/CONFIRM/CHALLENGE/CONTRADICT/SUPERSEDE/CORRECT/EXPIRE/REVALIDATE/REJECT
- Write-time consolidation — similarity-based duplicate detection, automatic SUPPORT/CONTRADICT/ADD routing
- KnowledgeGap as a first-class object — gap detection, gap resolution workflow
- RetrievalTrace feedback loop — recording retrieval outcomes, verified/rejected memories, co-relevance signals
- Precision verification stage — LLM listwise reranker for candidate pruning
- 2-hop graph traversal and relationship-specific weights
- Automatic `relates_to` edge creation from co-usage patterns
- Full attention→resolver integration for AttentionSignal consumption
- Daemon-side trigger for overlay outcome events
- Cross-PRD reconciliation with the coding-agent platform PRD

---

## Context & Research

### Relevant Code and Patterns

- **Memory retrieval pipeline:** `cli/src/lib/brain-retrieval.ts` — `retrieveRankedBrainEvidence()` (lines 177-203), `memoryEpistemicStatus()` (lines 123-128), `MemoryMatch` interface (lines 28-47)
- **Librarian scoring:** `cli/src/lib/librarian.ts` — `scoreEvidence()` (lines 39-85), `estimateSufficiency()` (lines 111-160), `contradictionCount` hardcoded to 0 (line 83)
- **Graph augmentation:** `cli/src/lib/retrieval.ts` — `augmentWithGraph()` (lines 183-204), boost-only, no neighbor discovery
- **Decay:** `cli/src/lib/decay.ts` — `DEFAULT_HALF_LIVES` (lines 6-16), `decayedValue()` (lines 18-27)
- **Overlay memory gate:** `cli/src/memory-gate.ts` — 7-category classification, `shouldRemember` verdict
- **Receipt persistence:** `cli/src/memory-persistence.ts` — `persistReceipt()` writes `.md` with frontmatter (generated_at, category, confidence), `persistLearnings()` writes `.json`
- **Provisional beliefs:** `cli/src/memory-receipt.ts` — `BELIEF_STORE`/`BEHAVIOUR_STORE` in-process arrays, `synthesizeLearnings()` (lines 140-199)
- **Daemon attention:** `cli/src/lib/attention.ts` — `loadCaptureDocs()` (recursive, lines 98-133), `CaptureDoc` parsing (lines 109-130)
- **Incremental scan:** `cli/src/lib/linking.ts` — `findNewCapturesSince()` (non-recursive, lines 136-151)
- **Daemon loop:** `cli/src/commands/daemon.ts` — incremental poll + proactive cycle
- **Resolution prompt:** `cli/src/resolve.ts` — `retrieveMemories()` (strips to `{path, excerpt}`, lines 89-107), `buildResolutionPrompt()` (lines 131-272)
- **Context bundles:** `cli/src/lib/context-bundles.ts` — `readContextBundles()` (lines 27-53), 5-bundle structure
- **Rails MemoryEngine:** `lib/subsystems/memory_engine.rb` — decision extraction with LLM, `inject_context_into_prompt()`
- **Rails BeliefEngine:** `lib/subsystems/belief_engine.rb` — synthesis, topic extraction, contradiction detection via LLM
- **Rails MemoryEdge:** `app/models/memory_edge.rb` — `cite!`/`decay!` methods, `relationship_type` column (added in migration, never used operationally)
- **Rails Belief:** `app/models/belief.rb` — active/challenged/superseded states, `source_decision_ids` jsonb
- **Decayable:** `app/models/concerns/decayable.rb` — `compute_decay_score` via `2^(-elapsed/half_life)`, `reinforce!`
- **WorldStateCompiler:** `app/services/flyd/world_state_compiler.rb` — `project_snapshots()` (lines 215-243), decisions + beliefs per project
- **Wiki frontmatter schema:** 8 statuses (canon/working/speculative/questioned/unresolved/contradictory/dormant/episodic), 4 time_shapes, 3 life_phases — all currently ignored by `memoryEpistemicStatus()`
- **QMD SDK:** `cli/src/lib/qmd.ts` — `**/*.md` pattern for indexing, `search()` with RRF merge

### Institutional Learnings

- **Overlay deep review** (`docs/solutions/security-issues/overlay-deep-review-auth-bypass-orphaned-tasks-2026-07-23.md`): Store active task handles and cancel on re-entry. Applied to belief store load on restart (U4).
- **Thin-adapter architecture** (`docs/solutions/architecture-patterns/flyd-overlay-thin-adapter-typescript-core-2026-07-23.md`): Adapter never decides. Core produces structured memory. Applied to Memory Pack design (U6).
- **CLI/Rails brain parity** (`docs/superpowers/specs/2026-07-16-cli-rails-brain-parity-design.md`): One brain with two interfaces. Applied to unified confidence model across CLI + Rails (U2, U9).
- **Continuous intelligence architecture** (`docs/plans/2026-07-28-002-refactor-architectural-realignment-plan.md` U14): Five documented gaps between overlay and daemon. Four resolved in this plan (U3, U4, U7, U10); one deferred (attention signals → resolver).

### External References

No external research was conducted. All work follows existing conventions and fixes codebase-verified gaps.

---

## Key Technical Decisions

### Epistemic status mapping (fix for gap 1)

Current code (`brain-retrieval.ts:123-128`):
```typescript
function memoryEpistemicStatus(entry: ScoredEvidence): "observation" | "user_confirmed" {
  if (entry.metadata.type === "conversation-index" || entry.metadata.promoted === false) return "observation";
  if (entry.source === "wiki") return "user_confirmed";
  if (entry.metadata.type === "flyd-runtime-task-corrected") return "user_confirmed";
  return "observation";
}
```

Fix: Read the entry's actual `status` field from wiki frontmatter. Map the 8 allowed values to distinct epistemic statuses:

| Wiki `status` | Epistemic status | Reason |
|---|---|---|
| `canon` | `verified` | Has been confirmed through use |
| `working` | `working_assumption` | Currently in use, not yet verified |
| `speculative` | `speculative` | Low-confidence, not yet tested |
| `questioned` | `questioned` | Under active challenge |
| `unresolved` | `unresolved` | Competing claims, no resolution |
| `contradictory` | `contradictory` | Known conflict with other evidence |
| `dormant` | `dormant` | Not actively maintained |
| `episodic` | `episodic` | Time-bound, not general |

Raw captures without wiki elevation remain `observation`. Runtime corrections remain `user_confirmed`.

### Confidence dimension separation (fix for gap 2)

Replace the single `librarianScore` in `ScoredEvidence` with a `ConfidenceProfile` carrying five independent dimensions:

```typescript
interface ConfidenceProfile {
  epistemicConfidence: number;   // 0-1. Source authority + corroboration - contradiction. Does NOT decay with age.
  freshness: number;              // 0-1. Temporal decay with per-type half-life. How current is this?
  interestAffinity: number;       // 0-1. How strongly does this match the user's active interests?
  retrievalUtility: number;       // 0-1. Has this memory helped in similar contexts? Null/neutral in this release.
  associationStrength: number;    // 0-1. Strongest graph edge confidence for this entry, 0 if no edges.
}
```

Score derivation:
- `epistemicConfidence` = source authority from `metadata.confidence` (base: wiki=0.9, raw=0.5) × corroboration boost (+0.05 per corroborating entry, capped at +0.2) − contradiction penalty (−0.1 per contradiction edge, floor 0.1). **No temporal decay.** A fact does not become less true because it is old. "My name is George" with high source authority retains high epistemic confidence regardless of age.
- `freshness` = `max(0, 1 - daysSince / halfLifeDays)` using per-type half-life from `decay.ts`. This is where temporal decay lives. "Flyd's current branch is main" has high epistemic confidence but low freshness when stale.
- `interestAffinity` = `interestBoost` from active interest topic/keyword overlap. Existing signal, correctly named. Distinct from future `retrievalUtility`.
- `retrievalUtility` = 0.5 (neutral baseline). Incremented by RetrievalTrace in follow-up plan. Not populated from retrieval signals in this release.
- `associationStrength` = max graph edge confidence for matching edges, 0 if none. Populated by graph augmentation in U5.

Composite `librarianScore` (for ranking):
```
librarianScore = epistemicConfidence * 0.25 + freshness * 0.25 + keywordDensity * 0.25 + interestAffinity * 0.15 + associationStrength * 0.10
```

Note: Epistemic confidence and freshness are genuinely independent — the formula separates them. A speculative claim about something current can have low epistemic but high freshness. A verified claim about old repository state can have high epistemic but low freshness.

### Receipt frontmatter fix (fix for gap 3)

Current receipt frontmatter:
```yaml
id: <uuid>
generated_at: <ISO>
source: flyd-overlay
category: <gateReason string>
confidence: <narrative string>
self_contained: true
```

Fix: Add event-semantic fields matching the daemon's expected schema:
```yaml
id: <uuid>
timestamp: <ISO>          # matches attention.ts:115 expectation
generated_at: <ISO>       # retained for backward compat
source: flyd-overlay
event_type: <category>    # explicit_preference | correction | repeated_topic | teaching | recurring_routine
outcome: <outcomeStatus>  # succeeded | rejected | failed | cancelled
signal: <derivedSignal>   # mapped from gate category
topics:
  - <extracted>       # from intent text keyword extraction; list syntax required by frontmatter.ts
category: <gateReason>    # retained for backward compat
confidence: high|medium   # simplified from current narrative string
self_contained: true
```

Signal derivation (gate category → attention-compatible signal):
- `explicit_preference` → `preference`
- `correction` → `correction_feedback`
- `repeated_topic` → `recurring_interest`
- `teaching` → `workflow_defined`
- `recurring_routine` → `routine_detected`
- `confirmation` → `confirmed`
- default → `observation`

Topic extraction: run `extractKeywords()` from `retrieval.ts` on the intent text. **Do NOT force "flyd-overlay" as a default topic** — an empty-topics receipt correctly reflects that the receipt's content didn't match any known attention topics, and forcing a synthetic topic creates a permanently high-velocity fake topic that pollutes the attention engine. A receipt with no extractable topics produces an empty list.

**Receipt topics MUST use list syntax, not inline YAML arrays.** Flyd's custom frontmatter parser in `frontmatter.ts` does not support `[inline, arrays]`. The correct format is:
```yaml
topics:
  - keyword1
  - keyword2
```
Inline arrays would silently fail to parse, producing empty topics arrays.

**Timestamp format:** The daemon's `attention.ts` `daysAgo()` function (line 81) appends `"Z"` to date strings before parsing: `new Date(date + "Z")`. An ISO timestamp already ending in `Z` becomes `"...Z"Z"` and fails to parse, returning 365 days. Fix `daysAgo()` to handle already-Z-terminated timestamps, or emit timestamps without trailing Z. Prefer the parsing fix (more robust).

### Synthesis output format (fix for gap 4)

Replace `persistLearnings()` JSON output with markdown + frontmatter:

```markdown
---
timestamp: <ISO>
source: flyd-overlay-synthesis
event_type: belief_synthesis
outcome: confirmed
promoted: false
epistemic_status: inferred
derived_from:
  - receipt-2026-07-28T12-00-00-000Z-a1b2c3d4.md
  - receipt-2026-07-28T14-00-00-000Z-e5f6g7h8.md
---
## Synthesized Beliefs
- **Subject:** response_verbosity, **Predicate:** has_value, **Object:** concise, **Confidence:** 0.85
## Synthesized Behaviours
- **Pattern:** response_verbosity, **Response:** concise, **Context:** overlay_invocation, **Confidence:** 0.70
```

**Critical: `promoted: false` and `epistemic_status: inferred` prevent fake corroboration.** Without these flags, the QMD retrieval pipeline can return both the synthesis file AND its source receipt files. `corroborate()` groups entries by shared significant words — so a synthesis belief stating "George prefers concise answers" and its source receipt containing "keep answers short" would share words and be counted as corroborating each other. This creates a false signal: it looks like two independent pieces of evidence support the same claim, but one is derived from the other. The `promoted: false` flag excludes synthesis from corroboration counts (matching the existing `brain-retrieval.ts` behavior for unpromoted entries), and `epistemic_status: inferred` tells the retrieval pipeline this is a derived document, not original evidence. The `derived_from` field records provenance so future automated tools can trace lineage.

Replace in-process `BELIEF_STORE`/`BEHAVIOUR_STORE` with a file-backed loader: on server start, `loadLearnings()` reads all `synthesis-*.md` files from `~/.flyd/raw/overlay/` and rebuilds the arrays. On `POST /learnings/synthesize`, writes the markdown file AND updates the in-memory arrays.

### Graph neighbor discovery (fix for gap 5)

Current `augmentWithGraph()` only boosts existing entries. Fix: two-phase:
1. **Boost phase** (preserved): boost scores of entries matching graph endpoints
2. **Discover phase** (new): for each graph edge where a candidate matches one endpoint, add the OTHER endpoint's wiki file to the candidate set if it exists and passes `MIN_SCORE`

Discovery is 1-hop, budget-capped at `MAX_ENTRIES + 4` total. Gated behind `FLYD_GRAPHDISCOVERY_ENABLED` env var (default `true`). If benchmark shows precision@5 degradation, gating allows disabling without redeploy.

### Memory Pack type and resolution prompt format (fix for gap 6)

Replace `RetrievedMemory { path, excerpt }` with structured `MemoryPack`:

```typescript
interface MemoryPack {
  current: ActiveContextClaim[];      // from hot state: task, project, recent correction
  relevant: RetrievedClaim[];         // from brain retrieval pipeline
  conflicts: ConflictPair[];          // competing claims retrieved together
  gaps: KnowledgeGap[];               // known unknowns
  sources: EvidenceRef[];             // provenance chain
}

interface RetrievedClaim {
  claimId: string;
  content: string;                    // the claim text
  kind: ClaimKind;                    // fact | preference | constraint | procedure | decision | hypothesis | state
  scope: ClaimScope;                  // global | project | task | session | environment
  epistemicStatus: string;            // verified | working_assumption | speculative | questioned | unresolved | contradictory | dormant | episodic | observation | user_confirmed
  epistemicConfidence: number;        // 0-1
  freshness: number;                  // 0-1
  sourceRefs: string[];               // evidence file paths
  relevance: number;                  // composite librarian relevance
}
```

Resolution prompt format: Claims formatted with epistemic status indicators:
```
RELEVANT MEMORY (from Flyd's knowledge base — use silently, never cite file paths):
- [verified · high confidence] George prefers concise answers.
- [speculative · low confidence] Flyd's deployment may use Cloudflare Pages.
- [contradictory · uncertain] ⚠ Competing claims about interface:
  a) Flyd uses dynamic cards (questioned — last confirmed 45 days ago)
  b) Flyd uses text-only interaction (working — last confirmed 2 days ago)
  CONFLICT — do not assume either. Ask if critical.
```

Context bundle injection (for identity questions) preserves its existing format. Memory status fallback (when nothing found) is unchanged.

### findNewCapturesSince fix (fix for gap 7)

Add explicit overlay directory to the scan in `linking.ts:findNewCapturesSince()`:

```typescript
const overlayDir = join(RAW_DIR, "overlay");
const overlayFiles = existsSync(overlayDir)
  ? readdirSync(overlayDir)
      .filter(f => f.endsWith(".md") && statSync(join(overlayDir, f)).mtimeMs >= sinceTimestamp)
      .map(f => join(overlayDir, f))
  : [];
const files = [...existingRawFiles, ...overlayFiles].sort();
```

Targets the known subdirectory without changing behavior for other directories under `raw/`.

### MemoryEdge operationalization (Rails alignment)

In `BeliefEngine#synthesize`, create `MemoryEdge` records with `relationship_type: "derived_from"` between source Decisions and the Belief. In `detect_contradictions`, create edges with `relationship_type: "contradicts"` between contradictory decision and belief.

`WorldStateCompiler`: Add `epistemic_status` and `epistemic_confidence` to belief and decision snapshots in project data.

### contradictionCount population

In `consolidate.ts`, the existing contradiction detection phase (step 6, LLM pairwise comparison of same-type wiki entries) already runs. Ensure it creates graph edges with `rel_type: "contradicts"`. In `librarian.ts`, during the pipeline after graph augmentation, look up contradiction edges for each entry and populate `contradictionCount`. This makes the existing dead code in `estimateSufficiency()` (`conflicting` verdict) functional.

---

## High-Level Technical Design

### Unified memory data flow (after all fixes)

```
OVERLAY INVOCATION
  ↓
memoryGate() → createMemoryReceipt() → persistReceipt()
  ↓                                       ↓
  ↓                              ~/.flyd/raw/overlay/receipt-*.md
  ↓                              [timestamp, event_type, outcome, signal, topics]
  ↓                                       ↓
  ↓                              daemon: loadCaptureDocs() (recursive)
  ↓                                       ↓
  ↓                              attention → computeAttention() with real data
  ↓                                       ↓
  ↓                              tension → curiosity → nudge
  ↓
provisionalLearn() → /learnings/synthesize → persistLearnings()
  ↓                                               ↓
BELIEF_STORE ← loadLearnings() on start    ~/.flyd/raw/overlay/synthesis-*.md
  ↓                                               ↓
  ↓                              QMD index (**/*.md → finds receipts + synthesis)
  ↓                              findNewCapturesSince() → discovers overlay receipts
  ↓                                               ↓
  └────────────────→ resolve() ← retrieveMemories() → buildMemoryPack()
                              ↓
                     MemoryPack { current, relevant, conflicts, gaps, sources }
                              ↓
                     buildResolutionPrompt() → structured claims with epistemic metadata
                              ↓
                     LLM resolves with provenance awareness

RAILS MEMORY (parallel pipeline)
  conversations → MemoryEngine.extract_decisions() → Decision records
  Decision → BeliefEngine.synthesize() → Belief records
  BeliefEngine → MemoryEdge.create(relationship_type: "derived_from")
  BeliefEngine.detect_contradictions() → MemoryEdge.create(relationship_type: "contradicts")
  WorldStateCompiler → project_snapshots with epistemic_status + epistemic_confidence
  Intelligence → LLM with structured metadata
```

### Unchanged invariants

- Memory gate remains LLM-free (regex-based)
- Privacy invariants unchanged (no raw audio storage, no screenshot persistence)
- Thin-adapter: adapter never decides
- Raw captures remain immutable
- Wiki file format unchanged (frontmatter fields extended, not replaced)
- QMD SDK usage unchanged (same `createStore()` + `search()`)
- Rails schema unchanged (using existing tables, new data populated into existing columns)
- Overlay resolution path unchanged (manifest → resolve → outcome pipeline)
- Context bundles unchanged (separate from Memory Pack)
- Decay formulas unchanged (half-life constants unchanged)

---

## Implementation Units

### Phase A: Repair semantic boundaries (independently shippable)

---

### U1. Fix epistemic status flattening

**Goal:** `memoryEpistemicStatus()` maps wiki `status` field to 8 distinct epistemic statuses instead of flattening everything to `user_confirmed`.

**Requirements:** R1

**Dependencies:** None

**Files:**
- `cli/src/lib/brain-retrieval.ts` (`memoryEpistemicStatus()` at line 123-128)
- `cli/src/lib/brain-retrieval.ts` (`MemoryMatch` interface — change `epistemicStatus` type)
- `cli/src/__tests__/brain-retrieval.test.ts` (new or extended)

**Approach:**

Replace the 4-line function with a mapping that reads `entry.metadata.status` and maps each of the 8 allowed values to a distinct string. The `epistemicStatus` field changes from `"observation" | "user_confirmed"` to `string` (or a union type of the mapped values). Fallback: wiki entries without a `status` field default to `"working_assumption"`. Raw captures without wiki elevation remain `"observation"`.

Mapping table:

| `metadata.status` | `epistemicStatus` |
|---|---|
| `canon` | `verified` |
| `working` | `working_assumption` |
| `speculative` | `speculative` |
| `questioned` | `questioned` |
| `unresolved` | `unresolved` |
| `contradictory` | `contradictory` |
| `dormant` | `dormant` |
| `episodic` | `episodic` |
| Raw capture (no wiki status) | `observation` |
| `type: flyd-runtime-task-corrected` | `user_confirmed` |
| `type: conversation-index` or `promoted: false` | `observation` |

**Execution note:** Test-first. Create wiki fixture files with each of the 8 statuses and verify the correct epistemic status emerges from `retrieveBrainEvidence()`.

**Patterns to follow:** Existing `memoryEpistemicStatus()` function signature, `MemoryMatch` interface convention.

**Test scenarios:**
- Wiki entry with `status: canon` → `epistemicStatus: "verified"`
- Wiki entry with `status: speculative` → `epistemicStatus: "speculative"`
- Wiki entry with `status: contradictory` → `epistemicStatus: "contradictory"`
- Wiki entry with `status: questioned` → `epistemicStatus: "questioned"`
- Wiki entry with `status: unresolved` → `epistemicStatus: "unresolved"`
- Wiki entry with `status: working` → `epistemicStatus: "working_assumption"`
- Wiki entry with `status: dormant` → `epistemicStatus: "dormant"`
- Wiki entry with `status: episodic` → `epistemicStatus: "episodic"`
- Wiki entry with no `status` field → `epistemicStatus: "working_assumption"` (fallback)
- Raw capture (source: "raw") → `epistemicStatus: "observation"`
- Raw capture with `type: flyd-runtime-task-corrected` → `epistemicStatus: "user_confirmed"`

**Verification:** `cd cli && npm test` passes. Manual: `flyd ask "test query" --verbose` shows non-flattened epistemic statuses in output.

---

### U2. Separate confidence dimensions in librarian scoring

**Goal:** `ScoredEvidence` carries five independent confidence dimensions. Epistemic confidence does NOT decay with age. Freshness handles temporal decay separately. Interest affinity is distinct from retrieval utility.

**Requirements:** R2

**Dependencies:** None (parallelizable with U1)

**Files:**
- `cli/src/lib/librarian.ts` (`ScoredEvidence` interface, `scoreEvidence()`, `estimateSufficiency()`)
- `cli/src/lib/brain-retrieval.ts` (`MemoryMatch` interface, `retrieveBrainEvidence()`)
- `cli/src/lib/__tests__/librarian.test.ts` (extend)
- `cli/src/lib/__tests__/brain-retrieval.test.ts` (extend)

**Approach:**

1. Add `ConfidenceProfile` to `ScoredEvidence` with five dimensions:
```typescript
interface ConfidenceProfile {
  epistemicConfidence: number;   // source authority + corroboration - contradiction. No decay.
  freshness: number;              // temporal decay with per-type half-life
  interestAffinity: number;       // active interest topic/keyword overlap
  retrievalUtility: number;       // null/neutral in this release — requires RetrievalTrace
  associationStrength: number;    // strongest graph edge confidence
}
```

2. In `scoreEvidence()`:
   - `epistemicConfidence` = `max(0.1, rawConfidence + corroborationBoost - contradictionPenalty)` where `rawConfidence` comes from source authority (wiki=0.9, raw=0.5, or `metadata.confidence`). `corroborationBoost` = +0.05 per corroborating entry (capped at +0.2). `contradictionPenalty` = −0.1 per contradiction edge (floor 0.1). **No age-based decay in this dimension.**
   - `freshness` = `max(0, 1 - daysSince / halfLifeDays)` using per-type half-life from `decay.ts`. This is where temporal decay lives.
   - `interestAffinity` = `interestBoost` from existing active interest topic/keyword overlap (unchanged value, correctly named)
   - `retrievalUtility` = 0.5 (neutral baseline for all entries). Not derived from retrieval signals. Deferred to RetrievalTrace in follow-up plan.
   - `associationStrength` = 0.0 (populated by graph augmentation in U5)

3. Composite `librarianScore` = `epistemicConfidence * 0.25 + freshness * 0.25 + keywordDensity * 0.25 + interestAffinity * 0.15 + associationStrength * 0.10`

4. Keep `recencyWeight` and `reliabilityWeight` as deprecated aliases for backward compat. Remove in a follow-up release. The old `reliabilityWeight` (which decayed with age) maps to neither new field — it was the conflation this fix separates.

5. Update `MemoryMatch` to carry the `ConfidenceProfile`. Keep existing `confidence: librarianScore` for backward compat.

6. Update `estimateSufficiency()` to use `epistemicConfidence` for quality thresholds (instead of composite `librarianScore`).

**Execution note:** Pure computation change — no I/O, no new dependencies. The critical invariant is that `epistemicConfidence` does not contain a `daysSince` term. Test this explicitly.

**Patterns to follow:** Existing `ScoredEvidence` interface, `scoreEvidence()` pure-function pattern, `decay.ts` half-life constants.

**Test scenarios:**
- Entry with confidence 0.9, 30 days old, half-life 180d → epistemicConfidence = 0.9 (age does not reduce it), freshness ≈ 0.83
- Entry with confidence 0.5, 200 days old, half-life 60d → epistemicConfidence = 0.5 (still, stale but still what it was), freshness ≈ 0
- Entry matching active interests → interestAffinity > 0
- Entry without interest match → interestAffinity = 0
- Entry with 2 corroborating entries → epistemicConfidence = rawConfidence + 0.10
- Entry with contradiction edge → epistemicConfidence = rawConfidence − 0.10 (floor 0.1)
- retrievalUtility is always 0.5 in this release (independent of any signal)
- Composite librarianScore always in [0, 1]
- Epistemic confidence unchanged when `daysSince` changes
- Freshness unchanged when `rawConfidence` changes
- `estimateSufficiency()` quality thresholds based on `epistemicConfidence`, not composite

**Verification:** `cd cli && npm test` passes. Manual: `flyd ask "test" --verbose` shows the five dimensions in output. Verify an old canon wiki entry retains high epistemic confidence and low freshness.

---

### U3. Fix overlay receipt frontmatter for daemon compatibility

**Goal:** Receipt `.md` files carry `timestamp`, `event_type`, `outcome`, `signal`, and `topics` in frontmatter. Daemon `loadCaptureDocs()` correctly parses overlay receipts.

**Requirements:** R3

**Dependencies:** None (parallelizable with U1/U2)

**Files:**
- `cli/src/memory-persistence.ts` (`persistReceipt()` — add new frontmatter fields)
- `cli/src/memory-receipt.ts` (`MemoryReceipt` — add `eventType`, `derivedSignal`, `topics` fields)
- `cli/src/memory-gate.ts` (`MemoryGateResult` — already has `category` field, expose directly)
- `cli/src/lib/attention.ts` (`daysAgo()` at line 81 — fix `"Z"` double-appending bug)
- `cli/src/__tests__/memory-persistence.test.ts` (new or extend)

**Approach:**

1. Add `eventType`, `derivedSignal`, `topics` to `MemoryReceipt` payload.

2. In `createMemoryReceipt()`, populate `eventType` from gate result category, derive `signal` via mapping function, extract `topics` from intent text. **Do NOT force "flyd-overlay" as a default topic** — empty topic arrays are correct when the receipt's content doesn't match any known attention topics. A forced synthetic topic creates a permanently high-velocity fake signal in the attention engine.

3. In `persistReceipt()`, write new frontmatter alongside existing fields. **Use list syntax for topics, not inline YAML arrays** — Flyd's custom `frontmatter.ts` parser does not support `[inline, arrays]`. The correct format is:
```yaml
timestamp: <generatedAt>  # no trailing Z — attention.ts daysAgo() appends Z during parsing
event_type: <eventType>
outcome: <evidence.outcome>
signal: <derivedSignal>
topics:
  - <extracted_keyword_1>
  - <extracted_keyword_2>
```
Emit timestamps WITHOUT a trailing `Z` until the `daysAgo()` bug is fixed (Item 5 below).

4. Signal derivation function: `explicit_preference`→`preference`, `correction`→`correction_feedback`, `repeated_topic`→`recurring_interest`, `teaching`→`workflow_defined`, `recurring_routine`→`routine_detected`, `confirmation`→`confirmed`, default→`observation`.

5. **Fix `daysAgo()` timestamp parsing bug (prerequisite for correct date handling):** `attention.ts` line 81 appends `"Z"` to dates before parsing: `new Date(date + "Z")`. An ISO timestamp already ending in `Z` becomes `"...Z"Z"` and fails, falling back to 365 days. Fix by checking whether `date` already ends in `Z` before appending, or use `new Date(date)` directly since ISO 8601 strings parse natively. This affects ALL date parsing, not just overlay receipts — existing raw captures with `Z`-terminated timestamps are also affected.

6. Keep existing fields (`id`, `generated_at`, `source`, `category`, `confidence`, `self_contained`) for backward compat — old consumers are unaffected.

**Execution note:** This changes the file format for new receipts. Existing receipts on disk are NOT migrated — they remain invisible to attention as today. Only new receipts from this point forward are compatible.

**Patterns to follow:** Existing `persistReceipt()` frontmatter writing, `extractKeywords()` from `retrieval.ts`, `MemoryGateResult.category` type.

**Test scenarios:**
- Receipt for `explicit_preference` → `event_type: "explicit_preference"`, `signal: "preference"`, `topics` non-empty
- Receipt for `correction` → `event_type: "correction"`, `signal: "correction_feedback"`, `outcome: "succeeded"`
- Receipt for `repeated_topic` → `event_type: "repeated_topic"`, `signal: "recurring_interest"`
- `loadCaptureDocs()` parses new receipt → `CaptureDoc` with non-empty `date`, correct `eventType`, non-null `outcome`, non-null `signal`, non-empty `topics`
- Receipt with no extractable topics → `topics` is empty list (not polluted with synthetic topic)
- `daysAgo("2026-07-28T12:00:00.000Z")` returns correct value, not 365
- Timestamps without trailing Z parse correctly in `daysAgo()`
- Topics are in list syntax (`  - keyword`), not inline arrays
- Receipt for `generic_qa` (shouldRemember=false) → not written (unchanged gate behavior)

**Verification:** `cd cli && npm test` passes. Manual: trigger overlay invocation, check `~/.flyd/raw/overlay/receipt-*.md` frontmatter has new fields alongside old fields. Run daemon attention cycle, verify receipt appears in attention report.

---

### U4. Replace synthesis JSON with loadable markdown format and file-backed belief store

**Goal:** Synthesized beliefs are written as `.md` files (readable by QMD and daemon). BELIEF_STORE/BEHAVIOUR_STORE are loaded from disk on startup. Beliefs survive process restart.

**Requirements:** R4

**Dependencies:** None (parallelizable with U1-U3)

**Files:**
- `cli/src/memory-persistence.ts` (`persistLearnings()` — change format from `.json` to `.md`)
- `cli/src/memory-receipt.ts` (`BELIEF_STORE`, `BEHAVIOUR_STORE` — add `loadLearnings()` function, change from `const` to module-level `let`)
- `cli/src/server.ts` (call `loadLearnings()` during `startCore()`)
- `cli/src/__tests__/memory-persistence.test.ts` (extend)

**Approach:**

1. Replace JSON output with markdown format. Critical frontmatter fields prevent fake corroboration:
```markdown
---
timestamp: <ISO>
source: flyd-overlay-synthesis
event_type: belief_synthesis
outcome: confirmed
promoted: false
epistemic_status: inferred
derived_from:
  - receipt-2026-07-28T12-00-00-000Z-a1b2c3d4.md
---
## Synthesized Beliefs
- **Subject:** response_verbosity, **Predicate:** has_value, **Object:** concise, **Confidence:** 0.85
...
## Synthesized Behaviours
- **Pattern:** response_verbosity, **Response:** concise, **Context:** overlay_invocation, **Confidence:** 0.70
...
```

Without `promoted: false`, QMD retrieval can return both the synthesis file AND its source receipt, and `corroborate()` would count them as independent corroborating evidence (they share significant words by construction). This is fake corroboration — a derived claim artificially reinforcing its own source. `promoted: false` excludes synthesis from corroboration counts (matching existing `brain-retrieval.ts` behavior for unpromoted entries). `epistemic_status: inferred` marks it as derived, not original evidence. `derived_from` records provenance for future tooling.

2. Add `loadLearnings()` function that reads all `synthesis-*.md` files from `~/.flyd/raw/overlay/`, parses the belief/behaviour sections back into `BeliefRecord[]` and `BehaviourRecord[]` using the existing frontmatter parser.

3. On `POST /learnings/synthesize`:
   - Run `synthesizeLearnings()` (existing logic)
   - Persist via updated `persistLearnings()` (`.md` format)
   - Update in-memory arrays (existing behavior)

4. On server startup (in `startCore()`):
   - Call `loadLearnings()` to repopulate arrays
   - Log: `[core] Loaded N beliefs, M behaviours from previous sessions`

5. QMD indexes `**/*.md` — synthesis files are automatically indexed. Daemon `loadCaptureDocs()` reads `.md` files — synthesis files are automatically loaded. No changes needed to QMD or daemon code paths.

**Execution note:** The `.md` format is chosen specifically because QMD indexes `.md` and daemon reads `.md`. This single format change connects both pipelines without modifying QMD or daemon code.

**Patterns to follow:** Existing `persistReceipt()` markdown writing, `frontmatter.parse()` for reading, `synthesizeLearnings()` logic (unchanged).

**Test scenarios:**
- `POST /learnings/synthesize` → `.md` file written (not `.json`)
- Server restart → `GET /learnings` returns previously synthesized beliefs
- QMD search finds synthesis content via standard `**/*.md` indexing
- `loadCaptureDocs()` parses synthesis file → CaptureDoc with `eventType: "belief_synthesis"` and `outcome: "confirmed"`
- Synthesis file has `promoted: false` and `epistemic_status: inferred` in frontmatter
- Synthesis files do NOT participate in `corroborate()` (excluded by `promoted: false`)
- Synthesis file and its source receipt do NOT mutually corroborate each other
- `derived_from` lists the source receipt filenames
- No `.json` files written for synthesis (regression check)
- `loadLearnings()` on clean start (no files) → empty arrays, no error

**Verification:** `cd cli && npm test` passes. Manual: `POST /learnings/synthesize`, kill Core process, restart Core, `GET /learnings/pending` returns previously saved beliefs.

---

### U5. Implement graph neighbor discovery

**Goal:** `augmentWithGraph()` adds wiki entries referenced by graph edges to the candidate set when one endpoint matches a retrieved entry.

**Requirements:** R5

**Dependencies:** None (parallelizable with U1-U4). Requires wiki files to exist as graph neighbors (existing data).

**Files:**
- `cli/src/lib/retrieval.ts` (`augmentWithGraph()` at lines 183-204)
- `cli/src/lib/__tests__/retrieval-graph.test.ts` (extend)

**Approach:**

1. Modify `augmentWithGraph()` to add a discovery phase after the existing boost phase.

2. **Graph node resolution (critical):** Not all graph edges map to wiki file paths. `enrichGraph()` generates body-derived edges where endpoints are extracted entity slugs (e.g., `from = "projects/flyd"`, `to = "dynamic-interface"`) — not wiki file paths. Before attempting neighbor discovery, resolve each edge endpoint through a `GraphNode` resolution step:
```typescript
interface GraphNode {
  id: string;            // entity slug or wiki path fragment
  label: string;         // human-readable label
  wikiPath?: string;     // absolute path to a wiki file, if one exists
}
```
Resolution: check if a wiki file exists at the resolved path (for frontmatter-link edges, the endpoint IS the path). For body-derived edges, look up whether a wiki page exists for the entity slug. Only nodes with `wikiPath` set can produce discovered entries. Nodes without backing pages can still contribute to ranking/boost but cannot become retrieved claims.

3. Discovery phase: for each graph edge, for each existing entry: if entry path matches one endpoint's node → resolve the other endpoint to a `GraphNode` → if `node.wikiPath` exists and is not already in entries → read wiki file at `node.wikiPath` → if score ≥ `MIN_SCORE` (25) → add to candidates.

4. Discovery is 1-hop only. Budget: total entries (original + discovered) capped at `MAX_ENTRIES + 4`. Discovered entries get synthetic scoring via `searchWiki()` logic (keyword density + decay).

5. Gating: env var `FLYD_GRAPHDISCOVERY_ENABLED` (default: `true`). When `false`, discovery phase is skipped entirely.

6. Wiki file reading: add a simple function that reads a wiki file at a path and builds a `BaseEntry` with synthetic scoring.

**Patterns to follow:** Existing `augmentWithGraph()` pure-function pattern, `searchWiki()` synthetic scoring, `MIN_SCORE` threshold.

**Test scenarios:**
- Frontmatter-link edge: `claimA → supports → wiki/claimB.md`. claimA retrieved → claimB discovered and added (wikiPath resolves)
- Body-derived edge: `projects/flyd → relates_to → dynamic-interface`. flyd retrieved → dynamic-interface has no wikiPath → not added (node without backing page)
- Body-derived edge where entity HAS a wiki page → discovered and added
- Graph edge resolved to a wikiPath that doesn't actually exist on disk → silently skipped
- `FLYD_GRAPHDISCOVERY_ENABLED=false` → discovery phase skipped
- No graph edges → only boost phase runs (existing behavior preserved)

**Verification:** `cd cli && npm test` passes. Manual: create wiki entries A and B with a graph link (via consolidate graph rebuild), `flyd ask "topic of A"`, verify B appears in results when graph discovery is enabled. Regression: graph boost still works for existing entries.

---

### Phase B: Preserve structured memory through reasoning

---

### U6. Implement Memory Pack and update resolution prompt

**Goal:** Memory retrieval produces a structured `MemoryPack` instead of `{path, excerpt}[]`. The resolution prompt formats claims with epistemic metadata annotations.

**Requirements:** R6

**Dependencies:** U1 (epistemic statuses available), U2 (confidence dimensions available)

**Files:**
- `cli/src/resolve.ts` (`RetrievedMemory` → `MemoryPack` types, `retrieveMemories()` → `buildMemoryPack()`, `buildResolutionPrompt()`)
- `cli/src/lib/brain-retrieval.ts` (export `RetrievedClaim` construction from `MemoryMatch`)
- `cli/src/__tests__/resolve.test.ts` (extend)

**Approach:**

1. Define `MemoryPack`, `RetrievedClaim`, `ConflictPair`, `KnowledgeGap`, `EvidenceRef` types in `resolve.ts`.

2. Replace `retrieveMemories()` with `buildMemoryPack()`:
   - Call brain retrieval as before
   - Map `MemoryMatch[]` → `RetrievedClaim[]` with all metadata preserved
   - Group contradictory claims into `ConflictPair[]` (matching wiki entries with `status: contradictory` and their graph contradiction edges)
   - Collect `EvidenceRef[]` from source paths
   - `gaps`: empty array for this release (deferred)
   - `current`: populated from hot state (active task, recent corrections — available in the manifest handler)

3. `buildResolutionPrompt()`: Replace the plain-text `memoriesBlock` with formatted claims using epistemic status indicators:
```
RELEVANT MEMORY (from Flyd's knowledge base — use silently, never cite file paths):
- [verified · high confidence] George prefers concise answers.
- [speculative · low confidence] Flyd's deployment may use Cloudflare Pages.
- [contradictory · uncertain] ⚠ Competing claims about interface design:
  a) Flyd uses dynamic cards (questioned)
  b) Flyd uses text-only interaction (working)
  CONFLICT — do not assume either. Ask if critical to this response.
```

4. Preserve personal context bundles injection (unchanged). Preserve memory status fallback (unchanged).

5. Keep backward compat: the `RetrievedMemory` type is removed but consuming code that only needed `excerpt` can access `claim.content`. The prompt is the only consumer.

**Patterns to follow:** Existing `buildResolutionPrompt()` string template, `RetrievedMemory` transformation in `retrieveMemories()`, context bundle injection (unchanged).

**Test scenarios:**
- Wiki entry with `status: canon` → formatted as `[verified · high confidence]`
- Wiki entry with `status: speculative` → formatted as `[speculative · low confidence]`
- Two wiki entries with `status: contradictory` and contradiction graph edge → formatted as conflict pair
- Resolution prompt includes epistemic status annotations and confidence indicators
- Existing regex route/intent classification tests pass (prompt format change doesn't break classification)
- Memory pack is empty when no results found → memory status fallback fires
- Identity questions still trigger personal context bundle injection

**Verification:** `cd cli && npm test` passes. Manual: overlay invocation with a query that triggers memory retrieval, inspect resolution prompt in Core logs (DEBUG level), verify structured memory claims with epistemic annotations.

---

### Phase C: Connect the existing memory systems

---

### U7. Make findNewCapturesSince() discover overlay receipts

**Goal:** Daemon incremental processing discovers overlay receipts. Interest extraction and auto-linking trigger from overlay outcomes.

**Requirements:** R7

**Dependencies:** None (parallelizable with U6)

**Files:**
- `cli/src/lib/linking.ts` (`findNewCapturesSince()` at lines 136-151)

**Approach:**

Add explicit overlay directory scan alongside the existing top-level `raw/` scan:

```typescript
export function findNewCapturesSince(sinceTimestamp: number): string[] {
    if (!existsSync(RAW_DIR)) return [];

    const topLevelFiles = readdirSync(RAW_DIR)
        .filter((f) => f.endsWith(".md"))
        .filter((f) => statSync(join(RAW_DIR, f)).mtimeMs >= sinceTimestamp);

    const overlayDir = join(RAW_DIR, "overlay");
    const overlayFiles = existsSync(overlayDir)
        ? readdirSync(overlayDir)
            .filter((f) => f.endsWith(".md"))
            .filter((f) => statSync(join(overlayDir, f)).mtimeMs >= sinceTimestamp)
            .map((f) => join(overlayDir, f))
        : [];

    return [...topLevelFiles.map(f => join(RAW_DIR, f)), ...overlayFiles].sort();
}
```

This targets the known subdirectory without changing the recursive/non-recursive behavior for other directories under `raw/` (which may have other subdirectories that should remain non-recursive for performance).

**Patterns to follow:** Existing `findNewCapturesSince()` function, `readdirSync` + `statSync` pattern.

**Test scenarios:**
- New overlay receipt written in `raw/overlay/` → `findNewCapturesSince(lastTimestamp)` returns it
- Existing raw captures in top-level `raw/` still returned as before
- No new files → empty array
- `raw/overlay/` directory doesn't exist → no error, empty overlay files list

**Verification:** Manual: trigger an overlay invocation that produces a receipt (`shouldRemember=true`), run daemon incremental scan, verify receipt path appears in the new captures log. Also: `cd cli && npm test` passes.

---

### U8. Operationalize MemoryEdge in Rails belief synthesis

**Goal:** `MemoryEdge` records are created when beliefs are synthesized, reinforced, or contradicted. The `relationship_type` column carries semantic meaning (`derived_from`, `contradicts`).

**Requirements:** R8

**Dependencies:** None (Rails-side, parallelizable with U1-U7)

**Files:**
- `lib/subsystems/belief_engine.rb` (`synthesize()`, `find_or_create_belief()`, `merge_sources!()`, `detect_contradictions()`)
- `app/models/belief.rb` (add `has_many :memory_edges_as_source` and `has_many :memory_edges_as_target` — currently only `Decision` has these associations)
- `app/models/memory_edge.rb` (no changes needed)
- `db/migrate/` (add composite unique index on `[source_type, source_id, target_type, target_id, relationship_type]`)
- `test/lib/subsystems/belief_engine_test.rb` (extend)

**Approach:**

0. **Add missing Belief associations (prerequisite):** The `Belief` model currently has NO MemoryEdge associations — only `Decision` defines them. Add to `app/models/belief.rb`:
```ruby
has_many :memory_edges_as_source, class_name: "MemoryEdge", as: :source, dependent: :destroy
has_many :memory_edges_as_target, class_name: "MemoryEdge", as: :target, dependent: :destroy
```
Without this, U9's `belief.memory_edges_as_target.where(relationship_type: "contradicts").count` will raise `NoMethodError`.

0b. **Add composite unique index (prerequisite):** Currently only an index on `relationship_type` exists. `find_or_create_by!` reduces accidental duplication but doesn't guarantee idempotency under concurrency. Add a migration:
```ruby
add_index :memory_edges, [:source_type, :source_id, :target_type, :target_id, :relationship_type],
  unique: true,
  name: "index_memory_edges_on_source_target_type_uniq"
```

1. In `find_or_create_belief()`: after creating a new belief, create `MemoryEdge` records between each source Decision and the new Belief with `relationship_type: "derived_from"` and `confidence: 0.6`.

2. In `merge_sources!()`: when new decisions are added to an existing belief, create edges from the NEW decisions (not the already-linked ones) with `relationship_type: "derived_from"`.

3. In `detect_contradictions()`: when the LLM detects a contradiction between a new decision and an existing belief, create a `MemoryEdge` with `relationship_type: "contradicts"` and `confidence: 0.8`. The belief is also challenged (existing behavior, unchanged).

4. Use `find_or_create_by!` to prevent duplicate edges for the same source-target pair.

**Execution note:** Test-first. Mock LLM response for `potentially_contradicts?` to control test outcomes. The `find_or_create_by!` pattern with the polymorphic source/target ensures idempotent edge creation.

**Patterns to follow:** Existing `MemoryEdge` model with `cite!`/`decay!`, polymorphic associations on `Decision` and `Belief`, `find_or_create_by!` with block for initial attributes.

**Test scenarios:**
- New belief created from 2 decisions → 2 MemoryEdge records with `relationship_type: "derived_from"`
- Existing belief reinforced with 1 new decision → 1 new MemoryEdge created
- Same decision linked to same belief twice → `find_or_create_by!` prevents duplicate (and composite index enforces at DB level)
- Concurrent edge creation for same source/target/type → composite unique index prevents duplicates
- Decision contradicts existing belief → `contradicts` edge created, belief status → `"challenged"`
- `MemoryEdge#cite!` increments `citation_count` and sets `last_cited_at`
- `MemoryEdge#decay!` multiplies confidence by 0.95 (capped at 0.1)
- `belief.memory_edges_as_target` returns edges where belief is target
- `belief.memory_edges_as_source` returns edges where belief is source

**Verification:** `bin/rails test test/lib/subsystems/belief_engine_test.rb` passes. Manual: create decisions via conversation, run belief synthesis job, verify `MemoryEdge.count` matches expected edges. Verify edges visible in Rails console.

---

### U9. Surface epistemic metadata in WorldStateCompiler

**Goal:** The world state compiled by Rails carries `epistemic_status` and `epistemic_confidence` for each belief and decision, plus `contradiction_count` from MemoryEdge relationships.

**Requirements:** R8

**Dependencies:** U8 (MemoryEdge edges exist to count contradictions from)

**Files:**
- `app/services/flyd/world_state_compiler.rb` (`project_snapshots()` at lines 215-243)
- `app/services/flyd/intelligence.rb` (adjust system prompt to reference new metadata fields)
- `test/services/flyd/world_state_compiler_test.rb` (extend)

**Approach:**

1. Extend belief hash in `project_snapshots()` to include `epistemic_status`, `epistemic_confidence`, `freshness`, and `contradiction_count`. **Critical: `epistemic_confidence` = `belief.confidence` (the stored source-derived confidence, does NOT decay with age). `freshness` = `belief.compute_decay_score` (temporal decay).** These are independent dimensions — a recently-used belief should not become more epistemically true.
```ruby
beliefs: project.beliefs.active.order(updated_at: :desc).limit(MAX_MEMORIES_PER_PROJECT).map do |belief|
  {
    id: belief.id,
    statement: belief.statement.to_s.truncate(500),
    epistemic_status: belief.status,
    epistemic_confidence: belief.confidence,     # source-derived, does NOT decay with age
    freshness: belief.compute_decay_score.round(2),  # temporal decay, distinct from truth
    confidence: belief.confidence,
    status: belief.status,
    source_decision_ids: belief.source_decision_ids,
    contradiction_count: belief.memory_edges_as_target.where(relationship_type: "contradicts").count,
    updated_at: belief.updated_at&.iso8601
  }
end
```

2. Extend decision hash similarly. Decisions always have `epistemic_status: "inferred"` (LLM-extracted). Source confidence is fixed at 0.6 (from extraction). Freshness decays normally.
```ruby
decisions: project.decisions.order(created_at: :desc).limit(MAX_MEMORIES_PER_PROJECT).map do |decision|
  {
    id: decision.id,
    content: decision.content.to_s.truncate(500),
    epistemic_status: "inferred",
    epistemic_confidence: decision.confidence,       # source-derived, does NOT decay
    freshness: decision.compute_decay_score.round(2),  # temporal decay, independent
    confidence: decision.confidence,
    source_message_id: decision.source_message_id,
    contradiction_count: decision.memory_edges_as_source.where(relationship_type: "contradicts").count,
    created_at: decision.created_at&.iso8601
  }
end
```

3. Intelligence system prompt: update to instruct the LLM to weigh `epistemic_status` and `epistemic_confidence` when evaluating belief reliability. `freshness` is a separate signal about currency, not truth. Challenged or superseded beliefs should be treated with lower weight than active beliefs. Contradicted claims should be flagged.

**Patterns to follow:** Existing hash construction in `project_snapshots()`, `Decayable#compute_decay_score` for freshness, polymorphic `memory_edges_as_source`/`memory_edges_as_target` associations.

**Test scenarios:**
- Active belief with confidence 0.5, 30 days old, 90-day half-life → `epistemic_confidence: 0.5` (unchanged by age), `freshness` ≈ 0.79
- Challenged belief → `epistemic_status: "challenged"`
- Superseded belief → `epistemic_status: "superseded"`, excluded from active scope
- Belief with one contradiction edge → `contradiction_count: 1`
- Decision with no contradictions → `contradiction_count: 0`
- Cross-project belief (project_id: nil) included with correct decay (180-day half-life) for freshness, `epistemic_confidence` still from `belief.confidence`
- Decision always has `epistemic_status: "inferred"` (LLM-extracted, not user-confirmed)
- Belief's `epistemic_confidence` does NOT change when `last_used_at` is updated (test: call `reinforce!`, verify `epistemic_confidence` unchanged while `freshness` changes)

**Verification:** `bin/rails test` passes. Manual: create a project with beliefs and decisions, inspect world state JSON in Rails console via `WorldStateCompiler.call`, verify new fields present.

---

### U10. Populate contradictionCount from existing wiki contradiction detection

**Goal:** The `contradictionCount` field on `ScoredEvidence` is populated when the consolidate command detects contradictions between wiki entries. The `conflicting` sufficiency verdict is no longer dead code.

**Requirements:** R9

**Dependencies:** U5 (graph edges exist for contradictions from consolidation)

**Files:**
- `cli/src/lib/librarian.ts` (`corroborate()` or new `countContradictions()` function)
- `cli/src/commands/consolidate.ts` (ensure contradiction detection creates graph edges with `rel_type: "contradicts"`)
- `cli/src/lib/__tests__/librarian.test.ts` (extend)

**Approach:**

1. **Critical ordering fix:** The current consolidate order is: step 6 = contradiction detection (writes markdown report only), step 7 = graph rebuild (wipes edges, rebuilds from wiki metadata). Simply adding edge creation during step 6 would mean `rebuildGraph()` immediately destroys them. Fix:

   **Option A (preferred):** Persist contradictions into wiki metadata before graph rebuild.
   - Step 6: LLM detects contradiction between entries A and B → write `status: contradictory` into B's wiki frontmatter + write a `contradicts` relationship entry into a durable graph input file (e.g., append to a relationship manifest or write into A's frontmatter `links` / `conflicts` field).
   - Step 7: `rebuildGraph()` reads wiki metadata INCLUDING contradiction annotations → `contradicts` edges are part of the canonical graph rebuild.
   - Result: contradiction edges survive any number of rebuilds.

   **Option B (fallback):** Move durable edge insertion to AFTER rebuild.
   - Step 7: `rebuildGraph()` runs normally
   - Step 7b (new): Insert contradiction edges into the just-rebuilt graph
   - Downside: edges are NOT rebuildable — they survive only until the next rebuild. Prefer Option A.

2. In the retrieval pipeline (after graph augmentation, before sufficiency estimation), add a `countContradictions()` step:
   - For each scored entry, look up its path in the graph results
   - If any graph edge with `rel_type: "contradicts"` matches the entry's path, increment `contradictionCount`

3. The existing dead code in `estimateSufficiency()` is now live:
```typescript
const hasContradictions = entries.some((e) => e.contradictionCount > 0);
if (hasContradictions && highQuality.length >= 2) {
  return {
    verdict: "conflicting",
    reason: `${highQuality.length} high-quality entries found but they contain conflicting claims.`,
    coverage,
  };
}
```

**Patterns to follow:** Existing `corroborate()` group-by pattern, `augmentWithGraph()` graph result matching, existing `estimateSufficiency()` switch (already handles `conflicting` verdict).

**Test scenarios:**
- Two wiki entries with contradiction graph edge → both have `contradictionCount >= 1`
- All high-quality entries contradict each other → sufficiency verdict is `"conflicting"`
- No contradictions → `contradictionCount` is 0 (existing behavior preserved)
- One contradicted entry, one confirmed entry, both high-quality → `conflicting` verdict (contradictions present + 2+ high-quality)
- Single contradicted entry alone → `partial` or `insufficient` depending on score (doesn't meet 2+ high-quality threshold)

**Verification:** `cd cli && npm test` passes. Manual: create two contradicting wiki entries, run `flyd consolidate` with contradiction detection enabled, run `flyd ask` for a query matching both, verify `conflicting` sufficiency verdict in verbose output.

---

### Phase D: Establish tests, benchmarks, and documentation

---

### U11. Integration tests and regression suite

**Goal:** End-to-end tests verify each gap is closed. Existing functionality works.

**Requirements:** R9

**Dependencies:** U1-U10 (all prior units)

**Files:**
- `cli/src/__tests__/memory-unification.integration.test.ts` (new file)
- `cli/src/__tests__/overlay-to-daemon.test.ts` (new file)
- Any existing tests that need fixture updates for new frontmatter fields

**Approach:**

Integration test scenarios:

1. **Epistemic integrity E2E:** Create wiki entry with `status: speculative` → call `retrieveBrainEvidence()` → verify `epistemicStatus: "speculative"` in output MemoryMatch.

2. **Confidence separation E2E:** Create wiki entry with known confidence → verify `epistemicConfidence` reflects source confidence, `interestAffinity` reflects interest match, `freshness` reflects age, `retrievalUtility` is neutral (0.5).

3. **Receipt schema E2E:** Simulate overlay outcome → call `memoryGate()` + `createMemoryReceipt()` + `persistReceipt()` → read file → verify `timestamp`, `event_type`, `outcome`, `signal`, `topics` in frontmatter. Then call mock `loadCaptureDocs()` → verify `CaptureDoc` has non-empty fields.

4. **Synthesis persistence E2E:** Call `synthesizeLearnings()` + `persistLearnings()` → simulate restart by clearing module cache and calling `loadLearnings()` → verify beliefs/behaviours loaded.

5. **Graph discovery E2E:** Create wiki entry A linked to B via graph edge → call retrieval for topic of A → verify B appears in results.

6. **Memory pack E2E:** Call `buildMemoryPack()` → verify structured output with `current`, `relevant`, `conflicts`, `gaps`, `sources` keys.

7. **ContradictionCount E2E:** Create two contradicting wiki entries with graph edge → call retrieval → verify `contradictionCount > 0` and sufficiency verdict is `"conflicting"` when both are high-quality.

Regression: all existing tests pass without modification (minor fixture updates for new frontmatter fields in test fixtures are acceptable).

**Test scenarios:** Each E2E scenario above is a test case. Covers all U1-U10 output requirements.

**Verification:** `cd cli && npm test` passes with full coverage on new test files. `bin/rails test` passes.

---

### U12. Documentation update

**Goal:** AGENTS.md, README.md, `cli/CLAUDE.md`, and continuous-intelligence architecture doc updated to reflect the unified memory architecture and resolved gaps.

**Requirements:** R9 (documentation accurately describes behavior)

**Dependencies:** U1-U11

**Files:**
- `AGENTS.md`
- `cli/CLAUDE.md`
- `docs/architecture/continuous-intelligence.md` (update U14-documented gaps with resolved annotations)

**Approach:**

AGENTS.md:
- Replace the three-memory-system description with unified architecture: "Memory: unified pipeline — overlay outcomes feed daemon attention feed brain retrieval feed Rails world state"
- Document `MemoryPack` as the canonical overlay intelligence interface
- Document the five confidence dimensions (epistemic, freshness, interestAffinity, retrievalUtility, associationStrength)
- Update architecture diagram to show unified memory flow

CLAUDE.md:
- Update pipeline diagram to show overlay→daemon connection
- Update Memory schema section: add epistemic status mapping table
- Add key invariant: `epistemicConfidence` never includes a `daysSince` term; `freshness` is the sole temporal dimension
- Document receipt frontmatter fields (old and new)

Continuous-intelligence.md:
- Add "Resolved in 2026-07-28 (Plan 003)" annotations to gaps 1-4:
  1. Receipt schema mismatch → **RESOLVED** (receipts now carry event-semantic frontmatter)
  2. Synthesis JSON → **RESOLVED** (synthesis now writes .md files compatible with QMD + daemon)
  3. BELIEF_STORE volatility → **RESOLVED** (beliefs loaded from disk on startup via loadLearnings)
  4. findNewCapturesSince non-recursive → **RESOLVED** (explicit overlay directory scan added)
- Gap 5 (attention signals → resolver) annotated as **DEFERRED** (tracked in follow-up plan)

---

## System-Wide Impact

### Interaction graph

```
Phase A (parallel, independently shippable):
  U1 (epistemic flattening)  ──┐
  U2 (confidence dimensions) ──┤
  U3 (receipt frontmatter)  ──┤
  U4 (synthesis .md + load) ──┼──→ Phase B:
  U5 (graph discovery)       ──┤      U6 (Memory Pack + prompt)
                                │
                                ├──→ Phase C (parallel to Phase B):
                                │      U7 (findNewCapturesSince)
                                │      U8 (MemoryEdge operational)
                                │      U9 (WorldStateCompiler metadata)
                                │      U10 (contradictionCount)
                                │
                                └──→ Phase D:
                                       U11 (integration tests)
                                       U12 (documentation)
```

### Error propagation

- Graph discovery file-not-found → neighbor silently skipped, no crash
- Frontmatter parse failure on receipt → falls back to existing (empty) fields, logged
- `loadLearnings()` parse failure → empty arrays, log warning: `[core] Failed to load learnings: <error>`
- `MemoryEdge` create failure (unique constraint) → silently handled by `find_or_create_by!`
- QMD index failure → existing fallback chain (BM25 → searchLex)
- Synthesis .md file write failure → logged, in-memory arrays still updated (graceful degradation)

### State lifecycle risks

- `BELIEF_STORE` loaded on startup (U4) — if files are corrupt, arrays remain empty (safe default)
- `loadLearnings()` adds ~10-50ms to Core startup (synthesis files are small KB-range, typically < 10 files)

### Unchanged invariants

- Privacy: no raw audio storage, no screenshot persistence (unchanged)
- Thin-adapter: adapter never decides (unchanged)
- Memory gate: LLM-free regex gating (unchanged)
- Raw captures: immutable (unchanged)
- Wiki file format: frontmatter fields extended, not replaced (unchanged)
- QMD SDK: same `createStore()` + `search()` API (unchanged)
- Rails schema: using existing tables, new data populated into existing columns (unchanged)
- Resolution path: manifest → resolve → outcome pipeline (unchanged)
- Context bundles: separate from Memory Pack, unaffected (unchanged)
- Decay formulas: half-life constants unchanged (unchanged)

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Graph discovery degrades precision@5 | Low | High | Gated behind `FLYD_GRAPHDISCOVERY_ENABLED`. Benchmark test gates shipping. Can disable without redeploy. |
| Receipt format change breaks existing daemon parsing | Low | Medium | New fields are additive. Old fields retained for backward compat. `CaptureDoc` parsing handles missing fields gracefully (existing code already falls through to defaults). |
| Confidence dimension separation changes retrieval ranking unexpectedly | Medium | Medium | Old `librarianScore` formula is preserved as composite with adjusted weights. Integration tests verify ranking doesn't regress for known queries. |
| Epistemic status annotations confuse LLM in resolution prompt | Low | Medium | Prompt includes explicit guidance on how to use each status. Tested with regression suite before shipping U6. |
| Rails MemoryEdge creation adds N+1 query overhead | Low | Low | `find_or_create_by!` is indexed (primary key). One edge per decision-belief pair. Typical synthesis: 2-5 decisions → 2-5 edges. Negligible overhead. |
| `loadLearnings()` on startup adds latency | Low | Low | Synthesis files are KB-range, typically < 10 files. Parsing is < 50ms. |

---

## Sources & References

- `cli/src/lib/brain-retrieval.ts` — retrieval pipeline, epistemic status flattening (lines 123-128), MemoryMatch type (lines 28-47)
- `cli/src/lib/librarian.ts` — scoring (lines 39-85), corroboration (lines 87-109), sufficiency with dead contradiction code (lines 111-160), contradictionCount always 0 (line 83)
- `cli/src/lib/retrieval.ts` — graph augmentation boost-only (lines 183-204), merge (lines 206-227), searchWiki synthetic scoring (lines 128-181)
- `cli/src/lib/decay.ts` — half-life constants (lines 6-16), decayedValue (lines 18-27)
- `cli/src/lib/context-bundles.ts` — context bundle compilation (lines 27-53), 5-bundle structure (lines 5-12)
- `cli/src/lib/attention.ts` — loadCaptureDocs recursive (lines 98-133), CaptureDoc parsing (lines 109-130), computeAttention (lines 135-220)
- `cli/src/lib/linking.ts` — findNewCapturesSince non-recursive (lines 136-151)
- `cli/src/lib/qmd.ts` — QMD SDK wrapper, **/*.md indexing pattern (line 23)
- `cli/src/lib/frontmatter.ts` — YAML parsing for wiki and raw captures (lines 33-141)
- `cli/src/memory-gate.ts` — 7-category classification (lines 47-146), similarity (lines 148-160)
- `cli/src/memory-receipt.ts` — MemoryReceipt type, provisionalLearn (lines 84-125), synthesizeLearnings (lines 140-199), BELIEF_STORE/BEHAVIOUR_STORE in-process arrays (lines 52-54)
- `cli/src/memory-persistence.ts` — persistReceipt frontmatter (lines 25-46), persistLearnings JSON (lines 56-79)
- `cli/src/resolve.ts` — retrieveMemories strips to {path, excerpt} (lines 89-107), buildResolutionPrompt (lines 131-272)
- `cli/src/server.ts` — handleOutcome memory pipeline (lines 218-293), learning endpoints (lines 450-482)
- `cli/src/commands/consolidate.ts` — contradiction detection step 6, graph rebuild
- `lib/subsystems/memory_engine.rb` — decision extraction with LLM
- `lib/subsystems/belief_engine.rb` — belief synthesis, find_or_create_belief (lines 55-66), detect_contradictions (lines 23-29)
- `app/models/belief.rb` — active/challenged/superseded states, source_decision_ids
- `app/models/memory_edge.rb` — cite!/decay! methods, relationship_type column (unused operationally)
- `app/models/concerns/decayable.rb` — compute_decay_score via 2^(-elapsed/half_life), reinforce!
- `app/services/flyd/world_state_compiler.rb` — project_snapshots (lines 215-243)
- `db/schema.rb` — decisions, beliefs, memory_edges tables
- `docs/plans/2026-07-28-002-refactor-architectural-realignment-plan.md` — U14 workstream documenting overlay→daemon gaps
- `docs/solutions/security-issues/overlay-deep-review-auth-bypass-orphaned-tasks-2026-07-23.md` — task handle cancellation pattern
- `docs/solutions/architecture-patterns/flyd-overlay-thin-adapter-typescript-core-2026-07-23.md` — memory gate pattern
- `docs/superpowers/specs/2026-07-16-cli-rails-brain-parity-design.md` — CLI/Rails brain parity design
