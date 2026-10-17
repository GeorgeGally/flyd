// Real firstmate replies the captain pointed at (2026-10-07), kept verbatim
// as regression fixtures for summaries and the island headline.

/** Important, but too long: three outcomes that a summary must all keep. */
export const ABOUT_FIXES = `Captain, all three About fixes for phones are committed and pushed to GitHub.

1. **Why CapFive cards:** I reverted the azure. They're now a slightly lifted navy with a fine light-blue edge and a soft shadow. The headings are light blue again and the text soft white, so the cards stand clear of the rings without clashing.
2. **Leadership:**
   - The eyebrow is in the normal site style: "Leadership from across the network." instead of every word capitalised.
   - The long "CapFive is guided by…" sentence was being forced into giant headline type. It's now a bold 22px lead with its blue phrases.
   - I removed the three separate size and margin overrides you pasted.
3. **Board pop-up on short phones:** the photo is shorter, full width and framed on the face. On iPhone SE the name, role, firm and the first six lines of the bio now show without scrolling. Before, the bio was cut off after two lines.`;

/** The deliverable is the rules to paste; folding them behind "more" hid them ("what rules bro"). */
export const KINSTA_RULES = `Captain, Kinsta won't accept \`#\`. I've cut the list to four rules with no \`#\` and checked every target address on the live CapFive site.

The four old service pages need no rules of their own: the same addresses already work on CapFive. Old Leadership uses CapFive's \`/leadership/\` address, which jumps to the right part of About. Old Contact is caught by the last rule and lands on the CapFive Contact page.

Set each to 301 and All domains:

\`\`\`
1. From: ^/about-aica/?$
   To:   https://capfive.com/about/

2. From: ^/about-aica/aica-leadership/?$
   To:   https://capfive.com/leadership/

3. From: ^/members-and-firms/?$
   To:   https://capfive.com/professionals/

4. From: ^/(?!transaica|login|wp/|wp-|app/|index\\.php|xmlrpc\\.php|\\.well-known|about-aica/?$|about-aica/aica-leadership|members-and-firms)(.*)$
   To:   https://capfive.com/$1
\`\`\`

Put rule 4 into the existing \`^(.*)$\` rule rather than adding it alongside. Then clear the Kinsta cache. If Kinsta rejects rule 4 as well, paste me the error.`;

/** The same deliverable as a table, with the instruction in prose. */
export const KINSTA_TABLE = `Captain, Kinsta works better than the plugin: the rules apply before WordPress runs, so the cache doesn't get in the way. Each address matches exactly one rule, so the order doesn't matter. Add these in the dialog you showed, as 301 on All domains:

| # | Redirect from | Redirect to |
|---|---|---|
| 1 | \`^/about-aica/?$\` | \`https://capfive.com/about/\` |
| 2 | \`^/members-and-firms/?$\` | \`https://capfive.com/professionals/\` |

After saving, clear the cache in Kinsta.`;

// Real firstmate status replies (2026-10-10) that showed him lists of PR URLs:
// "flyd shouldn't show me github pulls/stubs whatever. this is not an executive conversation".

/** Several pieces of work, grouped by state under bold labels, with prose around them. */
export const WHERE_EVERYTHING_STANDS = `Captain, here's where everything stands.

**Flyd (merged):**
- https://github.com/GeorgeGally/flyd/pull/83: the Librarian curating taste.
- https://github.com/GeorgeGally/flyd/pull/84: the going-silent fix.
- https://github.com/GeorgeGally/flyd/pull/86: drag-and-drop for documents.

I've saved "merge green Flyd work without asking" in Flyd and in my preferences.

**Flyd (still going):**
- https://github.com/GeorgeGally/flyd/pull/85, the chatter fix, clashed with what just landed, so it's being updated and will merge when green.
- A worker is bringing the island redesign, https://github.com/GeorgeGally/flyd/pull/68, up to date so it can merge too.

**Why Flyd seemed not to respond:** Flyd itself is fine. Your last five notes from its window had piled up on my side unanswered. They're all handled now.

**Reinstall blocked on one decision.** Your local Flyd copy has one uncommitted change: the mode toggle reads "flyd" instead of "summary". My safety rules won't let me overwrite it without your word. I've asked the header redesign worker to carry that wording into its PR, so nothing is lost. Say "drop the local edit" and I'll update the local copy, reinstall, and you can quit Flyd with Cmd+Q and reopen it.

**Your website changes** are only in the Good Neighbours preview at http://127.0.0.1:8097/ and in https://github.com/GeorgeGally/good-neighbours/pull/3. That PR targets the Christmas branch, which is itself an unmerged draft (https://github.com/GeorgeGally/good-neighbours/pull/1). So nothing has reached the live site yet, and nothing should until you're happy with it. Apply Now downloads instead of opening because that preview is a plain file server that can't run the PHP application pages. The worker is switching it to a PHP preview with its own local test database, never the production one.

**Notes sent to the worker for the current site:**
- the hat tilted to -20°,
- buttons stay square,
- small text made bigger and higher-contrast,
- Roboto for all body text.

**The Christmas design lab** has your holly artwork and will use it prominently in at least two of its four directions.`;

