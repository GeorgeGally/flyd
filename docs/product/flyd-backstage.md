# Flyd backstage: chat turns, agenda, council, scout, crew

Reference for the processes behind Flyd's one voice. Product authority: [personal-intelligence PRD](flyd-personal-intelligence-prd.md). Moved out of `AGENTS.md` on 2026-10-25; the code paths named here are the source of truth where this drifts.

## One voice and the chat turn

- George only ever talks to Flyd. Council, Scout, crew and self-improvement are backstage — never label user-facing text (chat, greeting, notifications) with their names.
- Voice comes from `~/.flyd/SOUL.md` (default in `cli/src/lib/soul.ts`).
- Chat has two prompt modes (`buildConversationPrompt`): lean companion mode by default; operator rulebook + repo evidence only for code/work-state turns. Naming a project is not a work turn. Keep companion mode short; small models lose EQ under long rule lists.
- Before every answer Flyd reads the room (`cli/src/runtime/read-the-room.ts`): need, stance, what to avoid, which few knowledge ids matter, and a route (answer/clarify/act/delegate) plus what the reply must cover.
- The harness enforces the route (`cli/src/runtime/turn-plan.ts`: tools in sight, a gate on each call, budget; recorded in the turn receipt). Fix wrong-kind-of-turn failures there, not with another prompt rule — see `docs/solutions/architecture-patterns/turn-plan-routes-in-the-harness-2026-09-28.md`.
- The same ~0.3s Jev call also picks at most one eligible how-to skill (`cli/src/runtime/skills.ts`; SKILL.md files in `~/.flyd/skills`, seeded from `cli/agent/flyd-skills`; `flyd skills import <name>` brings in his Claude/OpenCode ones), whose know-how rides in that turn only. For the design-only skill, see the design team section below.
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

## Design team (`cli/src/command/design-mate.ts`)

- The design team sits beside FirstMate, not under it. `start_design_task` (and any turn read as a design lab) becomes its own run with a folder in `~/.flyd/labs/<id>/`.
- The Creative Director is the team's voice to Flyd: it first answers who views the design, where they will see it, and what they must understand or do (a brief reply missing any answer is asked again once, then the lab stops), and those answers steer every Designer, build, review and the board note; it turns Flyd's brief into 3–5 seeded directions against George's taste, judges each version from its desktop and phone screenshots alone (out of 10, rebuilding under 9, at most 3 rounds), then presents the lab to Flyd with its pick and why.
- Design Mate is the producer: it runs the schedule, the files and the Designers (one per version, each returning a whole HTML page), and never draws. All animation uses GSAP (from cdnjs only); the lab camera jumps every GSAP tween to its end before the shot so the Creative Director never judges a half-faded page.
- George's grid method (`GRID_METHOD` in `design-mate.ts`, distilled from a grid-systems talk he shared) rides in every team prompt with his standing taste, and the Creative Director's version and build reviews run its final check on what they see.
- The team's prompts use `ux-psychology` for design and review, including its dark-pattern guardrails. A valid, non-empty `~/.flyd/skills/ux-psychology/SKILL.md` takes precedence over the bundled copy in `cli/agent/design-skills/ux-psychology/`; `flyd skills import ux-psychology` can copy it from Claude or OpenCode. The skill is excluded from chat, overlay and LIVE routing even when imported.
- Flyd reviews the presentation as George's client: accept, ask for changes (named versions are rebuilt with its notes) or reject (the Creative Director starts the directions again). After 2 send-backs the work goes to George with Flyd's open notes named.
- Every model call (Creative Director, Flyd's review, Designers) is Claude Opus through George's Claude subscription: the `claude` CLI with the API key variables removed and any session reporting a non-plan key source stopped; plain answers load none of his settings or hooks, the build Designer does (`design-claude.ts`). Never the metered `CLAUDE_API_KEY` chain: 88a96085 did that and was reverted the same hour. No other provider stands in; a plan limit or lost login stops the lab at once.
- An accepted lab lands on a Liesel board (`design-board.ts`, `<lab>/board/`): one frame per version at desktop, iPad and phone size, with the Creative Director's words posted beside them. Its card leads with the board link; the client presentation (`index.html`) stays in the folder. Core listens to the board (Liesel's poll) for 21 days: a version marked final is built when the lab has a project (otherwise it waits until a follow-up asks to build it somewhere), pinned notes start another round, both through `designFollowup` (`followup.ts`), once per board message.
- Naming a version in a follow-up ("build V2"), or marking it final on the board, starts a build: a Designer (Claude Code on the subscription) edits George's own copy of the project, the Creative Director reviews the diff against the picked version, Flyd accepts, and Design Mate commits only the files the build changed — never what was already changed.
- Flyd says a lab started only once its model has answered (`startDesignRun`); otherwise it says queued, or that it did not start and why. A hand-off that cannot be taken comes back refused, never thrown. A lab that stops is told to George at once in plain words, unless the failure is over a day old (`scheduler.ts`), not sent back to the team. One runner per lab across processes (`runner.lock`).

