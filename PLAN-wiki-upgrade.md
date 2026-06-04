# Plan: flyd Wiki Upgrade (v0.2)

## Summary

flyd captures everything but integrates nothing. Raw captures pile up. The wiki stores identity profiles (skills, education, career) but not knowledge (concepts, topics, insights). There's no browsable, compounding knowledge artifact — just a searchable dump.

This plan adds wiki-based knowledge integration, informed by the Karpathy LLM Wiki pattern, without breaking the existing capture-first, search-first pipeline.

## Design Principles

1. **Capture-first stays first.** Core pipeline unchanged. Auto-capture untouched.
2. **Wiki is additive.** New features enrich `~/.flyd/wiki/`, not `~/.flyd/raw/`.
3. **All LLM calls opt-in.** No automatic LLM calls without user intent or explicit flag.
4. **No breaking changes.** Existing commands keep identical API.
5. **Markdown is the format.** Plain markdown, Obsidian-compatible, git-versionable.
6. **Human in the loop.** LLM proposes wiki changes; human reviews and approves. No blind writes.

## Success Metrics

After each phase ships, the following must be true:

| Phase | Metric |
|-------|--------|
| P0 | `flyd wiki init` creates complete folder structure. `wiki/` has schema, empty index, log |
| P1 | `flyd index` shows all wiki pages with accurate summaries. `flyd log` shows timeline. Empty wiki shows helpful message |
| P2 | `flyd ingest <source>` (file or topic) produces wiki pages visible in `flyd index`. One source creates multiple pages with cross-links and source citations |
| P3 | `flyd check` finds contradictions and true orphans in a populated wiki. Not just counts |
| P4 | `flyd ask "what is X?" --save` creates a wiki page with source citations and provenance marker |

## Rollback Safety

All wiki mutations are reversible:

- **Ingest is dry-run-first.** `flyd ingest <source>` shows proposed changes. `--write` executes. Before `--write`, nothing changes.
- **Ingest state tracking.** On `--write`, a `meta/last-ingest.json` records all created/modified file paths + previous content (for modifications).
- **`flyd wiki revert`** reads `meta/last-ingest.json` and reverts the last ingest: deletes created files, restores modified files from backup. Single-level undo. Explicit command — no automatic reverts.
- **Git integration.** `flyd wiki init` optionally `git init`s the wiki directory. Recommendation: commit before each `flyd ingest --write`. Rollback is then `git checkout .`.

---

## Phase 0: Wiki Bootstrap (trivial risk, blocks everything)

### P0a. `flyd wiki init` — initialize wiki structure

Creates `~/.flyd/wiki/` folder tree: all identity folders (existing + new topics/), plus `meta/`. Optionally initializes git repo.

**File**: `src/commands/wiki.ts` (new, ~40 lines)

**Behavior**:
- Creates all directories from `WIKI_FOLDERS` + `meta/`
- Creates `wiki/schema.md` — wiki conventions for human + LLM
- Creates `wiki/index.md` — empty, with helpful message
- Creates `wiki/log.md` — single creation entry
- Optionally: `git init` in wiki directory
- Idempotent. Safe on existing wiki
- Called automatically by `flyd consolidate` if wiki doesn't exist

### P0b. Schema document (`wiki/schema.md`)

Markdown file documenting wiki conventions. Read by human and LLM. Co-evolves.

Sections: folder structure, frontmatter fields and meanings, page types, link conventions, how LLM interacts with wiki, how to open wiki in Obsidian (File → Open Vault → select `~/.flyd/wiki/`).

Template ships with flyd. User editable.

### P0c. Wiki folder structure expansion

Add to `WIKI_FOLDERS` in `src/lib/wiki.ts`:

```typescript
topic: "topics",  // Merged concept + topic + entity into one
```

Single folder for all knowledge topics. Frontmatter tags for classification. Avoids routing ambiguity between concept/topic/entity.

---

## Phase 1: Wiki Navigation (low risk, high leverage)

### 1a. Shared wiki utilities

Extract into `src/lib/wiki.ts`. Commands become thin wrappers.

