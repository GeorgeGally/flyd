# Flyd front page — round 3 brief (read fully)

George rejected round 2 as 0/10: "super bad… where are the artefacts, where are the cards? left and right columns should be cards… how is V4 teenage engineering." Earlier: "we want clean, beautiful, Dieter Rams, yugop. World-class, something that blows people's minds." Treat this as a portfolio piece for the best studio in the world.

## Non-negotiables
- LEFT column = JOB CARDS. Every job is a card (a distinct object with its own surface). Groups: Needs you / Working / Done. A design that needs review is a card led by its IMAGE (big enough to see the design). Click a card → that job becomes the active one in the centre (TV fade).
- RIGHT column = ARTEFACT CARDS, image-led and prominent: finished designs and news, every news item has a real picture now (shared/assets/news-*.jpg), plus one info card. Artefacts are the visual heart of the right side — not a text list.
- CENTRE = control panel for ONE active job only: what it is, state, for design jobs the versions large enough to judge (switchable), one or two actions, this job's conversation, a message box.
- Real content only: ../shared/data.js (window.FLYD = {jobs, artefacts}). Never invent facts or fake replies. CapFive: five versions capfive-v1..v5.jpg, shotLabels have names; Flyd's pick is V2.
- George's taste (read ~/.claude/skills/flyd-taste-interface/SKILL.md, flyd-taste-spacing, flyd-taste-flyd): text animates only by TV fade (no movement/scale on text, no button lift); non-text objects may move; letter-spacing ≤ .04em (no wide tracking — this applies even when a reference uses it); buttons never oversized; body ≥15px; generous deliberate spacing; left-aligned; plain truthful copy; full width; balanced.
- No Inter. No generic SaaS: no pill clutter, no gradients, no glows, no emoji, no icon-in-circle.
- Must work at 1440×900 (everything important above the fold) and at 390 phone width.

## Process (do it, don't skip)
1. LOOK at your reference images with the Read tool before writing any code. Write down in your report 5 specific things you took from them (shapes, type weights, label systems, proportions, colour use).
2. Build. Screenshot at 1440×900. Read the screenshot. Ask honestly: would the reference studio put its name on this? List what's generic and fix it. Repeat at least 3 times.
3. Phone screenshot at 390 (if the browser won't go below 500, say so).
