import { describe, expect, it } from "vitest";
import { honestyRewritePrompt, unsupportedClaims } from "../honesty-check.js";

const mutating = (name: string) => name === "write_file" || name === "reminders" || name === "background_task";

describe("honesty check", () => {
  it("catches claimed work that no tool did", () => {
    expect(unsupportedClaims("I wrote the demo spec and the one-pager.", [], mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("I wrote the demo spec.", [{ name: "write_file", input: { path: "spec.md" }, succeeded: true }], mutating, () => true)).toEqual([]);
    // Claims of work already under way need a tool that started it.
    expect(unsupportedClaims("So I've started going through the repo myself.", [], mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("I'm going through the mixes now and will report back.", [], mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("I've taken them off the calendar.", [], mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("I've started on it.", [{ name: "background_task", input: { task: "x" }, succeeded: true }], mutating, () => true)).toEqual([]);
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
