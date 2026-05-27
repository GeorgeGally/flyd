# flyd — AI context

flyd is a personal governed memory CLI. Capture is just raw input — nothing is searchable until it clears dual-reviewer governance (Mom + George). The governance layer is the core design; retrieval quality depends entirely on it being enforced correctly.

## Pipeline

```
capture          →  raw/          immutable archive, never modified after write
promote:
  host distill   →  proposed/     LLM extracts typed candidates
  governance     →  Mom + George vote in parallel
  both accept    →  wiki/         promoted; proposed/ file deleted
  both reject    →  wiki/rejected.md  append-only log; proposed/ file deleted
  split vote     →  disputes/     artifact created; principal resolves manually
compile-context  →  context/      5 scored bundles for QMD injection
ask              →  QMD search wiki + context → readGate → LLM answer
```

## Governance

**Mom** — protects focus and restraint. Deterministic threshold: confidence ≥ 0.75, status `working` or `canon`, `source` must include a `raw/` reference. Rejects speculative identity inflation (thin-evidence identity claims), not well-sourced CV facts.

**George** — protects possibility and emergence. Deterministic threshold: confidence ≥ 0.6, `source` must include a `raw/` reference. Accepts most well-sourced working memories.

Both must accept for promotion. Split → dispute. No API key → both fall back to deterministic rule-based verdict (no LLM call).

## Memory schema

| Field | Allowed values |
| --- | --- |
| `type` | `education`, `career`, `skill`, `award`, `testimonial`, `project`, `preference`, `constraint`, `person` |
| `status` | `canon`, `working`, `speculative`, `episodic`, `questioned`, `dormant`, `unresolved`, `contradictory` |
| `time_shape` | `stable`, `current`, `phase-specific`, `episodic` |
| `life_phase` | `current`, `past`, `future` |

`source` array must contain at least one `raw/<filename>` entry — Mom gate hard-rejects without it.

## Runtime layout (`~/.flyd/`)

```
raw/                    immutable capture archive
proposed/               host candidates (deleted after governance — no orphans)
wiki/
  skills/ career/ education/ awards/ testimonials/
  projects/ people/ constraints/ entries/ meta/
  rejected.md           append-only reject log (not individual files)
context/                current_identity, active_projects, current_constraints,
                        recent_history, dormant_context (max 12 items each)
disputes/               split-vote artifacts (deleted on resolve)
knowledge-state.json    hash-based promotion state (prevents re-promoting unchanged raw)
```

## Key invariants — must not regress

- `proposed/` files deleted by `promoteToWiki()` and `appendRejectedLog()`. Never leave orphans.
- `resolveDispute()` deletes dispute file on resolution.
- `walkWikiFiles()` skips `meta/` subdir, `rejected.md`, `index.md`. Files in `meta/` are invisible to retrieval.
- `PERMANENT_IDENTITY_TYPES` (`education`, `skill`, `award`, `testimonial`) — `life_phase: past` does NOT bucket these as dormant. Career/project with `life_phase: past` → `dormant_context`.
- Context bundles hard-cap at 12 items (`slice(0, 12)` in `compile-context.ts`).
- State tracks raw files by hash — re-running promote on unchanged files is a no-op unless `--force`.

## `frontmatter.ts` — custom mini-YAML, not full YAML

- Values not quoted. Don't store values with leading `-`, `|`, `>` characters.
- List items indented exactly 2 spaces (  `- value`). Different indent = not parsed as list.
- Colons in values are safe — parser uses greedy `(.*)` after first `key:` . ISO timestamps and URLs round-trip correctly.
- No multiline string values in frontmatter. Body goes below the closing `---`.
- Numbers and booleans auto-parsed. `"0"` → `0`, `"true"` → `true`.

## QMD dependency

External binary (`qmd`), not npm. `runAsk()` exits with error if missing.

- Phase 2: `qmd query` — semantic search with embeddings + reranking. Exits 134 (SIGABRT) on Metal GPUs at process exit; code catches exit 134 specifically, not all errors. Stdout is valid even when it crashes.
- Phase 1 fallback: `qmd search` — BM25 keyword only, no models.
- Collections must be registered before first use: `qmd collection add ~/.flyd/wiki --name flyd-wiki`

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
| `src/lib/host.ts` | Host LLM prompt, candidate extraction, field validation |
| `src/lib/governor.ts` | Mom/George prompts, verdict parsing, promotion/rejection/dispute writes |
| `src/lib/frontmatter.ts` | Custom serializer/parser used by all pipeline stages |
| `src/lib/wiki.ts` | `walkWikiFiles()`, `readWikiFile()`, `WIKI_FOLDERS` type→folder map |
| `src/lib/state.ts` | Hash-based promotion state, prevents duplicate processing |
| `src/commands/ask.ts` | QMD search, readGate, evidence formatting, LLM answer |
| `src/commands/compile-context.ts` | Scoring, bucketing, bundle generation |
| `src/commands/promote.ts` | Orchestrates host → governance loop, state persistence |
