import { describe, expect, it } from "vitest";
import { brief, renderBriefing, statusCardHtml, statusSummaryHtml, withoutStubs } from "../executive.js";
import { inFlydsVoice } from "../flyd-voice.js";
import { SnapshotDiffer } from "../server.js";
import { headlineOf, statusOf } from "../status.js";
import { CORRECTION, FOUR_READY, STILL_WAITING, WHERE_EVERYTHING_STANDS } from "./fixtures/replies.js";

const STUB = /github\.com|\bPRs?\b|#\d+|pull\/\d+|fm\/|\b[0-9a-f]{7}\b|\d+\/\d+/;

/** The words he reads: tags and link targets gone. */
function shown(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

describe("Flyd's executive voice", () => {
  it("takes PR URLs, numbers, branches, hashes and check counts out of prose, keeping the link on the sentence", () => {
    const said = withoutStubs(CORRECTION);
    expect(said).toContain("[It shipped, merged Oct 6, and it is in your local Flyd copy](https://github.com/GeorgeGally/flyd/pull/58).");
    expect(said).toContain("The old draft was superseded and is still open.");
    expect(withoutStubs("Rebased onto `beed017` and pushed on `fm/flyd-island-status`; all 5 checks passed and 1567/1567 tests pass."))
      .toBe("Rebased and pushed; checks passed and tests pass.");
    expect(withoutStubs("The preview is waiting for you at http://localhost:8093/lab/?fresh=1."))
      .toBe("[The preview is waiting for you](http://localhost:8093/lab/?fresh=1).");
    expect(withoutStubs("```\ngit push origin fm/x\n```")).toBe("```\ngit push origin fm/x\n```");
  });

  it("keeps a lone status item in the prose rather than dropping it", () => {
    const waiting = brief("Done.\n\nWaiting on your word for:\n- The checkout rework");
    expect(waiting.items).toEqual([]);
    expect(waiting.prose).toContain("The checkout rework");
    expect(renderBriefing("Done.\n\nWaiting on your word for:\n- The checkout rework")).toContain("The checkout rework");
    expect(brief("**Merged:**\n- The dark mode toggle").prose).toContain("The dark mode toggle");
  });

  it("leaves paths, ordinary slashes, dates and failing counts alone", () => {
    expect(withoutStubs("Installed into ~/.claude/skills and ~/.agents/skills.")).toBe("Installed into ~/.claude/skills and ~/.agents/skills.");
    expect(withoutStubs("Try the fix/rollback first.")).toBe("Try the fix/rollback first.");
    expect(withoutStubs("Pushed on the fm/island branch.")).toBe("Pushed.");
    expect(withoutStubs("Pushed to branch fix/hat-tilt.")).toBe("Pushed.");
    expect(withoutStubs("The launch is scheduled for 10/10.")).toBe("The launch is scheduled for 10/10.");
    expect(withoutStubs("It ships 10/10/2026.")).toBe("It ships 10/10/2026.");
    expect(withoutStubs("Green, tests: 12/12.")).toBe("Green, tests.");
    expect(withoutStubs("One test still fails.")).toBe("One test still fails.");
    expect(withoutStubs("Two tests fail on CI.")).toBe("Two tests fail on CI.");
    expect(withoutStubs("All 5 checks passed.")).toBe("Checks passed.");
    expect(withoutStubs("3 of 5 checks passed.")).toBe("3 of 5 checks passed.");
    expect(withoutStubs("All 5 of 5 tests pass.")).toBe("Tests pass.");
    expect(withoutStubs("5 of 5 tests pass.")).toBe("Tests pass.");
    expect(withoutStubs("Green: all five checks passing.")).toBe("Green: checks passing.");
    expect(withoutStubs("5/5 checks green.")).toBe("Checks green.");
    expect(withoutStubs("Done. 5/5 tests passed.")).toBe("Done. Tests passed.");
    expect(withoutStubs("Merged it. 1567/1567 tests pass now.")).toBe("Merged it. Tests pass now.");
    expect(withoutStubs("5 tests are failing.")).toBe("5 tests are failing.");
    expect(withoutStubs("Three checks have failed.")).toBe("Three checks have failed.");
    expect(withoutStubs("2 tests now fail.")).toBe("2 tests now fail.");
    expect(withoutStubs("5 checks passed.")).toBe("5 checks passed.");
    expect(withoutStubs("Merged into `fm/x`.")).toBe("Merged into.");
    expect(withoutStubs("Rebased onto branch fm/x today.")).toBe("Rebased onto today.");
    expect(withoutStubs("Reverted what 3f2a9c1 did.")).toBe("Reverted what did.");
    expect(withoutStubs("It was 3f2a9c1 that broke it.")).toBe("It was that broke it.");
  });

  it("shows a multi-item status as a card grouped by what it asks of him, with every link kept behind its line", () => {
    const html = renderBriefing(inFlydsVoice(WHERE_EVERYTHING_STANDS));
    expect(shown(html)).not.toMatch(STUB);
    expect(html).toContain('class="status-card"');
    expect(html.indexOf("Under way")).toBeLessThan(html.indexOf("Landed"));
    for (const n of [83, 84, 85, 86, 68]) expect(html).toContain(`href="https://github.com/GeorgeGally/flyd/pull/${n}"`);
    expect(shown(html)).toContain("Drag-and-drop for documents");
    // Two projects on one card: each line says whose it is.
    expect(shown(html)).not.toContain("Flyd (merged)");
    // The notes that are not work states read as one sentence, not bullets.
    expect(html).not.toMatch(/<li>/);
    expect(shown(html)).toContain("the hat tilted to -20°, buttons stay square, small text made bigger and higher-contrast and Roboto for all body text.");
  });

  it("keeps every PR an ask names, folding bare links into one line with a light for each", () => {
    const { items, prose } = brief(inFlydsVoice(STILL_WAITING));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: "Three Flyd changes", state: "needs" });
    expect(items[0]!.urls).toEqual([83, 84, 85].map((n) => `https://github.com/GeorgeGally/flyd/pull/${n}`));
    expect(prose).toContain('Still waiting on your "merge them".');
    expect(brief(inFlydsVoice(FOUR_READY)).items.map((item) => item.text)).toEqual([
      "The island redesign", "The Librarian curating taste", "The going-silent fix", "The chatter fix",
    ]);
  });

  it("leads the summary with one line, then the card, then what is asked of him", () => {
    const html = statusSummaryHtml(inFlydsVoice(WHERE_EVERYTHING_STANDS))!;
    expect(html.indexOf("where everything stands")).toBeLessThan(html.indexOf("status-card"));
    expect(shown(html)).toContain('Say "drop the local edit"');
    expect(statusSummaryHtml("Sir, the stats are centred and pushed.")).toBeUndefined();
  });

  it("tells the island where the work stands, and that it needs him", () => {
    expect(headlineOf(inFlydsVoice(WHERE_EVERYTHING_STANDS))).toBe("Two under way · three landed");
    const status = statusOf({ messages: [{ id: "r1", role: "assistant", text: inFlydsVoice(FOUR_READY) }], working: false });
    expect(status.reply).toMatchObject({ headline: "Four need you", asks: true });
    expect(headlineOf("Captain, PR 58 (https://github.com/GeorgeGally/flyd/pull/58) merged.")).not.toMatch(STUB);
  });

  it("puts firstmate's own words, links and all, behind more, and briefs a reply with no summary", () => {
    const differ = new SnapshotDiffer();
    const [long] = differ.next({ messages: [{ id: "r1", role: "assistant", text: inFlydsVoice(WHERE_EVERYTHING_STANDS) }], working: false }).messages;
    expect(long!.summary!.html).toContain("status-card");
    expect(long!.html).toContain("https://github.com/GeorgeGally/flyd/pull/83</a>");
    const [short] = differ.next({ messages: [{ id: "r2", role: "assistant", text: "Sir, PR 90 (https://github.com/GeorgeGally/flyd/pull/90) merged." }], working: false }).messages;
    expect(short!.summary).toBeUndefined();
    expect(shown(short!.html)).not.toMatch(STUB);
    expect(short!.html).toContain('href="https://github.com/GeorgeGally/flyd/pull/90"');
  });
});

