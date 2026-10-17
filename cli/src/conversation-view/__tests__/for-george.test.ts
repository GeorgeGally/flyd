import { describe, expect, it } from "vitest";
import { condense, fitsAtAGlance, georgeMarkdown, MAX_CHARS, outcomesOf, staffLine } from "../for-george.js";
import { ABOUT_FIXES, THREE_FIXES, STAFF_BLOCKED, STAFF_DECISION, PHANTOM_NOTICES, STAFF_LANDED, STAFF_PROGRESS, WHERE_EVERYTHING_STANDS } from "./fixtures/replies.js";

describe("staffLine", () => {
  it("absorbs a fifteen-line progress report: no message for George", () => {
    expect(STAFF_PROGRESS.split("\n").length).toBeGreaterThanOrEqual(15);
    expect(staffLine(STAFF_PROGRESS)).toEqual({ kind: "absorbed" });
  });

  it("absorbs acknowledgements and check status", () => {
    expect(staffLine("Captain, shipshape.")).toEqual({ kind: "absorbed" });
    expect(staffLine("Checks are running; no checks failed so far and nothing is blocked.")).toEqual({ kind: "absorbed" });
    expect(staffLine("CI failed on lint, so I'm fixing it now and re-running.")).toEqual({ kind: "absorbed" });
  });

  it("turns a landed pull request into one line with its URL", () => {
    const said = staffLine(STAFF_LANDED);
    expect(said).toMatchObject({ kind: "landed", url: "https://github.com/GeorgeGally/flyd/pull/162" });
    const shown = georgeMarkdown(said as Exclude<typeof said, { kind: "absorbed" }>);
    expect(shown.split("\n")).toHaveLength(1);
    expect(shown).toBe("The island text fix is merged: https://github.com/GeorgeGally/flyd/pull/162");
  });

  it("does not read future or quoted landings as landed", () => {
    expect(staffLine("It will be merged once checks are green: https://github.com/GeorgeGally/flyd/pull/9").kind).toBe("absorbed");
    expect(staffLine('The word-swapping made garbled lines like "Merged deployed." so I changed the approach.').kind).toBe("absorbed");
    expect(staffLine("It is ready to merge; not merged yet.").kind).toBe("absorbed");
    expect(staffLine("It'll be merged after the review.").kind).toBe("absorbed");
    expect(staffLine("If the review passes it gets merged.").kind).toBe("absorbed");
  });

  it("does not read a landing that only describes what it names as news", () => {
    expect(staffLine("Everything that has landed is already running: I restart Flyd after each merge.").kind).toBe("absorbed");
    expect(staffLine("What landed earlier was the header fix.").kind).toBe("absorbed");
    expect(staffLine("The fix which shipped yesterday needed a follow-up.").kind).toBe("absorbed");
    expect(staffLine("The island fix is merged: https://github.com/o/r/pull/3")).toMatchObject({ kind: "landed", url: "https://github.com/o/r/pull/3" });
  });

  it.each([
    ["Everything that has landed is already running: I restart Flyd after each merge.", "absorbed"],
    ["What landed earlier was restarted.", "absorbed"],
    [PHANTOM_NOTICES, "absorbed"],
    ["Yes that merged: https://github.com/o/r/pull/7", "landed"],
    ["OK that landed: https://github.com/o/r/pull/7", "landed"],
    ["Confirmed that has landed: https://github.com/o/r/pull/7", "landed"],
    ["All of that has landed: https://github.com/o/r/pull/5", "landed"],
    ["The header fix is green and that merged: https://github.com/o/r/pull/6", "landed"],
    ["Merged the fix that was blocking login.", "landed"],
    ["The island fix is merged and is live now.", "landed"],
    [STAFF_LANDED, "landed"],
  ])("reads %j as %s: a landing only describes what it names when its clause is the subject of a later verb", (text, kind) => {
    expect(staffLine(text).kind).toBe(kind);
  });

  it("reads a landing in its own clause, whatever follows it", () => {
    expect(staffLine("All of that has landed: https://github.com/o/r/pull/5")).toMatchObject({ kind: "landed", url: "https://github.com/o/r/pull/5" });
    expect(staffLine("The header fix is green and that merged: https://github.com/o/r/pull/6")).toMatchObject({ kind: "landed", url: "https://github.com/o/r/pull/6" });
    expect(staffLine("Merged the logo fix after the review passed.")).toEqual({ kind: "landed", line: "Merged the logo fix after the review passed." });
    expect(staffLine("Merged the logo fix after the review passed. https://github.com/o/r/pull/9")).toMatchObject({ kind: "landed", line: "Merged the logo fix after the review passed." });
    expect(staffLine("Merged. https://github.com/o/r/pull/1")).toMatchObject({ kind: "landed", line: "Merged." });
    expect(staffLine("Wait... merged. https://github.com/o/r/pull/3")).toMatchObject({ line: "Wait... merged." });
  });

  it("turns a decision only he can make into one line with option buttons", () => {
    const said = staffLine(STAFF_DECISION);
    expect(said).toMatchObject({ kind: "decision", options: ["The boardroom photo", "The skyline photo"] });
    expect((said as { line: string }).line.split("\n")).toHaveLength(1);
    expect((said as { line: string }).line).toMatch(/hero images\. Which one should go live\?$/);
  });

  it("turns a real blocker into one line and what happens next", () => {
    const said = staffLine(STAFF_BLOCKED);
    expect(said.kind).toBe("blocker");
    expect((said as { line: string }).line).toBe(
      "The Good Neighbours deploy is blocked: Kinsta rejected the SSH key and I can't get past the login. I'll ask Kinsta support to reset it and try again this afternoon.",
    );
  });

  it("speaks in Flyd's voice", () => {
    const said = staffLine("Captain, the redirects are live on capfive.com now.");
    expect(said.kind).toBe("landed");
    expect(georgeMarkdown(said as Exclude<typeof said, { kind: "absorbed" }>)).not.toMatch(/captain/i);
  });
});

