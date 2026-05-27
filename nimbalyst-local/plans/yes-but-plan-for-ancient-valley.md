# Plan: CLAUDE.md for flyd

## Context

No project-level CLAUDE.md exists. Future AI sessions start cold with no understanding of the pipeline, governance model, invariants, or gotchas. The goal is a document that gives an AI enough context to contribute safely without re-deriving the architecture from scratch every session.

"Brilliant" here means: dense with non-obvious facts, skips what's obvious from reading the code, focuses on invariants and gotchas that would burn a session if missed.

---

## What to include

### 1. Project identity (2–3 lines)
Personal governed memory CLI. Not a note-taker — capture is just raw input. Nothing is searchable until it passes dual-reviewer governance (Mom + George). That distinction is the whole point.

### 2. Pipeline (the mental model everything else hangs on)
```
capture  →  raw/          immutable archive
promote  →  host distill  LLM extracts typed candidates → proposed/
         →  governance    Mom + George both vote
         →  wiki/         both accept → promoted (proposed/ file deleted)
         →  rejected.md   both reject (append-only log, proposed/ file deleted)
         →  disputes/     split vote → artifact, principal resolves
compile-context  →  context/  5 bundles for QMD injection
ask      →  QMD search wiki + context → readGate → LLM answer
```

### 3. Governance roles
- **Mom** — protects focus and restraint. Rejects stale, low-provenance, speculative identity inflation. Threshold: confidence ≥ 0.75, status must be `working` or `canon`.
- **George** — protects possibility and emergence. Accepts most well-sourced working memories. Threshold: confidence ≥ 0.6.
- Both must accept for promotion. Split vote → dispute artifact.
- If no API key: deterministic fallback (both run rule-based, not LLM).

### 4. Memory schema
- **Types**: `education`, `career`, `skill`, `award`, `testimonial`, `project`, `preference`, `constraint`, `person`
- **Statuses**: `canon`, `working`, `speculative`, `episodic`, `questioned`, `dormant`, `unresolved`, `contradictory`
- **time_shapes**: `stable`, `current`, `phase-specific`, `episodic`
- **life_phases**: `current`, `past`, `future`
- `source` field MUST contain at least one `raw/` reference — Mom gate rejects without it.

### 5. Runtime file layout (separate from src/)
```
~/.flyd/
├── raw/         immutable captures (never modified after write)
├── proposed/    host candidates (deleted after governance)
├── wiki/        governed truth — subfolders per type
│   ├── skills/, career/, education/, awards/, testimonials/
│   ├── projects/, people/, constraints/, entries/, meta/
│   └── rejected.md  (append-only, not individual files)
├── context/     compiled bundles (current_identity, active_projects, etc.)
├── disputes/    unresolved split votes
└── knowledge-state.json  tracks which raw files have been promoted (by hash)
```

### 6. Key invariants (things that must not regress)
- `proposed/` files are deleted by `promoteToWiki()` and `appendRejectedLog()` — never leave orphans.
- `resolveDispute()` deletes dispute files on resolution.
- `walkWikiFiles()` skips `meta/` subdir, `rejected.md`, `index.md` — don't add files to meta/ expecting them to be walked.
- Context bundles cap at 12 items per bundle (`slice(0, 12)` in compile-context).
- `PERMANENT_IDENTITY_TYPES` (`education`, `skill`, `award`, `testimonial`) — `life_phase: past` does NOT make these dormant. Career/project with `life_phase: past` goes to `dormant_context`.

### 7. frontmatter.ts — custom mini-YAML
Not full YAML. Limitations:
- String values are NOT quoted — don't store values with leading `-` or `|` characters.
- List items must be indented exactly 2 spaces (`  - value`).
- Numbers, booleans parsed automatically.
- Handles colons in values correctly (greedy `(.*)` match) — ISO timestamps and URLs round-trip fine.
- No multiline string values.

### 8. QMD dependency
External binary, not npm. May not be installed. `runAsk()` exits with error if missing.
- Phase 2 (semantic): `qmd query` — may exit 134 (SIGABRT) on Metal GPUs; code catches this specifically, not all errors.
- Phase 1 fallback (BM25): `qmd search` — no models needed.
- Collections must be registered: `qmd collection add ~/.flyd/wiki --name flyd-wiki`

### 9. Development workflow
```bash
npm run dev   # run via tsx (no build)
npm run lint  # tsc --noEmit — run before committing
npm test      # vitest
npm run build # tsc + postbuild.mjs
```

### 10. Key files
| File | Role |
|------|------|
| `src/lib/host.ts` | Host prompt + candidate extraction + validation |
| `src/lib/governor.ts` | Mom/George prompts, verdict parsing, promotion/rejection/dispute logic |
| `src/lib/frontmatter.ts` | Custom YAML-like serializer/parser for all .md files |
| `src/lib/wiki.ts` | `walkWikiFiles()`, `readWikiFile()`, `WIKI_FOLDERS` mapping |
| `src/lib/state.ts` | Hash-based promotion state (prevents re-promoting unchanged raw files) |
| `src/commands/ask.ts` | QMD retrieval, readGate, evidence formatting, LLM answer |
| `src/commands/compile-context.ts` | Bucketing + scoring logic for context bundles |

---

## Output

Write `CLAUDE.md` at project root (not `.claude/CLAUDE.md` — keeps it in repo, visible in PRs).

Structure:
1. One-paragraph project description (what it does and why the governance model exists)
2. Pipeline diagram (ASCII, same as above)
3. Governance roles section
4. Memory schema (types/statuses/shapes in a table)
5. Runtime layout
6. Key invariants (bulleted, terse)
7. frontmatter.ts caveats
8. QMD dependency notes
9. Dev commands
10. Key files table

Tone: dense and technical. No padding. Written for an AI that reads code well but needs non-obvious context fast.

---

## Verification

After writing: read the file back and check:
- Pipeline diagram is accurate
- Invariants match current code (especially proposed/ cleanup and PERMANENT_IDENTITY_TYPES)
- frontmatter limitations are accurate
- QMD exit code 134 note is correct
- No content that's already obvious from reading the source
