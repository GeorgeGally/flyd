import { describe, expect, it } from "vitest";
import { choiceOf, choiceTarget, openChoice, withoutClosingAsk } from "../choices.js";
import { SnapshotDiffer } from "../server.js";
import { showOf } from "../show.js";
import { boxesOf } from "../boxes.js";
import type { ConversationMessage } from "../types.js";
import { MISSED_NOTES, OPEN_QUESTIONS } from "./fixtures/replies.js";

// The reply that never reached him: an animation review in firstmate's own
// session, ending on a question about the three things it listed.
const REVIEW = `Captain, I went through the GNM site and the application form. Only three places would clearly benefit from more motion.

### Worth adding

| # | Where | Today | Suggested motion |
|---|---|---|---|
| 1 | Every button, choice tile and category tag | Nothing happens on the tap itself | A small press-in while held |
| 2 | Photo thumbnails and logo preview | Pictures appear instantly | Each new thumbnail fades in |
| 3 | Ticket popup success | The form vanishes | The confirmation fades in |

### Considered and left out

- **Menu highlight:** core navigation used constantly.
- **Hover effects on buttons:** switched off earlier.

### Verdict

The site needs very little more motion. Number 1 is worth the most.

Want me to add all three?`;

const RANKED_PICKS = `Captain, the five ways to make Flyd smarter are ready. The page is in your Flyd artefacts and the full report is alongside it. They're ranked:

1. **Keep promises straight.** Each commitment gets one record: where it came from, its status, its next check, and whether it's actually finished. Big job.
2. **Every background job ends in a checkable result or an honest "blocked".** No more quiet empty or failed runs sitting in Flyd's job list.
3. **Your corrections become lasting, testable preferences.** When you correct Flyd once, it stays corrected, and there's a test proving it.
4. **Recall shows why an item belongs and when it may be out of date.** Flyd stops bringing back stale facts with full confidence.
5. **Proof that learning helps.** Every change to how Flyd behaves gets checked against evidence that it actually improved things.

Pick the ones you want built, from the page in Flyd or here.`;

