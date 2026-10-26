# Flyd backstage: chat turns, agenda, council, scout, crew

Reference for the processes behind Flyd's one voice. Product authority: [personal-intelligence PRD](flyd-personal-intelligence-prd.md). Moved out of `AGENTS.md` on 2026-10-25; the code paths named here are the source of truth where this drifts.

## One voice and the chat turn

- George only ever talks to Flyd. Council, Scout, crew and self-improvement are backstage — never label user-facing text (chat, greeting, notifications) with their names.
- Voice comes from `~/.flyd/SOUL.md` (default in `cli/src/lib/soul.ts`).
- Chat has two prompt modes (`buildConversationPrompt`): lean companion mode by default; operator rulebook + repo evidence only for code/work-state turns. Naming a project is not a work turn. Keep companion mode short; small models lose EQ under long rule lists.
- Before every answer Flyd reads the room (`cli/src/runtime/read-the-room.ts`): need, stance, what to avoid, which few knowledge ids matter, and a route (answer/clarify/act/delegate) plus what the reply must cover.
- The harness enforces the route (`cli/src/runtime/turn-plan.ts`: tools in sight, a gate on each call, budget; recorded in the turn receipt). Fix wrong-kind-of-turn failures there, not with another prompt rule — see `docs/solutions/architecture-patterns/turn-plan-routes-in-the-harness-2026-09-28.md`.
- The same ~0.3s Jev call also picks at most one how-to skill (`cli/src/runtime/skills.ts`; SKILL.md files in `~/.flyd/skills`, seeded from `cli/agent/flyd-skills`; `flyd skills import <name>` brings in his Claude/OpenCode ones), whose know-how rides in that turn only.
- The answer sees who George is plus only that selection; backstage findings arrive as private notes it may weave in.
- On a turn that isn't about code the harness keeps code tools and repo shell access out of reach (`offCode` in `turn-plan.ts`).
- In the TUI, a message sent while Flyd is working moves that work to the background; it answers when done.

## Investigator

`cli/src/council/investigator.ts`, `flyd council investigate|backfill`: fills gaps from George's own data — calendar, reminders, captures, past conversations, and his other assistants' memories (Hermes/OpenClaw) — into MEMORY.md, never USER.md.

## Agenda (`flyd agenda [list|add|cancel|inbox|run-due|install]`)

Flyd's proactive agenda: self-scheduled follow-ups/briefings run unattended (Core every 5 min + optional launchd). Results go to the inbox + an island notification via Core `/notify` + the next session's opening briefing.

## Council (`flyd council [status|run [--all]|advisories]`, `cli/src/council/`)

- Librarian curates journal + captures into tiered MEMORY.md/USER.md and closes commitments that finished work shows done (commits in his repos, landed crew work, successful jobs and agenda runs).
- It also keeps George's projects (`~/.flyd/projects.json`, `cli/src/council/projects.ts`): anything he's making, running or owed, with or without code, each linked to its repos. Chat answers project talk from that list.
- Critic (measured) and Strategist advise it, in one call: each advisory is checked six ways (facts, upside, risk, another way, George's likely reaction from his taste rules, order) and kept as one recommendation; the Muse speaks after chat turns when it can help (`/useful`, `/dismiss`).
- Runs on the agenda/Core tick. `FLYD_COUNCIL=0` / `FLYD_MUSE=0` disable.

## Scout (`flyd scout [show|run|watch|evolve|more N|less N|sources|taste]`, `cli/src/council/scout.ts`)

- Personal news: last30days topics + RSS + subreddits as an evolving source population with fitness; taste seeded from George's Hermes curator.
- Daily edition, 3-hourly must-know watch, daily evolution (looks for up to 2 new sources from his profile and memory). Engine pinned at `~/.flyd/vendor/last30days-skill`.
- Reddit: `www.reddit.com/r/<sub>/.rss`, sequential, no bot UA.

## Crew (`flyd crew [list|dispatch <outcome> [--done <point>]…|show|supervise|land|discard]`, `cli/src/crew/crew.ts`)

- Flyd as first mate: OpenCode crewmates in git worktrees under `~/.flyd/worktrees`, verified with the repo's own checks.
- An independent reviewer then holds the diff to the task's done_when on the agenda tick; its verdict decides, not the test run. A diff found short fails the task with the findings recorded verbatim, and the crewmate gets exactly one re-run with those findings appended to its brief (`MAX_CREW_ATTEMPTS`, kept on the task record so the bound survives restarts).
- Flyd's own self-improvement fixes are managed backstage: once checks pass and the review finds every point met they land themselves (retried each pass, dropped after three days if they can't merge); George hears nothing of them (`FLYD_CREW_AUTO_LAND=0` turns landing off). Everything else waits for George's `/land`.
- Tests must never launch a real crewmate (guarded under VITEST).

## Self-improvement (`flyd improve [status|evidence|run|routing-import|routing-audit|routing-evaluate]`)

Daily governed improvement; routing audits sample successful decisions and weekly retest reviewed assumptions, feeding reviewed development failures into the same one-fix-at-a-time loop. Private data, judge/fallback configuration, review commands and shadow rollout: [flyd-routing-learning.md](flyd-routing-learning.md). `FLYD_SELF_IMPROVE=0` disables.