| Function | Lines | LLM? | Notes |
|----------|-------|------|-------|
| `generateIndex()` | ~60 | Yes (per new/modified page) | Groups by type. SHA-256 content hash in `meta/index-cache.json`. Hash change → regenerate summary. Empty wiki → helpful message. Only shows non-empty categories |
| `appendLog(entry)` | ~20 | No | `## [timestamp] type | title` to `wiki/log.md`. Includes affected paths |
| `createTopicPage(opts)` | ~30 | No | Template with frontmatter (type, tags, created, updated, source, confidence) |
| `writeWikiPage(path, content)` | ~25 | No | Atomic: write temp, rename. Validate frontmatter parseable |
| `wikiExists()` | ~5 | No | `wiki/index.md` exists |
| `saveIngestState(plan)` | ~30 | No | Writes `meta/last-ingest.json` with created/modified paths + backups |
| `revertLastIngest()` | ~40 | No | Reads `meta/last-ingest.json`, deletes created, restores modified |

### 1b. `flyd index` — generate wiki table of contents

**File**: `src/commands/index-page.ts` (~70 lines)

Wraps `generateIndex()`. Groups by type, sorted by most recent. `--force` ignores cache. Empty wiki: "wiki is empty — use `flyd ingest <source>` to add pages."

### 1c. `flyd log` — chronological record

**File**: `src/commands/log-page.ts` (~50 lines)

Shows last 20 entries. `--full` shows all. grep-friendly format. New entries from: `flyd ingest --write`, `flyd consolidate`, `flyd ask --save`.

### 1d. `flyd consolidate` integration

Add after step 7 (graph rebuild):
- Step 8: regenerate wiki index (`generateIndex()`)
- Step 9: append log entry

Rename step 5 from "reindex" to "reindex QMD (raw)" for clarity.

---

## Phase 2: Deep Ingest (medium risk, highest leverage)

### 2a. `flyd ingest <source>` — structured ingestion

Reads a source, extracts knowledge, integrates into wiki.

**File**: `src/commands/ingest.ts` (~280 lines)

**Two input modes**:

1. **File mode**: `flyd ingest path/to/file.md` — ingests a specific file
2. **Topic mode**: `flyd ingest --topic "llm wiki"` — QMD searches raw captures for topic, ingests matching captures as sources

**Design: dry-run-first.** Shows proposed changes. `--write` executes.

**LLM agent loop** (max 3 iterations). System prompt includes `wiki/schema.md`.

Steps:
1. Read source(s) + `wiki/index.md` + `wiki/schema.md`
2. Extract entities, concepts, claims
3. Discover overlap: compare extracted items against index entries. Read full content of overlapping pages
4. Propose: new pages (path + content + frontmatter) and updates (old → new diff)
5. Detect contradictions against existing wiki
6. Propose cross-links between pages

**Dry-run output** (markdown):
- New pages to create (with content)
- Existing pages to update (with diff)
- Contradictions found
- Cross-links to add
- Pages NOT created (hit --limit)

**With `--write`**: Executes plan via `writeWikiPage()`, saves ingest state, appends log, regenerates index, rebuilds graph.

**Flags**:
- `--topic <topic>` — ingest from QMD search results instead of file
- `--write` — execute (default: dry-run)
- `--model <model>` — LLM model
- `--limit <n>` — max pages to create+update (default: 10). LLM ranks by importance

**Rollback**: `flyd wiki revert` undoes the last `--write`. Restores previous state via `meta/last-ingest.json`.

### 2b. Auto-ingest: DEFERRED to v0.3

Per-capture auto-ingest = 50+ LLM calls per session. Deferred pending cost/quality data.

---

## Phase 3: Check Upgrade (medium risk, medium leverage)

### 3a. `flyd check` — upgrade in place

Keep name `flyd check`. Add `flyd lint` alias. Implementation in `src/commands/lint.ts` (~200 lines). `check.ts` becomes CLI entry.

**Output format**:

```
flyd memory health

1. contradictions (LLM):
   - skills/react vs skills/react-legacy: conflicting claim about hooks pattern
   [or: no contradictions found]

2. stale entries:
   - projects/old-project (45d since confirmed)
   3/12 entries stale (25%)

3. orphan pages (skip if <5 wiki pages):
   - topics/isolated-concept has no inbound links
   [or: all pages have inbound links]

4. missing cross-refs:
   - topics/a and topics/b both mention "flyd" but don't link to each other
   [or: no missing cross-refs]

5. concept gaps (LLM):
   - "qmd" mentioned 12 times across 8 captures, no wiki page
   [or: no concept gaps detected]
```