/** A numbered list of PRs that need his word, with the ask in the lead-in. */
export const FOUR_READY = `Captain, the island redesign is finished but was never merged. Our records wrongly marked it as landed, and I've corrected that.

The redesign is https://github.com/GeorgeGally/flyd/pull/68: a bigger, more readable, redesigned notch island. It's open with all five checks passing, but it has sat unmerged since before your switch, which is why your island still looks the same. What did land was the live-status piece, so the island shows the conversation's status. An older attempt to stop firstmate chatter appearing on the island, https://github.com/GeorgeGally/flyd/pull/70, has been replaced by the new chatter fix, https://github.com/GeorgeGally/flyd/pull/85, which covers both the window and the island.

That makes four Flyd PRs ready to merge:
1. https://github.com/GeorgeGally/flyd/pull/68, the island redesign.
2. https://github.com/GeorgeGally/flyd/pull/83, the Librarian curating taste.
3. https://github.com/GeorgeGally/flyd/pull/84, the going-silent fix.
4. https://github.com/GeorgeGally/flyd/pull/85, the chatter fix.

PR 68 is older than the others, so it may need a quick update onto the latest code before it merges. I'll handle that. Say "merge them" and I'll land all four, close PR 70 as replaced, and reinstall Flyd so you can see it.`;

/** Bare PR URLs only, under "Still waiting on your ... for:". */
export const STILL_WAITING = `Captain, one quick ruling on the artefact redesign. The review found that a single failed call to the model would leave Flyd showing raw task titles again until Flyd restarted, which is exactly what you complained about. Now failed items retry a few minutes later. It's back in its checks.

Also, the CapFive Lab artwork worker restored its preview and is waiting for you at http://localhost:8093/lab/?fresh=1. The Christmas design lab is underway, and the taste skills work is in its final review round.

Still waiting on your "merge them" for:
1. https://github.com/GeorgeGally/flyd/pull/83
2. https://github.com/GeorgeGally/flyd/pull/84
3. https://github.com/GeorgeGally/flyd/pull/85`;

/** One PR named by number and URL, mid-sentence. */
export const CORRECTION = "Correction, my earlier answer was wrong: the dictation-learning work already landed. It shipped as PR 58 (https://github.com/GeorgeGally/flyd/pull/58), merged Oct 6, and it is in your local Flyd copy. The old draft PR 55 was superseded and is still open. Nothing to restart.";

// Firstmate's report on the notes it missed, ending on a question it wanted his yes to (12 Oct 2026).
export const MISSED_NOTES = `Captain, your missed notes were a real failure, so here's what happened and the fix. All 14 notes are now handled, and the site changes from them are live on https://christmas.goodneighboursmarket.com and on your local site.

**What failed:** at 09:56 a background helper took over passing your Flyd notes to me. It queued every note from 09:58 onwards but never handed any of them on. It kept reporting itself healthy, so my end-of-turn check trusted it and let me carry on without the notes. I wasn't ignoring them; I never saw them. The monitoring that should have caught it is still the same one, so this could happen again until fix 2 below is in.

**How to stop it happening again:**
1. **Flyd shows whether each note was read (started):** each note will show "sent", then "read by firstmate". If one is still unread after 3 minutes, Flyd warns you, so you'd have known within minutes. A worker is building this now.
2. **Firstmate checks the notes queue itself (needs your go):** before I finish any turn, I'd look at the notes queue directly and refuse to stop while a note is more than a minute old and unread, whatever the background helper says. This changes Firstmate's shared code, so I want your yes first.

**Site changes from your notes:**
- **Buttons on phones:**
  - Pairs sit side by side at equal width, filling the column. This covers Attend / Bring your brand and Get directions / Site map.
  - The three Venue buttons are now "Get tickets" full width, with the other two side by side underneath.
  - The down arrows are gone from "Site map" and "About Nuanu".
- **Rates:** regular prices are struck through in red at full size.
- **Phone menu:** links are larger, in sentence case ("Welcome", "Brands"), with tight spacing. The yellow Instagram box is replaced by a simple Instagram icon and underlined handle under a small "Follow us".

The screenshots are open in Preview.

**Flyd:** a second worker is building your four Flyd asks:
- Taste, Full and Light move into a Preferences tab.
- Memory cards are redesigned and shown in the stream where they happened.
- Prompts on the same topic are grouped in the sidebar.
- The page being worked on stays visible at all times.

I'll merge each one when it passes its checks and tell you.

**Working in ~/Documents:** from now on I always work directly in ~/Documents. I've recorded this as a standing rule and replaced the older note that said not to put work live.

Should I go ahead with fix 2?`;