## Scout (`flyd scout [show|run|watch|evolve|more N|less N|sources|taste]`, `cli/src/council/scout.ts`)

- Personal news: last30days topics + RSS + subreddits as an evolving source population with fitness; taste, the 8 feeds and 35 subreddits seeded from George's Hermes curator, plus live niche feeds and subreddits for on-chain/generative art, creative coding, AI art, internet archaeology, obscure media, protocol history and odd hardware. Reserve exploration tries niche feeds before general outlets.
- Each edition reads feeds back 30 days, up to 12 subreddits, and 8 last30days searches over Reddit, Hacker News and YouTube (2 at a time, alongside the feeds; empty planner slots reuse topics a replan rested), then ranks up to 200 candidates into 24–30 picks (16–24 under `FLYD_SCOUT_EDITORIAL=legacy`), dropping picks whose reason is a refusal or only repeats the headline. Source health (answered / empty / failed / rate-limited) is kept per run kind, so the news status line reflects the edition, not the 3-hourly watch. A feed that fails gets one more try once the rest is in. Seen links and headlines (case and punctuation ignored) never come back.
- Daily edition, 3-hourly must-know watch, daily evolution (looks for up to 2 new sources from his taste and feedback). Every news-model call gets Scout's opinionated `taste.md` with the Librarian-written `news-interests.txt` (beside MEMORY.md) layered on, never replacing it, plus the preference sections of his USER.md (About me, Work, Preferences, Goals, Learned; `news-interests.ts`), the input Hermes's curator read. People, routines, constraints and MEMORY.md stay out. The edition ranker is opinionated against obvious front-page headlines: general outlets are marked and shortlisted after niche finds (`scout-editorial.ts`), and it never pads to 24 with filler. Engine pinned at `~/.flyd/vendor/last30days-skill`.
- The edition seats a stat, a GIF, a video, an image, a quote and a thread between its ranked stories, never in place of one (`cli/src/council/inspiration.ts`). Terms come from a lexical digest of his open jobs, expanded by one cheap call (or an n-gram fallback) and fetched from HN, Wikimedia, Wikipedia, Wikiquote, plus Giphy, Pexels, Reddit, ZenQuotes, Google Trends, Brave and World Bank / Our World in Data when those need no secret or the key is set (`inspiration-sources.ts`). A shown-log recycles the oldest. No logged-in social search.
- Reddit: `www.reddit.com/r/<sub>/.rss`, sequential, no bot UA.
- Each run that calls the news writer's model is recorded in `scout/run-state.json` (`scout-run.ts`): when, whether it got through, and only the kind of trouble (out of credit, usage limit, refused, unreachable), never the provider's error text. The view's Today reads it to say whether the news is working.

## Crew (`flyd crew [list|dispatch <outcome> [--done <point>]…|show|supervise|land|discard]`, `cli/src/crew/crew.ts`)

- Flyd as first mate: Claude Code crewmates in git worktrees under `~/.flyd/worktrees`, verified with the repo's own checks.
- An independent reviewer then holds the diff to the task's done_when on the agenda tick; its verdict decides, not the test run. A diff found short fails the task with the findings recorded verbatim, and the crewmate gets exactly one re-run with those findings appended to its brief (`MAX_CREW_ATTEMPTS`, kept on the task record so the bound survives restarts).
- Flyd's own self-improvement fixes are managed backstage: once checks pass and the review finds every point met they land themselves (retried each pass, dropped after three days if they can't merge); George hears nothing of them (`FLYD_CREW_AUTO_LAND=0` turns landing off). Everything else waits for George's `/land`.
- A coding hand-off from chat (`start_coding_task`) never waits on an approval. Pushing landed work to GitHub is routine, because George always works on main and keeps `~/Documents` and GitHub in sync, so Flyd never asks about it. Only a deploy step waits for his go-ahead, and the build still starts without it (`ungatedRemainder` in `cli/src/runtime/tool-policy.ts`). A reply that only started the work is told as started, never as finished.
- Tests must never launch a real crewmate (guarded under VITEST).

## Self-improvement (`flyd improve [status|evidence|run|routing-import|routing-audit|routing-evaluate]`)

Daily governed improvement; routing audits sample successful decisions and weekly retest reviewed assumptions, feeding reviewed development failures into the same one-fix-at-a-time loop. Private data, judge/fallback configuration, review commands and shadow rollout: [flyd-routing-learning.md](flyd-routing-learning.md). `FLYD_SELF_IMPROVE=0` disables.