**Checks** (ordered by value/cost):

| # | Check | LLM? | Threshold |
|---|-------|------|-----------|
| 1 | Contradictions | Yes | Same-type entries, pairwise. wiki-vs-wiki + wiki-vs-recent-raw |
| 2 | Stale entries | No | >30d since confirmed/updated |
| 3 | Orphan pages | No | Zero inbound links. Skip if wiki <5 pages |
| 4 | Missing cross-refs | No | Co-mention entities, no link edge in graph |
| 5 | Concept gaps | Yes | Term appears >=5 times in raw captures, no wiki page |

### 3b. Contradiction detection: uplift from consolidate

Move from `consolidate.ts --contradictions` to shared code called by both `flyd check` and `flyd consolidate`.

---

## Phase 4: Answer Filing (low risk, medium leverage)

### 4a. `flyd ask --save` — file answer to wiki

**File**: Change to `src/commands/ask.ts` (~80 lines)

**Behavior**:
1. Normal `flyd ask` pipeline (QMD → LLM synthesis)
2. LLM proposes: filename slug, wiki folder, summary
3. Writes to `wiki/<folder>/<slug>.md` with frontmatter including:
   - `source: ask-synthesis` — provenance marker (distinguishes from ingested)
   - `confidence: medium` — LLM-synthesized, not from curated source
   - Body includes `## Sources` section listing evidence citations
   - Prominent note: "Generated from Q&A. Verify before citing."
4. Appends log, regenerates index
5. Prints: "filed to wiki/<folder>/<slug>.md"

**Why provenance matters**: LLM-synthesized answers saved as wiki pages risk self-reinforcing errors. Future queries might find the AI-generated answer and treat it as fact. The `source: ask-synthesis` marker lets future LLM queries weight it differently from ingested/curated pages.

**Fallback**: `wiki/topics/<iso-timestamp>.md` if location uncertain.

**Flags**: `--save`, `--save-as <path>`

### 4b. Plugin Q&A filing: DEFERRED to v0.3

---

## Phase 5: Obsidian Compatibility (lowest risk, low leverage)

### 5a. Standardize wiki page frontmatter

All wiki pages use flyd-compatible, Obsidian-friendly frontmatter:

```yaml
type: topic
source: ingest
confidence: high
tags:
  - llm
  - wiki
  - knowledge-management
aliases:
  - llm-wiki
  - karpathy-wiki
created: 2026-06-04
updated: 2026-06-04
links:
  - target: topics/memory-capture
    type: related
    confidence: 0.9
```

List format only (2-space indent, `- ` prefix). Matches `frontmatter.ts` parser. Dataview-compatible.

### 5b. Wiki-links in page bodies

Ingest generates `[[wiki links]]` in bodies for Obsidian graph view. Plain markdown compatible.

### 5c. Schema auto-loading

`readFileSync(join(WIKI_DIR, "schema.md"))` prepended to system prompt for all wiki-writing LLM calls.

---

## Testing Strategy

Follow existing flyd testing conventions (vitest, no globals, temp dirs, mock LLM/QMD/config).

| What | Test file | Approach |
|------|-----------|----------|
| `wikiExists()` | `wiki.test.ts` (extend) | Temp dir, create/delete |
| `writeWikiPage()` atomic write | `wiki.test.ts` (extend) | Write, rename, verify no partial file |
| `generateIndex()` | `wiki.test.ts` (extend) | Mock LLM summary, verify output format, cache invalidation (hash change) |
| `saveIngestState()` / `revertLastIngest()` | `wiki.test.ts` (extend) | Create files, save state, revert, verify restored |
| `appendLog()` | `wiki.test.ts` (extend) | Append entries, verify format, verify append-only |
| `flyd wiki init` | `wiki.test.ts` (new) | Temp FLYD_DIR, verify directory creation, idempotency |
| `flyd index` | `index-page.test.ts` (new) | Mock LLM, mock walkWikiFiles, verify output |
| `flyd log` | `log-page.test.ts` (new) | Mock appendLog, verify display |
| `flyd ingest` (dry-run) | `ingest.test.ts` (new) | Mock LLM returning plan, verify dry-run output |
| `flyd ingest` (write) | `ingest.test.ts` (new) | Mock LLM, mock writeWikiPage, verify files created, state saved |
| `flyd check` upgraded | `check.test.ts` (new) | Test each check with empty/small/populated wiki |
| `flyd ask --save` | `ask.test.ts` (extend) | Mock LLM proposing location, verify file written with provenance |

