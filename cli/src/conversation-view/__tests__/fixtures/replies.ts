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
