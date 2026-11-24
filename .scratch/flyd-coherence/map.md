# Flyd coherence (wayfinder:map)

## Destination

One buildable spec for the next Flyd: George works with one brilliant, proactive creative partner (Flyd) who keeps him ambiently aware and seeks his guidance as creative director, while a Chief of Staff runs firstmate-shaped teams that move work forward without him. Ready to hand to /to-spec → /to-tickets.

## Notes

- Domain: Flyd (George's personal AI teammate) and its operating model. Vocabulary in GLOSSARY.md at the repo root.
- Every session: call grilling + domain-modeling; read GLOSSARY.md; check George's taste skills (flyd-taste-interface, flyd-taste-spacing) for anything visual.
- Standing preferences: no eyebrows, no side accent lines, short plain copy, visual over text, outcomes over yes/no questions.
- Settled in the charting session (2026-11-24):
  - Chat is the main screen; answers with shape become artefacts shown inline that open into the artefacts workspace; project canvases lay a whole project out.
  - George talks only to Flyd (firstmate stays as a fallback). The problem today is trust: Flyd doesn't tell him fast enough what's happening.
  - Flyd is proactive: does reversible work in his taste unasked, surprises him with work drawn from what he's been doing and thinking (git, his GPT/Claude chats, notes), pushes and inspires him.
  - No "Your calls" list. He gets "what you need to know", visually: outcomes, experiments, decisions made and why, and creative reviews. Things move forward without him; he keeps control; Flyd seeks his guidance as creative director.
  - Flyd talks to the Chief of Staff; the CoS leads the teams and manages firstmate. Flyd supervises the CoS and can "walk through the studio" or "sit in meetings".
  - Starting teams, each firstmate-shaped (lead, workers, backlog, reports to CoS): Engineering (firstmate), Design studio, Research & news desk, Writing, Operations.
  - Evidence: token audit (PC: data/flyd-token-audit/report.md): relays to firstmate are the single largest cost, 15 of 38 failed.

## Decisions so far

- [What Flyd can see of George's work](tickets/01-proactive-signals.md): git + Claude Code sessions, the ArtAndTech/Invention Studio repo and his GPT/Claude chats, Liesel boards as taste votes; studio repo and chat import not yet wired.

## Not yet specified

- The main screen as a whole: how chat, inline artefacts, the ambient layer, creative reviews and project canvases fit on one surface (after the ambient, briefing and canvas tickets).
- How Flyd's taste model and memory feed proactivity and creative review, and how George's corrections flow back.
- Budgets and limits for proactive and team work (tokens, money, how much runs unasked).
- How we judge it worked: "more productive, more creative, collaborating not managing" as something observable.
- Migration: what of today's Flyd (jobs sidebar, decision cards, project threads, crew) is kept, reshaped or deleted.

## Out of scope

- Bad news feed: being fixed separately as a bug (PC second mate).
- Main-chat jumping: fixed separately (append-only chat, 150-exchange window).
- Interface taste polish pass: paused until the main-screen shape is decided.
- Token quick fixes (taste learner own sessions only, project tags from job metadata, light path for short replies, per-job usage): shipped separately, approved 2026-11-24.