describe("needs you: only real questions, each answerable", () => {
  const REPLY = [
    "Captain, the Block42 review raised three questions that need your call before it can merge:",
    "",
    "1. **Sepia tint.** Keep it on both, or brands only?",
    "2. **Repeated copy.** Keep it, give me new wording, or draft different copy?",
    "3. **Photo rights.** Are you OK publishing it?",
    "",
    "Other updates:",
    '- **Flyd artefacts:** the fix is built. Finished reports no longer wrongly say "waiting to land". It\'s going through checks now and merges itself when green.',
    "- **Flyd status line:** the follow-up wording fix is in its checks.",
  ].join("\n");

  it("keeps a progress line that merely quotes say \"…\" out of Needs you", () => {
    const byState = brief(REPLY).items.map((item) => [item.state, item.text]);
    expect(byState.filter(([state]) => state === "needs").map(([, text]) => text)).toEqual(["Sepia tint", "Repeated copy", "Photo rights"]);
    expect(byState.some(([, text]) => /Flyd artefacts/.test(text) && /Needs you/.test(text))).toBe(false);
    expect(byState).toContainEqual(["underway", "Flyd artefacts: the fix is built"]);
  });

  it("marks each Needs you row with the question, so the page can answer it in place", () => {
    const html = statusCardHtml(brief(REPLY).items);
    expect(html).toContain('<section class="sc-group k-call"><h4 class="sc-kicker">Needs you<span class="sc-count">3</span>');
    expect(html).toContain('data-ask="Sepia tint"');
    expect(html).toContain('data-ask="Photo rights"');
    expect(html).not.toContain('data-ask="Flyd artefacts: the fix is built"');
  });
});

