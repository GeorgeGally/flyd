# Ambient surface prototypes

These are rough prototypes for ticket [09: the ambient surface](../../tickets/09-ambient-surface.md). They are plain HTML, CSS and JS with no build step and no network, so they work offline. To run them:

```bash
python3 -m http.server 8091   # from this folder, then open http://127.0.0.1:8091/
```

All three share the same five live job lines (`shared.js`). The lines change on their own every few seconds, the way the Claude and ChatGPT mobile apps update their status line. Nothing in any of the three asks George to OK, dismiss or close anything.

The content comes from George's real work on 2026-11-24:
- CapFive board notes 53–58 and the Kinsta deploy
- polybot's backtest and fee numbers, from `data/report_latest.txt` and the README
- the Flyd news fix (#351)
- the ArtAndTech founding charter and v1 homepage copy
- the georgegalanakis pixel-transition demo

Image thumbnails are drawn stand-ins. The quotes, talks, film and polybot figures are real. One news headline in A ("Studios are selling R&D retainers, not campaigns") is made up as a placeholder.

## A. Chat with a content-aware sidebar (`a-sidebar.html`)

Chat on the left. On the right is one sidebar with two parts:

- **Now.** One live line per job: a project name and what is happening right now. Clicking a line opens that project's board (C).
- **For this chat.** Inspirations that follow the conversation: quotes, videos, news, stats, facts and images. When the topic changes, the sidebar says what it is looking for ("Looking for Polymarket, BTC TWAP, backtest…"). It shows shimmer placeholders, then the cards arrive one at a time. Every card has one plain action, **Add to canvas**. **Find more** refreshes the list.

Use the suggestion chips, or type a message that mentions polybot, the pixel transition or the hero, to switch topic and watch the sidebar refill.

On a phone the sidebar collapses to a single live strip under the title. Tapping it opens the sidebar as a sheet.

This copies three things from Posttraction's workspace:
- It waits for the conversation to settle (2s idle there) before it looks.
- It pulls search terms from the current text (stopword keywords for quotes, LLM-extracted terms for media) and shows them.
- One card shell serves every content type.

It leaves out four things that are clunky in Posttraction:
- shuffling away the ranking (`quotes_service.rb:600`)
- separate drawers for every media type
- clicking a card to open research instead of using it
- re-querying external APIs on every 2s edit

## B. Dynamic-island rollover (`b-island.html`)

A calm black pill sits at the top centre over a normal desktop.

- **Resting.** One dot per job and a summary such as "4 moving · 1 ready to look at". The dots breathe while work is moving.
- **Peek.** Only a finish or "ready for your eye" makes the pill widen for about 4 seconds to say which project and what happened. Then it settles again. Routine steps never peek.
- **Hover** (tap on a phone). The pill opens into the live lines. Clicking a line shows that job's recent steps with times, plus **Open its canvas**. Moving the pointer away collapses it.
- **Show a client waiting** demonstrates one of the four interruptions agreed in ticket 03 (a client is waiting, money is at risk, something live is broken, or a creative review is holding work up). The resting pill turns to a red dot and a plain sentence. It holds that state until the situation changes, not until George clicks OK.

## C. Project overview from chat (`c-overview.html`)

Type `/` in the chat to get a project menu. Each entry shows that project's live line.

- **`/flyd`** opens **All projects** as a restrained carousel: cards on a shallow arc with small angles, soft shadows and no glow. Each card shows its live line, the latest artefacts and notes, and counts. You can move through it with the arrows, the keyboard, a swipe or a trackpad. Clicking the front card opens that project.
- **Board** switches the same overview to columns, one per project.
- **`/capfive`** (or any project name) goes straight to that project's board, in three columns: Under way, Notes and Artefacts. On desktop the board tilts a degree or two with the pointer. Esc steps back.

Links from A and B land here through `#capfive`, `#polybot` and so on.

## Why the earlier 3D attempts failed

I found no real 3D in Flyd's history. There is no three.js or WebGL in any branch. These are the attempts I did find:

- **Rails "semantic spatial surface"** (July 2026: `surface_controller.js`, commits 10fae1b1 to e47dffd7). It faked depth with Tailwind blur, opacity and translate classes, so items could "join", "recede" or "leave" according to semantic relationships. It ended when Rails was retired (4dfbadf3). The 2026-10-20 manifestation plan then ruled out "a spatial model" altogether.
- **Lab mock-ups from 2026-10-18** (`lab/minimal-2`, PR #175): a CSS-perspective "spatial depth" room where "distance is time", a voice orb, and an ambient light. None of them was ever built.
- **A notch island with a black sheet** (e0a0d354). It was removed the next day, when George chose Picture desk (4be1c317).

My read of why they failed (an inference; no note records George's reasons): each one started from the visual metaphor (depth, orb, glow, haze) rather than from something to say. None was wired to live job state, so the depth had to stand in for meaning, and what you got was sci-fi that said nothing. Today's dynamic-island notifications have the same flaw in a flat form:
- a spinner with no words ("routing and steps are never news")
- an echoed "Sent"
- reply headlines cut off at 72 characters, with no project name

These prototypes work the other way round. The content comes first: one live line per job, in plain words, always naming the project. Depth is used only where it helps you move through things (the carousel arc, the board's slight tilt), and it is CSS perspective, not a 3D scene.

## Recommendation

Use all three, each for one job:

1. **A is the home surface.** The conversation view gets this sidebar: live lines on top and inspirations that follow the chat. It is the closest match to what George built and liked in Posttraction, and it costs the least. Build it first, wired to real job state from the CoS and to the Evidence Engine plus the Scout news pool for the inspirations. Two limits on that wiring:
   - Content follows the governed-evidence rules: shown as evidence, never written into memory automatically.
   - Lookups happen once the chat settles, not on every keystroke.
2. **B replaces today's dynamic-island notifications** as the Mac presence outside the chat window:
   - At rest it is a quiet pill.
   - It peeks only for a finish or a "ready for your eye".
   - It holds a plain red sentence only for the four interruptions.
   - It never shows a spinner without words, never a "Sent" echo, and never a cut-off headline.

   This answers ticket 11.
3. **C is on demand, through `/flyd` and `/project`.** Make the board the default view, because it scans faster and works on a phone. Keep the carousel as the `/flyd` all-projects entrance only, because that is the one place where flipping between whole projects beats scanning columns. Don't build a three.js scene. The restraint George asked for ("like Jeeves, less sci-fi") holds up with a shallow CSS arc. A real 3D scene would pull the design straight back toward the failure described above.

## Open questions for George

- Should the inspirations follow only the chat, or also the project canvas George has open? Posttraction followed the section being edited.
- What does "Add to canvas" add to: the current project's canvas, or a scratch board?
- When a peek and an interruption arrive together, the interruption wins. Is a red dot and one sentence enough, or should the island also play a sound for the client and money cases?