---

## Implementation Order

| # | Item | Lines | Risk | Depends on |
|---|------|-------|------|------------|
| 0a | `flyd wiki init` + test | 70 | Trivial | — |
| 0b | `wiki/schema.md` template | 30 | Trivial | — |
| 0c | Folder expansion (wiki.ts) | 5 | Trivial | — |
| 1a | Shared wiki utilities + tests | 230 | Low | 0c |
| 1b | `flyd index` + test | 120 | Low | 1a |
| 1c | `flyd log` + test | 100 | Low | 1a |
| 1d | Consolidate integration | 30 | Low | 1b, 1c |
| 2a | `flyd ingest` + tests | 400 | Medium | 1a, 1b, 1c |
| 3a | `flyd check` upgrade + tests | 280 | Medium | 1a, 2a* |
| 3b | Contradiction uplift | 50 | Low | 3a |
| 4a | `flyd ask --save` + tests | 130 | Low | 1a, 1c |
| 5a-c | Obsidian compat (frontmatter, links, schema loading) | 100 | Low | 1a, 2a |

*Check's LLM checks benefit from populated wiki but work on empty wikis too. Not a hard dependency.

**Total**: ~1,545 lines (including tests). 10 files changed. 5 new files. 3 test files extended. 4 new test files.

---

## What Stays Unchanged

`flyd <text>`, `flyd ask` (--save additive), `flyd search`, `flyd compile-context`, `flyd dedup`, `flyd graph`, `flyd setup`, `flyd compound`, `flyd distill`, `flyd research`, `flyd correct`, `flyd plan`, `flyd work`, `flyd optimize-skill`, `flyd interests`. Auto-capture plugin. QMD SDK.

`flyd check` keeps identical CLI interface (output richer, API unchanged). `flyd consolidate` gains index+log steps.

## What Was Cut (with rationale)

| Cut | Pass | Reason |
|-----|------|--------|
| `concepts/` + `entities/` folders | 2 | Fuzzy boundaries → merged to `topics/` with tags |
| Auto-ingest plugin hook | 2 | Cost bomb → v0.3 |
| Plugin Q&A filing | 2 | Depends on auto-ingest → v0.3 |
| "Data gaps" lint check | 2 | High false-positive → cut |
| `flyd check` rename | 2 | Muscle memory → kept, `lint` is alias |
| Three knowledge folders | 2 | Routing ambiguity → single `topics/` |
| QMD indexing wiki pages | 3 | Wiki is browsable (index+Obsidian) + grep-able. QMD for wiki is v0.3 |

## Key Risks (with mitigations, final)

1. **LLM cost**: Single agent loop per ingest, single LLM call per ask --save. Dry-run default. `--limit` cap. No auto-ingest.
2. **Wiki corruption**: Atomic writes (temp+rename). Dry-run preview. Rollback via `flyd wiki revert`. Git recommended.
3. **Index cache staleness**: SHA-256 content hash. Hash change → auto-regenerate. `--force` manual override.
4. **Orphan false positives**: Skip if <5 wiki pages. Graph-based detection only meaningful at scale.
5. **ask --save self-reinforcement**: `source: ask-synthesis` + `confidence: medium` provenance markers. Prominent "verify before citing" note. Future LLM queries weight ask-synthesized pages lower.
6. **Empty wiki UX**: Index shows helpful message. Log shows creation entry. Schema includes Obsidian setup instructions.
7. **Human corrections vs LLM writes**: Dry-run-first means human reviews ALL changes before --write. Manual corrections (via `flyd correct`) are respected because human approves/rejects every proposed change.
