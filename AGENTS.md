# flyd — agent reference

## Commands

```bash
npm run dev    # tsx src/index.ts — no build step
npm run lint   # tsc --noEmit
npm test       # vitest run
npm run build  # tsc + scripts/postbuild.mjs
```

`npm run lint` before every commit. `npm test` runs the full suite.

## How it works

flyd is **capture-only, search-first**. No governance gate. Everything captured is immediately searchable.

```
capture    →  raw/      raw markdown, auto-tagged with project + timestamp
           →  qmd SDK   update + embed (flyd-raw collection)
ask        →  qmd search → LLM synthesis → answer + evidence
search     →  qmd search → list entries with scores
check      →  staleness scan + topic gap detection
consolidate →  dedup + staleness + reindex + graph rebuild
```

## Auto-capture plugin

`~/.config/opencode/plugins/flyd-capture.ts` — a global OpenCode plugin that auto-captures every conversation exchange without agent involvement.

- **`chat.message` hook**: flushes previous exchange, starts new buffer with user text
- **`event` (`message.part.updated`)**: accumulates assistant text parts (non-synthetic, non-ignored)
- **`event` (`session.idle` / `session.deleted`)**: flushes last exchange
- **`tool.execute.after`**: accumulates tool calls for the current exchange

Captures land in `~/.flyd/raw/` tagged with `source: auto`, project context, session ID, agent name, and timestamp. The agent is freed from the unreliable "capture proactively" prompt — the plugin guarantees every exchange is captured.

Indexing is deferred: run `flyd consolidate` periodically to reindex auto-captured files.

## Non-obvious source quirks

- **`.js` import extensions in `.ts` files** — NodeNext module resolution requires it (e.g. `import "./config.js"` in `./config.ts`). Do not change to `.ts`.
- **Custom frontmatter parser** — `src/lib/frontmatter.ts`. NOT YAML. No multiline values. List items indented exactly 2 spaces. Colons in values are safe. Numbers and booleans auto-parsed. Do not use `js-yaml`.
- **Config module is computed at import time** — `FLYD_DIR`, `RAW_DIR`, `WIKI_DIR` are module-level constants from `homedir()`. Cannot change by setting env after import. Tests **must** use `vi.mock("../../lib/config.js")` to redirect paths.
- **Project detection** — `PROJECT` is detected from `git remote get-url origin` at import time, falling back to `basename(cwd)`. Every capture auto-tags `project` + `project_path` in frontmatter.

## Key pipeline invariants

- `walkWikiFiles()` skips `meta/` subdir, `rejected.md`, `index.md`.
- `PERMANENT_IDENTITY_TYPES` (`education`, `skill`, `award`, `testimonial`): `life_phase: past` does NOT bucket as dormant. Only career/project with `life_phase: past` → `dormant_context`.
- Context bundles hard-cap at 12 items (`.slice(0, 12)` in `compile-context.ts`).
- Governance pipeline (`promote.ts`, `governor.ts`, `disputes.ts`, `host.ts`, `wikilinks.ts`, `state.ts`) has been deleted — no `proposed/` or `disputes/` dirs created anymore.

## `qmd` SDK (not external binary)

- Uses `@tobilu/qmd` npm package via `createStore()` SDK, not `execSync` CLI calls.
- Collection: `flyd-raw` only. No `flyd-wiki` or `flyd-context` collections.
- `updateRaw()` updates index from filesystem. `embedRaw()` generates embeddings.
- Both called after every capture (non-blocking in tests, awaited in production).

## Known bugs / sharp edges

- **`flyd "text"` (default command) does not accept `--model`**: Only `flyd ask --model` does.
- **`flyd dedup` not auto-run**: Separate command, not called by capture pipeline.
- **`logs/` directory never created**: Shown in README storage layout but no command calls `mkdirSync` for it.

## Testing notes

- Vitest 1.x with `vitest.config.ts`. No globals set.
- Config-dependent tests (wiki, capture) must use `vi.mock` + dynamic `await import()` to redirect paths.
- Temp dirs preferred: `writeFileSync` + `rmSync` in `beforeEach`/`afterEach`.
- Test files mirror source: `src/lib/__tests__/*.test.ts`, `src/commands/__tests__/*.test.ts`.
