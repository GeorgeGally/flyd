import { describe, expect, it } from "vitest";
import { choiceOf, choiceTarget, openChoice } from "../choices.js";
import { SnapshotDiffer } from "../server.js";
import { showOf } from "../show.js";
import { boxesOf } from "../boxes.js";
import type { ConversationMessage } from "../types.js";

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
  });

  it("offers one button per option listed under the question", () => {
    expect(choiceOf("Two looks are ready.\n\nWhich do you want:\n1. **Evergreen** — dark green and gold\n2. **Frost** — pale blue")).toEqual({
      question: "Which do you want?",
      options: ["Evergreen", "Frost"],
    });
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

describe("openChoice", () => {
  it("is the newest reply after his last word, and only while he has not answered", () => {
    const asked = reply("reply:a#2", REVIEW, { aside: true });
    expect(openChoice([said("u1", "ok do it"), asked])).toMatchObject({ message: asked, choice: { question: "Want me to add all three?" } });
    expect(openChoice([said("u1", "ok do it"), asked, said("note:1", "Yes, all three")])).toBeNull();
    // An older ask was overtaken by his own later word.
    expect(openChoice([reply("r1", "Should I remove it?"), said("u2", "do the menu"), reply("r2", "Done, the menu is live.")])).toBeNull();
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
});
