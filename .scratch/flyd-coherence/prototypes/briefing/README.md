# Briefing prototypes

These are rough prototypes for ticket [04: what George sees instead of yes/no questions](../../tickets/04-briefing-and-review.md). They follow the answers to [06](../../tickets/06-proactivity-policy.md) and [07](../../tickets/07-cos-contract.md). They are plain HTML, CSS and JS with no build step and no network. To run them:

```bash
python3 -m http.server 8093   # from the prototypes folder, then open http://127.0.0.1:8093/briefing/
```

Serve from `prototypes/`, not from `briefing/`, so the CapFive "See the proof" link can reach `../proof/`.

All three takes render the same content from `data.js` with the same parts from `briefing.js`. The content is placeholder: it is the kind of work named in map.md and the tickets (CapFive, Flyd news, polybot, the portfolio, ArtAndTech, the Research desk). No numbers or wording come from live records.

## What every take shows

- **Done.** Each outcome is one line about what is now different, a short detail line and a small proof thumbnail. Only CapFive's go-live waits for George, because it is client-facing (ticket 06). It says why in a plain sentence and has a **Go live** button.
- **Under way.** For each experiment: what is being tested, a progress bar, what it shows so far and when it reports.
- **Decided, and why.** What was decided, with one line of why. Each decision has **Reverse**, because ticket 06 says decisions stay reversible.
- **Creative review.** Two or three options side by side, with Flyd's pick marked. Under them:
  - *Going with Rise*, plus the why
  - what is already being built on it
  - "Work keeps moving; overrule any time by picking another"

  Picking another option switches the work to it and keeps the original, so **Back to Rise** is always one click away.
- **Next.** What Flyd does next, stated rather than asked.

Nothing asks George to OK, approve or close anything.

## The takes

### A. In the chat (`a-chat.html`)

The briefing is a Flyd message in the main chat, at the point where the work happened. It starts with one summary line, then has Done, Under way, Decided and Next sections in a single inline artefact. The looks arrive as a second message just below.

Picking another option, reversing a decision or pressing Go live gets a short reply from Flyd in the chat, so his changes show up in the same conversation as everything else.

### B. A report per piece of work (`b-report.html`)

Each big piece of work arrives in chat as one card: a cover showing the current pick, a title, one line and counts. **Open report** shows the report over the chat, presentation-style, like the proof slides in ticket 10:

- a headline that states the outcome
- a large stage showing the chosen option (the transition plays)
- Done, The look, Under way, Decided and Next, all scoped to that one piece of work

Changing the pick in the report updates the stage and the chat card's cover. `b-report.html#gg` and `#aat` open a report directly.

### C. Morning and evening digest (`c-digest.html`)

Two editions a day across every project, following the two daily briefs accepted in ticket 03. Each edition has:

- a title and one summary sentence that ends with what, if anything, needs him
- on desktop, two columns: Done as proof tiles with the looks underneath, and Under way, Decided and Today/Tomorrow beside them

Morning covers the night and lists today's plan. Evening covers the day and lists tomorrow's.

## Recommendation

Make **A** the everyday shape. For big pieces of work, send a **B** card in the same chat. Don't build C as a separate surface.

- **A puts the briefing where George already is.** Chat is the main screen, and a briefing is just Flyd talking. When he overrules something, the reply lands in the same conversation, which is the trust signal ticket 03 asks for: he can see Flyd heard him.
- **B fits work that needs to be presented.** Ticket 06 says every big piece of work becomes a report that does not need him. A report reads best as a presentation: one outcome headline and the chosen look large, then the detail. It still arrives as one card in chat, so he does not have to go anywhere new.
- **C works as content but not as a surface.** Its sections are the same as A's, scoped to a time window instead of the moment. A digest page would be another place to check. Post the morning and evening briefs as A messages at 07:30 and 18:30 instead. The two-column tile layout is worth reusing inside a B report when a piece of work has several outcomes.

For Flyd to produce A and B from the shared records in ticket 07, each record needs these fields beyond goal, owner, state and result:

- a one-line point
- the decisions with their whys
- for a creative review: the options, the pick, the why, and what is moving on the pick

## Rough edges

- The proof thumbnails and option previews are drawn stand-ins.
- The ArtAndTech previews are type on a dark card, not the real homepage.
- **Go live**, **Reverse** and the composer only change the page. Nothing is sent anywhere.
- Picks are not remembered between takes or across reloads.
- In C, the summary sentence is written by hand per edition. A real one would be generated from the counts.

Checked headless (chrome-devtools-axi) at 1440×900 and 390×844 for every take, both reports and both editions. There is no horizontal overflow, no clipped text and no overlapping text. The one overlap the script reported was chat text scrolled under the composer, which is out of view.