describe("condense", () => {
  it("holds a long reply to at most three short lines, no list", () => {
    const short = condense(ABOUT_FIXES);
    expect(short.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(short).not.toMatch(/^\s*(?:[-*+]|\d+[.)])\s/m);
    expect(short.startsWith("All three About fixes for phones are committed and pushed to GitHub.")).toBe(true);
    expect(fitsAtAGlance(short)).toBe(true);
  });

  it("keeps a pull request link that only the cut part named", () => {
    const short = condense(WHERE_EVERYTHING_STANDS);
    expect(short.length).toBeLessThanOrEqual(MAX_CHARS + 80);
    const pulls = WHERE_EVERYTHING_STANDS.match(/https:\/\/github\.com\/\S+\/pull\/\d+/g);
    if (pulls) expect(short).toMatch(/https:\/\/github\.com\/\S+\/pull\/\d+/);
  });

  it("leaves a short answer as it is", () => {
    expect(condense("Yes, sir. The redirects are live.")).toBe("Yes, sir. The redirects are live.");
  });
});

describe("no shell commands in front of him", () => {
  it("keeps a command out of the few lines he reads first", () => {
    const reply = "Sir, still waiting on you. The trial run would remove 44,148 test records, and a backup is taken first. To run it yourself, type: `! cd ~/Documents/flyd/cli && npx tsx src/index.ts purge-test-records` Or just say yes and I'll run it.";
    const short = condense(reply);
    expect(short).not.toMatch(/npx|cd ~|purge-test-records|type:/);
    expect(short).toContain("44,148 test records");
  });
});

describe("what is stuck on the staff's side", () => {
  it("is theirs to clear: a check or review that is stuck never reaches him", () => {
    expect(staffLine("Flyd decides itself and Flyd watches staff are still stuck on a check that compares their history against an older copy.").kind).toBe("absorbed");
    expect(staffLine("The CI pipeline failed on lint for the island branch.").kind).toBe("absorbed");
  });
});

describe("a reply about several pieces of work", () => {
  it("reads as a card per piece: its name, where it stands in a line, and a state", () => {
    expect(outcomesOf(THREE_FIXES)).toEqual({
      lead: "Here's where the three Flyd fixes stand:",
      items: [
        { title: "Flyd decides itself", line: "Still stuck on its checks.", state: "stuck" },
        { title: "Chief-of-staff voice", line: 'The phantom "your decision" island alerts are fixed.', state: "landed" },
        { title: "Activity artefacts", line: "Final checks are running.", state: "underway" },
      ],
    });
  });

  it("takes a lead-in's state and puts each link on its card, not in its words", () => {
    const cards = outcomesOf(WHERE_EVERYTHING_STANDS)!;
    expect(cards.items[0]).toEqual({ title: "The Librarian curating taste", line: "", state: "landed", url: "https://github.com/GeorgeGally/flyd/pull/83" });
    expect(cards.items.every((item) => !item.title.includes("http"))).toBe(true);
    expect(cards.items.length).toBeLessThanOrEqual(6);
  });

  it("reads bold words that open a sentence as the sentence, not a name", () => {
    const cards = outcomesOf("- **Flyd decides itself** and Flyd watches staff are still stuck on a check.\n- **Activity artefacts**: final checks are running.")!;
    expect(cards.items[0]).toMatchObject({ title: "Flyd decides itself and Flyd watches staff are still stuck on a check", state: "stuck" });
  });

  it("is not a list of one", () => {
    expect(outcomesOf("Done.\n\n- one thing")).toBeNull();
  });
});
