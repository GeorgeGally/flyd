---
name: flyd
description: Use `/flyd-remember` to capture thoughts, decisions, or information to your personal memory. Everything is stored and instantly searchable — no governance gate. The agent auto-captures important moments. Use whenever the user wants to remember something, capture a decision, or store context. Also handles "install flyd", "set up flyd", "initialize flyd", "init flyd", or deploying flyd to a new project.
---

# Flyd — Photographic Memory

Store everything. Filter at retrieval. No gatekeeping.

**Capture:** `/flyd-remember "text here"` (or the agent auto-captures)
**Ask:** `/flyd-ask "question"` — LLM synthesis from all captures
**Search:** `/flyd-search "query"` — raw retrieval
**Plan:** `/flyd-plan "<topic>"` — structured implementation plan with steps + acceptance criteria
**Work:** `/flyd-work "<topic>"` — show plan as a checklist (`--list` to see all)
**Brainstorm:** `/flyd-brainstorm "<topic>"` — interactive Q&A then plan (use when idea is fuzzy)
**Compound:** `/flyd-compound "<topic>"` — synthesize captures into a learning document (use after completing work)
**Check:** `/flyd-stats` — memory health, gaps, coverage
**Recent:** `/flyd-recent` — last 10 captures

Captures go to `.flyd/raw/` (project-local) or `~/.flyd/raw/` (global) and are auto-indexed for instant search via qmd SDK (BM25 + vector + LLM rerank).

## Installation

When the user says "install flyd", "set up flyd", "initialize flyd", or "deploy flyd" in a project:

1. **Create directory structure**
   ```bash
   mkdir -p .flyd/{raw,cache,wiki,context}
   ```

2. **Install auto-capture plugin** (for OpenCode)
   The plugin source lives at `plugins/flyd-capture.ts` in the flyd repo.
   If the repo isn't the current project, locate it (typically `/Users/radarboy3000/Documents/flyd`).
   ```bash
   cp <repo>/plugins/flyd-capture.ts ~/.config/opencode/plugins/flyd-capture.ts
   ```

3. **Install skills to the project** (so this project has its own skill copy)
   The skills are at `<repo>/.opencode/skills/`. Copy them if not already present:
   ```bash
   mkdir -p .opencode/skills
   cp -r <repo>/.opencode/skills/* .opencode/skills/
   ```

4. **Configure API keys** — run `flyd setup` and paste the `OPENAI_API_KEY` (or set `OPENAI_API_KEY` env var). flyd defaults to `gpt-4o-mini`.

5. **Initialize the search index** — run `flyd consolidate` to build the initial QMD index from any existing captures.

6. **(Re)start the session** so the auto-capture plugin loads and injects memory context on next interaction.

If installing globally (skip project-specific `.flyd/`), steps 1-3 are sufficient — global `~/.flyd/` is auto-created on first capture.

## Proactive: auto-capture

The agent auto-captures significant moments: decisions, bugs found/fixed, things learned, context shared. No need to wait for `/flyd-remember`.

## Proactive: health check

At session start, the agent checks memory health and flags stale topics or thin coverage.