const reply = (id: string, text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({ id, role: "assistant", text, ...extra });
const said = (id: string, text: string): ConversationMessage => ({ id, role: "user", text });

describe("choiceOf", () => {
  it("reads a yes-or-no question about a numbered set as all of it, one of it, or none", () => {
    expect(choiceOf(REVIEW)).toEqual({
      question: "Want me to add all three?",
      options: [
        "Yes, all three",
        "Only 1: Every button, choice tile and category tag",
        "Only 2: Photo thumbnails and logo preview",
        "Only 3: Ticket popup success",
        "No",
      ],
    });
  });

  it("reads a plain yes-or-no question as Yes and No, with the sentence before a short one", () => {
    expect(choiceOf("Captain, the leftover page is still there. Should I remove it?")).toEqual({
      question: "The leftover page is still there. Should I remove it?",
      options: ["Yes", "No"],
    });
  });

  it("offers the alternatives a question names", () => {
    expect(choiceOf("Checks are still running. Should I merge now or wait for checks?")!.options).toEqual(["Merge now", "Wait for checks"]);
    expect(choiceOf("Do you want A, B or C?")!.options).toEqual(["A", "B", "C"]);
    expect(choiceOf("Is that fine or not?")!.options).toEqual(["Yes", "No"]);
    // A real A-or-B question that mentions a quantifier keeps its two options, not Yes/No.
    expect(choiceOf("Should I pick the two new ones, or keep them all?")!.options).toEqual(["Pick the two new ones", "Keep them all"]);
  });

  it("offers one button per option listed under the question", () => {
    expect(choiceOf("Two looks are ready.\n\nWhich do you want:\n1. **Evergreen** — dark green and gold\n2. **Frost** — pale blue")).toEqual({
      question: "Which do you want?",
      options: ["Evergreen", "Frost"],
    });
  });

  it("offers the items a reply listed when it asks him to pick the ones he wants, any number of them", () => {
    const choice = choiceOf(RANKED_PICKS)!;
    expect(choice.question).toBe("Pick the ones you want built, from the page in Flyd or here.");
    expect(choice.multiple).toBe(true);
    expect(choice.options).toHaveLength(5);
    expect(choice.options[0]).toBe("Keep promises straight");
    expect(choice.options[4]).toBe("Proof that learning helps");
    expect(JSON.stringify(choice.options)).not.toContain("From the page in Flyd");
    expect(choice.options).not.toContain("Here");
  });

  it("offers the listed items when the ask to pick them ends in a question mark", () => {
    const choice = choiceOf(RANKED_PICKS.replace(/here\.$/, "here?"))!;
    expect(choice.multiple).toBe(true);
    expect(choice.options).toHaveLength(5);
    expect(choice.options[0]).toBe("Keep promises straight");
    expect(choice.options).not.toContain("Pick the ones you want built");
    expect(choice.options).not.toContain("From the page in Flyd");
    expect(choice.options).not.toContain("Here");
  });

  it("asks nothing when it says to pick the ones and listed nothing to pick from", () => {
    expect(choiceOf("Ready when you are. Pick the ones you want built, from the page in Flyd or here.")).toBeNull();
  });

  it("offers the ones a lead-in asks him to pick, above or below its list, any number of them", () => {
    // The ask is the line right above the list, in the same block or after a blank line.
    expect(choiceOf("Pick the ones you want:\n1. Wildcard rule\n2. Separate rules")).toEqual({ question: "Pick the ones you want?", options: ["Wildcard rule", "Separate rules"], multiple: true });
    expect(choiceOf("Pick the ones you want:\n\n1. Wildcard rule\n2. Separate rules")).toEqual({ question: "Pick the ones you want?", options: ["Wildcard rule", "Separate rules"], multiple: true });
    // Picking one is a single choice, not several.
    expect(choiceOf("Pick one:\n1. Wildcard rule\n2. Separate rules")).toEqual({ question: "Pick one?", options: ["Wildcard rule", "Separate rules"] });
  });

  it("leaves findings listed above an open question to his own words, never as buttons", () => {
    expect(choiceOf("Here is what I found:\n\n1. The cache is stale.\n2. The token expired.\n\nWhat should we do?")).toEqual({ question: "What should we do?", options: [] });
    expect(choiceOf("Here is what I found:\n\n1. The cache is stale.\n2. The token expired.\n\nHow do you want to proceed?")).toEqual({ question: "How do you want to proceed?", options: [] });
    // "Which do you want?" over the same set is about choosing among it: the buttons stay.
    expect(choiceOf("Here is what I found:\n\n1. The cache is stale.\n2. The token expired.\n\nWhich do you want?").options).toEqual(["The cache is stale", "The token expired"]);
  });

  it("puts several questions listed at the end one at a time, never offering one as the answer to another", () => {
    expect(choiceOf(OPEN_QUESTIONS)).toEqual({
      question: "Still waiting on you",
      options: [],
      steps: [
        { question: "Discard the old CapFive experiment branches (shader lab, truchet lab, deals pagination)?", options: ["Yes", "No"] },
        { question: "Should Flyd's sidebar show newest at the top again?", options: ["Yes", "No"] },
      ],
    });
    // Each question keeps its own alternatives; one that asks which is his to say.
    expect(choiceOf("Two calls before I go on:\n\n1. Merge PR 12 now or wait for checks?\n2. Which colour should the button be?")!.steps).toEqual([
      { question: "Merge PR 12 now or wait for checks?", options: ["Merge PR 12 now", "Wait for checks"] },
      { question: "Which colour should the button be?", options: [] },
    ]);
  });

  it("asks with a colon lead-in only when the lead-in itself asks", () => {
    expect(choiceOf("Done, sir. Here's what changed:\n- Header now sticky\n- Footer links fixed")).toBeNull();
    expect(choiceOf("All landed.\n\nNext steps:\n1. Watch the deploy\n2. Check the form on a phone")).toBeNull();
    expect(choiceOf("Summary of today's work:\n- Auth fix merged\n- Docs updated")).toBeNull();
    expect(choiceOf("Captain, where things stand:\n\n- Auth fix merged\n- The pricing page is live")).toBeNull();
    expect(choiceOf("What changed:\n- Header now sticky\n- Footer links fixed")).toBeNull();
    expect(choiceOf("What should the button say:\n- Book now\n- Reserve")!.options).toEqual(["Book now", "Reserve"]);
    expect(choiceOf("Captain, do you want me to:\n1. Merge it now\n2. Wait for checks")).toEqual({ question: "Do you want me to?", options: ["Merge it now", "Wait for checks"] });
    expect(choiceOf("Pick one:\n- Evergreen\n- Frost")!.options).toEqual(["Evergreen", "Frost"]);
  });

  it("leaves an open question to his own words", () => {
    expect(choiceOf("The button is in. What should it say?")).toEqual({ question: "The button is in. What should it say?", options: [] });
  });

  it("asks nothing when the reply only reports, or answered its own question along the way", () => {
    expect(choiceOf("Done, merged and live.")).toBeNull();
    expect(choiceOf("Why did it fail? The token expired. I renewed it and it works now.")).toBeNull();
    expect(choiceOf("Run this:\n\n```\nread -p 'Continue?' x\n```")).toBeNull();
    expect(choiceOf("Want me to add all three?\n\nNever mind, I added them; all three are live.")).toBeNull();
  });
});

describe("withoutClosingAsk", () => {
  it("drops a question standing alone as the last paragraph, and nothing else", () => {
    expect(withoutClosingAsk("All live.\n\nShould I merge it?")).toBe("All live.");
    expect(withoutClosingAsk("All live. Should I merge it?")).toBe("All live. Should I merge it?");
    expect(withoutClosingAsk("Which one?\n\n1. Red\n2. Blue")).toBe("Which one?\n\n1. Red\n2. Blue");
  });
});

describe("openChoice", () => {
  it("is the newest reply after his last word, and only while he has not answered", () => {
    const asked = reply("reply:a#2", REVIEW, { aside: true });
    expect(openChoice([said("u1", "ok do it"), asked])).toMatchObject({ message: asked, choice: { question: "Want me to add all three?" } });
    expect(openChoice([said("u1", "ok do it"), asked, said("note:1", "Yes, all three")])).toBeNull();
    // An older ask was overtaken by his own later word.
    expect(openChoice([reply("r1", "Should I remove it?"), said("u2", "do the menu"), reply("r2", "Done, the menu is live.")])).toBeNull();
  });

  it("stays open through a note of his about something else, until he answers it", () => {
    // Firstmate's report on the missed notes ended on a question; 47 seconds later he sent a note about scrolling.
    const asked = reply("reply:b#383", "Fix 2 changes firstmate's shared code, so I want your yes first.\n\nShould I go ahead with fix 2?", { aside: true });
    const scrolling = said("note:1791778226", "its very easy, too easy, to scroll from nuanu page to the next page");
    expect(openChoice([said("u1", "well its an issue. what failed?"), asked, scrolling])).toMatchObject({ message: asked, choice: { question: "Should I go ahead with fix 2?", options: ["Yes", "No"] } });
    // A later reply about that note does not overtake it either.
    expect(openChoice([asked, scrolling, reply("reply:c#1", "Scrolling now needs a firmer swipe to change page.")])?.message).toBe(asked);
    // His reply to another answer, in its own thread, is not an answer to this one.
    expect(openChoice([asked, { ...said("note:2", "make it bigger"), replyTo: "note:0" }])?.message).toBe(asked);
    // Typed into firstmate's session itself: the session has its answer, whatever he said.
    expect(openChoice([asked, scrolling, said("346e9803", "yes")])).toBeNull();
    // A note that reads as an answer, or names an option.
    expect(openChoice([asked, said("note:3", "Yes go ahead")])).toBeNull();
    expect(openChoice([asked, said("note:3", "no, leave it")])).toBeNull();
    expect(openChoice([reply("r1", "Should I merge now or wait for checks?"), said("note:4", "wait for checks")])).toBeNull();
    // His reply to it, in its thread.
    expect(openChoice([asked, scrolling, { ...said("note:5", "Yes"), replyTo: "reply:b#383" }])).toBeNull();
  });

  it("is answered by Flyd's answer for him, and open again when he takes that back", () => {
    const asked = reply("reply:a#9", "Checks are green. Should I merge the Flyd change?", { aside: true });
    const flyds = { ...said("note:6", "Yes"), replyTo: "reply:a#9", answeredFor: "Merge green Flyd PRs without asking" };
    expect(openChoice([asked, flyds])).toBeNull();
    const back = { ...said("note:7", "Hold off on that; I'll answer this one myself."), replyTo: "reply:a#9", undoes: true };
    expect(openChoice([asked, flyds, back])?.message).toBe(asked);
    // His own answer after taking it back closes it for good.
    expect(openChoice([asked, flyds, back, { ...said("note:8", "No"), replyTo: "reply:a#9" }])).toBeNull();
  });

  it("passes over a reply Flyd's model judged routine", () => {
    const asked = reply("r1", "Should I remove it?");
    expect(openChoice([asked], () => true)).toBeNull();
  });

  it("sends the answer to the question a reply answers, else to the reply itself", () => {
    expect(choiceTarget(reply("note-reply:3", "Done. Should I land it?", { answers: "note:3" }))).toBe("note:3");
    expect(choiceTarget(reply("reply:a#2", REVIEW))).toBe("reply:a#2");
  });
});

describe("the choice, where he sees it", () => {
  it("carries the question and options under the asking reply in the window, and drops them once he answers", () => {
    const differ = new SnapshotDiffer();
    const asked = reply("reply:a#2", REVIEW, { aside: true });
    const update = differ.next({ messages: [said("u1", "ok do it"), asked], working: false });
    expect(update.messages.find((message) => message.id === asked.id)!.choice).toEqual({
      question: "Want me to add all three?",
      options: ["Yes, all three", "Only 1: Every button, choice tile and category tag", "Only 2: Photo thumbnails and logo preview", "Only 3: Ticket popup success", "No"],
      replyTo: "reply:a#2",
    });
    const answered = differ.next({ messages: [said("u1", "ok do it"), asked, said("note:1", "Yes, all three")], working: false });
    expect(answered.messages.find((message) => message.id === asked.id)!.choice).toBeUndefined();
  });

  it("carries several questions as steps, in the window and on the artefact", () => {
    const asked = reply("reply:b#4", OPEN_QUESTIONS, { aside: true, timestamp: "2026-10-12T07:40:29Z" });
    const choice = new SnapshotDiffer().next({ messages: [said("u1", "fix the admin"), asked], working: false }).messages.find((message) => message.id === asked.id)!.choice!;
    expect(choice).toMatchObject({ question: "Still waiting on you", options: [], replyTo: "reply:b#4" });
    expect(choice.steps!.map((step) => step.question)).toEqual(["Discard the old CapFive experiment branches (shader lab, truchet lab, deals pagination)?", "Should Flyd's sidebar show newest at the top again?"]);
    const screen = showOf({ messages: [said("u1", "fix the admin"), asked], working: false }, { now: Date.parse("2026-10-12T07:41:00Z") });
    expect(screen.items[0]!.decision).toMatchObject({ replyTo: "reply:b#4", choices: [], steps: choice.steps });
  });

  it("puts it on the artefact as a call ahead of the fleet's holds, answerable with a tap", () => {
    const now = Date.parse("2026-10-11T15:20:00Z");
    const asked = reply("reply:a#2", REVIEW, { aside: true, timestamp: "2026-10-11T15:18:58Z" });
    const holds = ["one", "two", "three"].map((task) => ({ label: `Hold ${task}`, task }));
    const screen = showOf({ messages: [said("u1", "ok do it"), asked], working: false }, {
      now,
      artefact: { fleet: { calls: holds, live: [], ready: [], landed: [], held: [], next: [] }, memories: [], news: [], taste: [] },
    });
    const [call] = screen.items;
    expect(call).toMatchObject({
      kind: "call",
      ref: "reply:a#2",
      decision: { task: "reply:a#2", replyTo: "reply:a#2", question: "Want me to add all three?", choices: expect.arrayContaining(["Yes, all three", "No"]) },
    });
    // The screen shows three calls at most: his question is among them, not cut behind the fleet's.
    const calls = boxesOf(screen).find((box) => box.id === "calls")!.children!;
    expect(calls[0]!.decision).toMatchObject({ replyTo: "reply:a#2" });
  });

  it("keeps the question on the window and the artefact when he sends a note about something else", () => {
    const now = Date.parse("2026-10-12T04:11:00Z");
    const asked = reply("reply:b#383", MISSED_NOTES, { aside: true, timestamp: "2026-10-12T04:09:39Z" });
    const messages = [said("u1", "well its an issue. what failed?"), asked, { ...said("note:1791778226", "its very easy, too easy, to scroll from nuanu page to the next page"), timestamp: "2026-10-12T04:10:26Z" }];
    const update = new SnapshotDiffer().next({ messages, working: false });
    expect(update.messages.find((message) => message.id === asked.id)!.choice).toEqual({ question: "Should I go ahead with fix 2?", options: ["Yes", "No"], replyTo: "reply:b#383" });
    // The briefing above the card does not ask it a second time.
    const shown = update.messages.find((message) => message.id === asked.id)!;
    expect(shown.summary!.html).toContain("All 14 notes are now handled");
    expect(shown.summary!.html).not.toContain("Should I go ahead with fix 2?");
    expect(shown.html).toContain("Should I go ahead with fix 2?");
    const [call] = showOf({ messages, working: false }, { now }).items;
    expect(call).toMatchObject({ kind: "call", headline: "Should I go ahead with fix 2?", decision: { replyTo: "reply:b#383", choices: ["Yes", "No"] } });
  });

  it("shows an answer Flyd gave for him as Flyd's, with its rule, until he takes it back", () => {
    const asked = reply("reply:a#9", "Checks are green. Should I merge the Flyd change?", { aside: true });
    const flyds = { ...said("note:6", "Yes"), replyTo: "reply:a#9", answeredFor: "Merge green Flyd PRs without asking" };
    const differ = new SnapshotDiffer();
    const first = differ.next({ messages: [asked, flyds], working: false }).messages;
    expect(first.find((message) => message.id === "note:6")).toMatchObject({ answeredFor: "Merge green Flyd PRs without asking" });
    expect(first.find((message) => message.id === "note:6")!.undone).toBeUndefined();
    expect(first.find((message) => message.id === asked.id)!.choice).toBeUndefined();
    const back = { ...said("note:7", "Hold off on that; I'll answer this one myself."), replyTo: "reply:a#9", undoes: true };
    const second = differ.next({ messages: [asked, flyds, back], working: false }).messages;
    expect(second.find((message) => message.id === "note:6")).toMatchObject({ undone: true });
    expect(second.find((message) => message.id === asked.id)!.choice).toMatchObject({ question: "Checks are green. Should I merge the Flyd change?" });
  });
});
