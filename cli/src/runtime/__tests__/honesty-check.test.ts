import { describe, expect, it } from "vitest";
import { honestyRewritePrompt, unsupportedClaims } from "../honesty-check.js";

const mutating = (name: string) => name === "write_file" || name === "reminders" || name === "background_task" || name === "start_knowledge_task";

describe("honesty check", () => {
  it("catches claimed work that no tool did", () => {
    expect(unsupportedClaims("I wrote the demo spec and the one-pager.", [], mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("I wrote the demo spec.", [{ name: "write_file", input: { path: "spec.md" }, succeeded: true }], mutating, () => true)).toEqual([]);
    // Claims of work already under way need a tool that started it.
    expect(unsupportedClaims("So I've started going through the repo myself.", [], mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("I'm going through the mixes now and will report back.", [], mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("I've taken them off the calendar.", [], mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("I've started on it.", [{ name: "background_task", input: { task: "x" }, succeeded: true }], mutating, () => true)).toEqual([]);
    const research = [{ name: "start_knowledge_task", input: { outcome: "research Jev" }, succeeded: true }];
    expect(unsupportedClaims("I've started researching it.", research, mutating, () => true)).toEqual([]);
    expect(unsupportedClaims("I've verified all the claims.", research, mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("Want me to start going through it?", [], mutating, () => true)).toEqual([]);
    // A handed-off job backs "started", not "drafted".
    const job = [{ name: "background_task", input: { task: "draft the GNM letter" }, succeeded: true }];
    expect(unsupportedClaims("I've drafted the demand letter.", job, mutating, () => true)[0]).toMatch(/only started it in the background/);
    // Any perfect-tense claim after a hand-off, whatever the verb.
    const crew = [{ name: "start_coding_task", input: { outcome: "clock" }, succeeded: true }];
    const doneish = (text: string) => unsupportedClaims(text, crew, (name) => name === "start_coding_task", () => true);
    expect(doneish("Started it. I've left it on by default and made sure the timer is cleared.")).toHaveLength(1);
    expect(doneish("I've set it to tick every minute.")).toHaveLength(1);
    expect(doneish("Started: a live clock in the header, ticking each minute. I'll tell you when it's ready.")).toEqual([]);
    expect(doneish("I've started it and I've handed over the details.")).toEqual([]);
  });

  it("catches files that are not there, unless this turn touched them", () => {
    const problems = unsupportedClaims("It's in ~/Documents/Glasses/demo-spec.md.", [], mutating, () => false);
    expect(problems).toEqual(["It mentions ~/Documents/Glasses/demo-spec.md, which does not exist on his Mac."]);
    expect(unsupportedClaims("Reading ~/Documents/Glasses/deck.key now.", [{ name: "read_file", input: { path: "~/Documents/Glasses/deck.key" }, succeeded: false }], mutating, () => false)).toEqual([]);
  });

  it("leaves plain, true answers alone", () => {
    expect(unsupportedClaims("Call Sam at 10. Your decks weren't in Documents; want me to check Drive?", [], mutating, () => true)).toEqual([]);
  });

  it("asks for a straight rewrite, not an apology essay", () => {
    expect(honestyRewritePrompt("I wrote it.", ["It says you did or made something…"])).toContain("Don't apologise at length or explain why");
  });
});

describe("style check", () => {
  it("flags greeting-card empathy and em-dash rhythm, not plain talk", async () => {
    const { styleProblems } = await import("../honesty-check.js");
    expect(styleProblems("The silence is the part that stings — a lonely feeling — worse than failing.")).toHaveLength(2);
    expect(styleProblems("None of the sets are online yet. Put one on Mixcloud tonight.")).toEqual([]);
    expect(styleProblems("Started it: a crewmate is adding the clock in its own worktree.")[0]).toMatch(/backstage \("crewmate"\)/);
    expect(styleProblems("I'll build the clock and tell you when it's ready.")).toEqual([]);
  });
});

describe("contrast framing", () => {
  it("flags the constructions George dislikes", async () => {
    const { styleProblems } = await import("../honesty-check.js");
    expect(styleProblems("Self-improvement isn't a feeling or a promise — it's the part of the loop you run.")[0]).toContain("contrast framing");
    expect(styleProblems("That's a genuine why-now, not a deck line.")[0]).toContain("contrast framing");
    expect(styleProblems("The .pptx is your latest deck. Want me to open it?")).toEqual([]);
  });
});

describe("internal narration", () => {
  it("strips handoff, stall and tool narration and says what it took out", async () => {
    const { stripInternalNarration } = await import("../honesty-check.js");
    expect(stripInternalNarration("Passing this to Firstmate. The clock lands in the header tonight.")).toEqual({
      cleaned: "The clock lands in the header tonight.",
      removed: ["Passing this to Firstmate."],
    });
    expect(stripInternalNarration("I'll pass this to the crew now.\nThe fix ships today.").cleaned).toBe("The fix ships today.");
    expect(stripInternalNarration("Handing this to the coding boss. Routing this to the right team. It's done by six.").cleaned).toBe("It's done by six.");
    expect(stripInternalNarration("One moment please sir. Your set starts at 10.")).toEqual({
      cleaned: "Your set starts at 10.",
      removed: ["One moment please sir."],
    });
    expect(stripInternalNarration("Let me check — the venue opens at 9.").cleaned).toBe("The venue opens at 9.");
    expect(stripInternalNarration("Give me a sec. Just checking. Loading… Sam is free at 3.").cleaned).toBe("Sam is free at 3.");
    expect(stripInternalNarration("Calling the calendar tool. You have two meetings tomorrow.").cleaned).toBe("You have two meetings tomorrow.");
    expect(stripInternalNarration("I ran it through my tools internally and found it. The invoice is overdue.").cleaned).toBe("The invoice is overdue.");
    expect(stripInternalNarration("Running the tool now.\n\nThe mix is 62 minutes.").cleaned).toBe("The mix is 62 minutes.");
  });

  it("leaves neutral answers and code alone", async () => {
    const { stripInternalNarration } = await import("../honesty-check.js");
    for (const answer of [
      "Here is the mix plan for tonight.",
      "Call Sam at 10. Your decks weren't in Documents; want me to check Drive?",
      "The page is slow because the hero image is 8MB.",
      "Check the loading spinner on the checkout page.",
      "1. Warm up at 9.\n2. Peak at 11.\n\nWant the full breakdown?",
      "\"Passing this to Firstmate\" and \"One moment please sir\" are both gone: from now on you get the outcome.",
      "Run this:\n```\n# let me check the logs, one moment\ntail -f app.log\n```",
      "There was one moment in the set where the floor emptied. Fix the 11pm transition.",
      "Start by using the built-in tools in Ableton. Then bounce stems.",
      "I'd suggest handing it to your accountant. The deadline is Friday.",
      "I sent the clock fix to Firstmate this morning. It landed at 3pm.",
      "Sure. Let me check with Sam tomorrow and get back to you.",
      "Order pizza for the crew. Soundcheck is at 6.",
      "Order pizza. That's for the crew, not the guests.",
      "Routing it to the aux bus gives you the reverb tail. Then automate the send.",
      "Handing it to the promoter early gives them time.",
      "Using the clone stamp tool, paint over the logo.",
      "I'd handle payroll internally. An agency costs more.",
      "I'll send that to Sam once he replies.",
      "Sending it to the label first is safer.",
    ]) expect(stripInternalNarration(answer)).toEqual({ cleaned: answer, removed: [] });
  });

  it("keeps the original when nothing substantive would be left", async () => {
    const { stripInternalNarration } = await import("../honesty-check.js");
    expect(stripInternalNarration("One moment please sir.")).toEqual({ cleaned: "One moment please sir.", removed: [] });
  });
});

describe("internal narration, George's own words", () => {
  it("keeps hand-offs to George himself", async () => {
    const { stripInternalNarration } = await import("../honesty-check.js");
    expect(stripInternalNarration("I'll hand it to you straight: the gig is off.").removed).toEqual([]);
    expect(stripInternalNarration("I'll pass this along. The draft is in your inbox.").cleaned).toBe("The draft is in your inbox.");
  });
});
