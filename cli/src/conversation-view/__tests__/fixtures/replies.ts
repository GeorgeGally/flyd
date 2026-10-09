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
