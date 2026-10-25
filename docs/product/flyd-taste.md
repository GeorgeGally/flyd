# Flyd taste (`flyd taste`)

Reference for George's learned design/code taste. Product authority: [personal-intelligence PRD](flyd-personal-intelligence-prd.md). Moved out of `AGENTS.md` on 2026-10-25; `cli/src/council/taste.ts` and `taste-skills.ts` are the source of truth where this drifts.

## Commands

`flyd taste [show|for <project|path>|learn [--days N]|curate|skills|edit]`

## The taste file

- `~/.flyd/TASTE.md` — George's to edit.
- `## Not me` = vetoed, never relearned.
- `## Retired` = generic truisms the Librarian dropped, kept for provenance, never injected.

## Learning

- Source: each correction/rejection/approval in George's own Claude Code turns (`~/.claude/projects`). Crewmate/worktree sessions and agent briefs are skipped; never tool output, pasted code or assistant words.
- Each becomes a rule with its quote, project and date. A rule is only learned when it is a reusable preference (a one-off like "make this button blue" is not).
- Repeats strengthen; a project rule seen in a second project moves to Everywhere; a rule seen once is kept but not told to agents until repeated.
- Learned on the Core tick (7-day backfill, 3 model calls/tick). `FLYD_TASTE_LEARNING=0` turns it off.

## Curation (Librarian pass; `curate` runs it now)

- Folds near-duplicates.
- Promotes only on the same idea cited from another project, or a George-wide principle it expresses.
- Places each rule in a skill (interface/spacing/none) and moves one project's rules to that project.
- Conservatively retires generic rules.

## Who reads it

- Crew briefs, and — on code/design/work turns only — the compiled context.
- Other agents run `flyd taste for <repo>` before design or code work.
- Every agent gets it as generated `flyd-taste-*` skills (interface, spacing, one per project scoped to its repo) in `~/.claude/skills` and `~/.agents/skills`, rebuilt after each learning/curation pass or taste-page edit (`cli/src/council/taste-skills.ts`; principles seeded from his words in `taste-principles.ts`). `FLYD_TASTE_SKILLS=0` turns them off.
- The conversation view's header links to `/taste`.