/** A site change (2026-10-12) whose aside, "Applications stay closed there…", became the artefact's headline. Its last bullet,
 * about an admin page on the public site, is left out of this public repo. */
export const MOBILE_DEPLOY = `Captain, I pulled the mobile changes, tested them, and deployed to https://christmas.goodneighboursmarket.com along with your fixes below. Applications stay closed there; the deploy only opens them if asked.

**Testing:** all five pages open at true phone size with no sideways scroll, and nothing errors in the browser. Four automated homepage checks fail, but they failed the same way before this pull: they still describe the old homepage. The phone and desktop screenshots are open in Preview.

**Your fixes, all live:**
- **Snow on the Date page:** flakes now land all over the floor, from just behind the bunny to the bottom of the screen. Nearer flakes are bigger, and they lie as flat drifts that don't block snow falling in front or behind.
- **Letter-spacing:** I tightened the early-bird caption, and every other widely spaced label on the site, to near-normal. I saved this as a lasting preference in Flyd and in my notes.
- **"Make Christmas your own." on phones:** two problems fixed.
  - The page kept snapping back to its top, so you could never reach the bottom of it.
  - Swipes that started on the rates table were ignored.

  Now an up or down swipe on the table moves between pages, and left/right still scrolls the table.
- **Tilt snow:** the button is gone. On iPhone, tilt snow now asks for motion access on your first tap anywhere, because iPhones only allow that request after a tap. Other phones get it straight away with no prompt.
- **Follow us in the phone menu:** the Instagram handle is now a large gold button under a larger, clearer label.

**Two things to know:**
- **Phone dead end:** the other session hid the footer screen on phones on purpose. That left the rates page with nowhere to go. My best guess was that swiping on from it should carry round to the Welcome page, and that's what it does now. Desktop still goes to the footer. If you'd rather phones show the footer, say so.`;

/** Ends on two open questions: tapping one of them, read as an answer, sent it to firstmate (2026-10-12). */
export const OPEN_QUESTIONS = `Captain, both fixes are live on christmas.goodneighboursmarket.com. Phone screenshots are open in Preview.

**Admin on phones** (the "mobile version needs work" note):
- **Header:** smaller, and it now scrolls away instead of staying pinned at the top.
- **Desktop:** the table layout is unchanged.

In the Flyd preview you sent, the phone picture of the admin was cut off on its left edge. If you also meant that Flyd preview, tell me and I'll send it to a worker.

Still waiting on you:
- whether to discard the old CapFive experiment branches (shader lab, truchet lab, deals pagination)
- whether Flyd's sidebar should show newest at the top again`;

/**
 * Firstmate's 03:20 reply on 2026-10-17 that Flyd relayed to him as "needs you /
 * under way / landed": the push question read as under way ("the running
 * Flyd"), and the plan read as landed (a quoted "Merged deployed."). Both
 * questions were Flyd's to answer.
 */
export const TWO_THINGS_WAITING = `Captain, the notification clean-up kept producing broken sentences: every fix to the word-swapping created new garbled ones, like "Merged deployed." So I've changed the approach instead of patching it a fourth time:
- **Fix the messages where Flyd writes them.** The "notes waiting" warning will be worded properly from the start: "2 notes you sent are still waiting; the oldest has waited 57 min."
- **Check everything else at the end.** If a notification still names an internal helper, the whole thing is replaced with a plain line that keeps the numbers. No more cutting words out of the middle of sentences.

Its checks are running again.

Two things are waiting on you:
1. Shall I put today's local Flyd commit on top of GitHub's latest and push it? Until then, fixes that land won't reach the running Flyd. https://github.com/GeorgeGally/flyd/pull/158
2. Do you want the command that lets firstmate message Flyd and get a real reply?`;
