# flyd — AI context

flyd is a personal memory CLI. Capture writes raw input immediately to `~/.flyd/raw/` and indexes it for search. `ask` and `search` query the raw index directly. No governance gate. Store all, filter at retrieval.

## Pipeline

```
capture          →  raw/          immutable archive, indexed immediately via qmd SDK (flyd-raw)
ask              →  qmd search raw/ → LLM synthesis → answer + evidence
search           →  qmd search raw/ → list entries with scores
check            →  staleness scan + topic gap detection
consolidate      →  dedup + staleness + reindex + graph rebuild
compile-context  →  context/      5 scored bundles from wiki for QMD injection
graph            →  wiki-link graph built from wiki/ (not raw)
```

## Retrieval

`flyd ask` uses the `@tobilu/qmd` SDK (`createStore()`) for hybrid retrieval — not the external CLI binary.

- Phase 1: `store.searchLex()` — BM25 keyword only, no models
- Phase 2: `store.search({ rerank: true })` — semantic + reranking via local GGUF models
- Collection: `flyd-raw` only

## Memory schema

| Field | Allowed values |
| --- | --- |
| `type` | `education`, `career`, `skill`, `award`, `testimonial`, `project`, `preference`, `constraint`, `person` |
| `status` | `canon`, `working`, `speculative`, `episodic`, `questioned`, `dormant`, `unresolved`, `contradictory` |
| `time_shape` | `stable`, `current`, `phase-specific`, `episodic` |
| `life_phase` | `current`, `past`, `future` |

### Epistemic status mapping (wiki status → retrieval boundary)

| Wiki `status` | Epistemic status |
|---|---|
| `canon` | `verified` |
| `working` | `working_assumption` |
| `speculative` | `speculative` |
| `questioned` | `questioned` |
| `unresolved` | `unresolved` |
| `contradictory` | `contradictory` |
| `dormant` | `dormant` |
| `episodic` | `episodic` |

Raw captures → `observation`. Runtime corrections → `user_confirmed`.

### Confidence dimensions

Five independent dimensions on `MemoryMatch.confidenceProfile`:

| Dimension | Meaning | Source |
|---|---|---|
| `epistemicConfidence` | How likely is this claim true? | Source authority + corroboration - contradiction. NO age decay. |
| `freshness` | Is this still current? | `max(0, 1 - daysSince / halfLifeDays)`. Temporal decay lives here. |
| `interestAffinity` | Does this match active interests? | Interest topic/keyword overlap. |
| `retrievalUtility` | Has this helped in similar contexts? | 0.5 neutral — deferred until RetrievalTrace. |
| `associationStrength` | How strong are graph edges? | Max graph edge confidence, 0 if no edges. |

Composite `librarianScore` for ranking: `epistemic * 0.25 + freshness * 0.25 + keywordDensity * 0.25 + interestAffinity * 0.15 + associationStrength * 0.10`

## Runtime layout (`~/.flyd/`)

```
raw/                    immutable capture archive
wiki/
  skills/ career/ education/ awards/ testimonials/
  projects/ people/ constraints/ entries/ meta/
  rejected.md           append-only reject log (not individual files)
context/                current_identity, active_projects, current_constraints,
                        recent_history, dormant_context (max 12 items each)
```

## Key invariants — must not regress

- `walkWikiFiles()` skips `meta/` subdir, `rejected.md`, `index.md`. Files in `meta/` are invisible to retrieval.
- `PERMANENT_IDENTITY_TYPES` (`education`, `skill`, `award`, `testimonial`) — `life_phase: past` does NOT bucket these as dormant. Career/project with `life_phase: past` → `dormant_context`.
- Context bundles hard-cap at 12 items (`slice(0, 12)` in `compile-context.ts`).
- `epistemicConfidence` never includes a `daysSince` term — it derives from source authority + corroboration - contradiction only. `freshness` is the sole temporal dimension.
- `memoryEpistemicStatus()` maps 8 wiki statuses to distinct values (not flattened). A wiki entry with `status: speculative` produces `epistemicStatus: "speculative"`.
- Synthesis files carry `promoted: false` and `epistemic_status: inferred` to prevent fake corroboration with source receipts.

## `frontmatter.ts` — custom mini-YAML, not full YAML

- Values not quoted. Don't store values with leading `-`, `|`, `>` characters.
- List items indented exactly 2 spaces (  `- value`). Different indent = not parsed as list.
- Colons in values are safe — parser uses greedy `(.*)` after first `key:` . ISO timestamps and URLs round-trip correctly.
- No multiline string values in frontmatter. Body goes below the closing `---`.
- Numbers and booleans auto-parsed. `"0"` → `0`, `"true"` → `true`.
- Object list arrays use continuation lines: first key uses `  - key: val`, subsequent keys use `    key: val` (4-space indent).

## QMD dependency

`@tobilu/qmd` npm package via `createStore()` SDK. Not the external CLI binary.

- `store.update({ collections: ["flyd-raw"] })` — updates index from filesystem
- `store.embed({ collection: "flyd-raw" })` — generates vector embeddings
- `store.search({ query, collection, limit, rerank: true })` — hybrid search
- `store.searchLex(query, { collection, limit })` — BM25 fallback

## Dev workflow

```bash
npm run dev    # tsx src/index.ts — no build step
npm run lint   # tsc --noEmit — run before every commit
npm test       # vitest
npm run build  # tsc + scripts/postbuild.mjs
```

## Key files

| File | Role |
| --- | --- |
| `src/lib/frontmatter.ts` | Custom serializer/parser used by all pipeline stages |
| `src/lib/wiki.ts` | `walkWikiFiles()`, `readWikiFile()`, `WIKI_FOLDERS` type→folder map |
| `src/lib/qmd.ts` | SDK wrapper: search, updateRaw, embedRaw, closeStore |
| `src/lib/staleness.ts` | Staleness scoring, gap analysis, stalenessSummary |
| `src/commands/ask.ts` | QMD search, evidence formatting, LLM answer |
| `src/commands/capture.ts` | Write raw + project auto-tag + SDK index |
| `src/commands/check.ts` | Health scan: staleness, gaps, coverage |
| `src/commands/compile-context.ts` | Scoring, bucketing, bundle generation |
| `src/commands/consolidate.ts` | Self-healing: dedup + staleness + contradiction detection |
