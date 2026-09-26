import { describe, expect, it, vi } from "vitest";
import { learnFromMessage, mightStatePersonalFact } from "../profile-learning.js";

describe("profile learning", () => {
  it("only spends a model call when George is talking about himself", () => {
    expect(mightStatePersonalFact("my sister Ana is visiting from Lisbon next month")).toBe(true);
    expect(mightStatePersonalFact("I stopped drinking coffee after 2pm")).toBe(true);
    expect(mightStatePersonalFact("what's the weather in Tokyo?")).toBe(false);
    expect(mightStatePersonalFact("run the tests")).toBe(false);
    expect(mightStatePersonalFact("ok")).toBe(false);
  });

  it("files up to three new facts and skips ones already known", async () => {
    const complete = vi.fn(async (_prompt: string) => '{"facts":[{"section":"People","fact":"Sister Ana lives in Lisbon."},{"section":"Routines","fact":"No coffee after 2pm."}]}');
    const added: string[] = [];
    const learned = await learnFromMessage("my sister Ana lives in Lisbon and I stopped coffee after 2pm", {
      complete,
      readProfile: () => "## Routines\n- No coffee after 2pm.",
      addFact: (fact) => {
        if (fact.startsWith("No coffee")) return false;
        added.push(fact);
        return true;
      },
    });
    expect(learned).toEqual([{ section: "People", fact: "Sister Ana lives in Lisbon." }]);
    expect(added).toEqual(["Sister Ana lives in Lisbon."]);
    expect(complete.mock.calls[0][0]).toContain("Current profile:\n## Routines");
  });

  it("does not call the model for questions", async () => {
    const complete = vi.fn(async () => "{}");
    expect(await learnFromMessage("should I call my mom today?", { complete, addFact: () => true })).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });
});
