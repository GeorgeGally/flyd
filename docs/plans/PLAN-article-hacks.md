# Plan: Apply Compound Engineering + Agentic Hacks to flyd

## Problem
flyd is a capture-only, search-first memory system. It has no planning command, no multi-source research, no brainstorm workflow, and no plan-as-checkpoint pattern. The Compound Engineering plugin reveals a battle-tested architecture for plan-first development that flyd can adapt as a standalone CLI.

## Approach
Add 3 new core commands and enhance 2 existing ones, modeled after CE's architecture but adapted for flyd's independent-CLI nature. The core loop becomes: **capture → brainstorm → plan → work → compound**.

Each command stores its output as a typed capture in `~/.flyd/raw/` for instant searchability. Plans additionally live in `~/.flyd/plans/` as first-class artifacts.

## Files to touch

### New files
- `src/commands/plan.ts` — structured planning command (modeled after `/ce-plan`)
- `src/commands/work.ts` — plan execution tracker (modeled after `/ce-work`)
- `src/commands/brainstorm.ts` — interactive Q&A requirements doc (modeled after `/ce-brainstorm`)
- `src/commands/compound.ts` — document learnings to compound knowledge (modeled after `/ce-compound`)
- `src/lib/web-research.ts` — multi-source web research module
- `src/lib/plan-utils.ts` — plan file utilities (scoring, sequencing, U-ID management)
- `src/commands/__tests__/plan.test.ts`
- `src/commands/__tests__/work.test.ts`
- `src/commands/__tests__/brainstorm.test.ts`
- `src/commands/__tests__/compound.test.ts`

### Modified files
- `src/index.ts` — register new commands
- `src/commands/research.ts` — add `--web` flag for multi-source research
- `src/lib/config.ts` — add PLANS_DIR
- `.opencode/skills/flyd/SKILL.md` — add new commands to skill doc

## CE-Inspired Architecture

```
flyd brainstorm <topic>     → interactive Q&A → requirements doc → ~/.flyd/raw/ + ~/.flyd/plans/
flyd plan <topic>           → parallel research → structured plan.md → ~/.flyd/plans/ + ~/.flyd/raw/
flyd work <plan-id>         → read plan → print checklist → track progress
flyd compound <topic>       → LLM synthesis → learning doc → ~/.flyd/raw/
flyd research --web <topic> → multi-source search (Reddit, X, HN, GitHub) → structured research
```

Plan depth classification (from CE):
- **Lightweight**: small, well-bounded, low ambiguity → 2-4 implementation units
- **Standard**: normal feature with some decisions → 3-6 units, full template
- **Deep**: cross-cutting, strategic, high-risk → full template + risks + deferred

## Acceptance Criteria

### 1. `flyd brainstorm <topic>`
- [ ] Interactive Q&A: asks 2-5 questions about problem, users, value, scope
- [ ] Produces requirements doc in `~/.flyd/plans/` with frontmatter (type: brainstorm, status, topic)
- [ ] Requirements doc includes: problem frame, actors, key flows, scope boundaries, success criteria, open questions
- [ ] Also stored as capture in `~/.flyd/raw/` for searchability
- [ ] Re-indexes after creation
- [ ] Tests: creates requirements doc, doc is searchable via `flyd search`

### 2. `flyd plan <topic>`
- [ ] Searches memory via QMD for relevant context (parallel with research)
- [ ] Classifies plan depth (Lightweight/Standard/Deep) based on scope
- [ ] Optionally does multi-source web research (`--research` flag, parallel dispatch)
- [ ] Produces structured plan.md in `~/.flyd/plans/` with frontmatter (type: plan, status, depth)
- [ ] Plan includes: problem statement, approach, implementation units (U1, U2...), test scenarios per unit, acceptance criteria (checkboxes), risks, dependencies
- [ ] Implementation units use stable U-IDs (never renumbered)
- [ ] Each unit has: Goal, Files (repo-relative), Approach, Test scenarios (happy path/edge cases/error paths), Verification
- [ ] Also stored as capture in `~/.flyd/raw/` for searchability
- [ ] Re-indexes after creation
- [ ] Tests: creates plan, plan is searchable, units have stable IDs

### 3. `flyd work <plan-id>`
- [ ] Reads plan from `~/.flyd/plans/<plan-id>.md`
- [ ] Prints implementation units as checklist with acceptance criteria
- [ ] Optionally tracks progress with `--track` flag (appends status updates)
- [ ] Optionally resumes from last incomplete unit with `--resume`
- [ ] Verifies plan has all required sections before starting
- [ ] Tests: reads plan, prints criteria, resume picks correct unit

### 4. `flyd compound <topic>`
- [ ] Searches memory for all captures related to topic
- [ ] Produces structured learning document with: problem, solution, patterns, rationale, key files
- [ ] Stores as capture in `~/.flyd/raw/` with type: compound
- [ ] Re-indexes after creation
- [ ] Tests: creates learning doc, doc contains expected sections

### 5. Enhanced `flyd research --web <topic>`
- [ ] Multi-source search (Reddit, X, HN, GitHub) using web search API or scraping
- [ ] Synthesizes findings into structured research format (same as current but with sources)
- [ ] Falls back gracefully if no web search key configured
- [ ] Tests: mock web search, verify structured output with source attribution

### 6. Config additions
- [ ] PLANS_DIR = join(FLYD_DIR, "plans")
- [ ] mkdirSync(PLANS_DIR) in plan/brainstorm commands

## Patterns to follow
- `.js` extensions on imports (NodeNext)
- Custom frontmatter serializer from `src/lib/frontmatter.ts`
- QMD SDK from `src/lib/qmd.ts` for search + indexing
- Config constants from `src/lib/config.ts`
- LLM from `src/lib/llm.ts` query() for synthesis, agentLoop() for interactive Q&A
- Tests use vi.mock for config paths + temp dirs in beforeEach/afterEach

## Out of scope (for now)
- Voice capture command (requires Whisper API)
- Email-to-capture bridge (external dependency)
- Sound hooks for command completion (platform-specific)
- Remote control / mobile app integration
- Subagent dispatch for parallel plan execution (requires OpenCode subagent API — CE has 50+ agents, flyd doesn't have that substrate)
- Full brainstorm -> plan -> work pipeline automation (that's what the OpenCode skills wrapping these commands do)
