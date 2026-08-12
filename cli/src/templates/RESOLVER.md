# flyd Resolver

Routing table for memory. When answering a question or doing a task,
consult this first to know WHERE to look.

## Memory domains

| Domain | What lives there | Path |
|--------|-----------------|------|
| identity | Who the user is — name, skills, education, background | wiki/identity/ |
| career | Work history — roles, companies, dates | wiki/career/ |
| projects | What was built — portfolio, campaigns, tech stacks | wiki/projects/ |
| standards | Confirmed domain standards (Skillify writes) | wiki/standards/ |
| constraints | Confirmed constraints / corrections (Skillify writes) | wiki/constraints/ |
| people | Colleague / stakeholder notes | wiki/people/ |
| sessions | Recent session distills — structured notes from each work session | cache/notes/ |
| raw | Raw captures — per-exchange markdown files, the full record | raw/ |
| job-artifacts | Overnight job deliverables (pull-first; not Diagnose memory) | overlay/job-artifacts/ |

## Work Intelligence Ground

Before Diagnose on INVOKED work-intelligence, assemble the Ground pack:

1. Foreground current work (wins on conflict)
2. Domain standard from `wiki/standards/` (fallback: hardcoded domain-standards)
3. Matching session closeout + Present Model (labeled when conflicting)
4. Project wiki page + people pages + colleague preload excerpts

Pending Skillify proposals are **not** Ground context until `skillify_written` and the wiki file exists.

Overnight morning briefing reuses the same assembler with overnight project resolution (`projectId` or fresh Present Model). Artifacts stay in `job-artifacts/` — never auto-injected into Ground pack.

## Routing rules

When the user's question or task matches one of these patterns,
retrieve from the corresponding domain before anything else.

| Pattern | Route to |
|---------|----------|
| "who is", "tell me about yourself", "my background" | identity/ + latest session distill |
| "what did you build", "what have you worked on", "portfolio" | projects/ |
| "timeline", "when did I", "history of", "how long" | career/ + projects/ |
| "why did we", "decision to", "what was the reasoning" | session distills (decisions section first) |
| "how does * work", "architecture of", "patterns in" | session distills (patterns section) |
| "what are we working on", "current status", "next steps" | Ground pack + latest session distill |
| "morning briefing", "overnight job" | overlay/job-artifacts/ via `flyd jobs` (pull-first) |
| "where does * live", "find the file for" | wiki/ or raw/ by topic |
| *anything else* | search raw/ via QMD, fall back to wiki/ |

## Tools

| Tool | What it does |
|------|-------------|
| cache/notes/ | Structured session distills with sections for accomplishments, decisions, files, patterns, open questions |
| wiki/ | Curated facts that persist across sessions. Skillify confirm-writes standards/constraints; crystallize must not blind-write those. |
| raw/ | Full per-exchange capture history. Searchable. |
| search | Semantic search over raw/ via flyd ask or flyd search |
| correct | Write a correction to wiki/ only after user confirms |
| skillify | Propose → confirm durable judgment into wiki/standards or wiki/constraints |
| jobs | Bounded overnight jobs; artifact-first; no PRESENT cognition |

## Rules

- wiki/ entries are the source of truth for facts. Do not contradict them without surfacing the conflict.
- Distill notes (cache/notes/) are observations, not facts. They may be stale or incomplete.
- When routing: if the question matches a pattern above, start with that domain. If not found, expand to raw/ search.
- If information conflicts between domains, surface the conflict. Do not silently prefer one side.
- Foreground outranks Present Model for INVOKED current-state claims.
- Job artifacts are deliverables, not silent memory.
- Overnight jobs never call PRESENT / AttentionEngine / adapter bridges.
