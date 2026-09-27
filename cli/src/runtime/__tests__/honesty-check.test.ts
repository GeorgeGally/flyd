import { describe, expect, it } from "vitest";
import { honestyRewritePrompt, unsupportedClaims } from "../honesty-check.js";

const mutating = (name: string) => name === "write_file" || name === "reminders";

describe("honesty check", () => {
  it("catches claimed work that no tool did", () => {
    expect(unsupportedClaims("I wrote the demo spec and the one-pager.", [], mutating, () => true)).toHaveLength(1);
    expect(unsupportedClaims("I wrote the demo spec.", [{ name: "write_file", input: { path: "spec.md" }, succeeded: true }], mutating, () => true)).toEqual([]);
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
