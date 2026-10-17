import { describe, expect, it } from "vitest";
import { kindVisual, KIND_VISUALS } from "../cards.js";

describe("what a kind of artefact looks like", () => {
  it("gives each kind of work a word, a colour and an icon", () => {
    expect(kindVisual("call")).toMatchObject({ word: "Your call", tone: "call" });
    expect(kindVisual("live")).toMatchObject({ word: "Under way", tone: "live" });
    expect(kindVisual("landed")).toMatchObject({ word: "Done", tone: "done" });
    expect(kindVisual("held")).toMatchObject({ word: "Held up", tone: "held" });
    expect(kindVisual("memory")).toMatchObject({ word: "Memory", tone: "memory" });
    expect(kindVisual("news")).toMatchObject({ word: "News", tone: "memory" });
    expect(kindVisual("next")).toMatchObject({ word: "Queued", tone: "quiet" });
  });

  it("draws every kind as a real icon, never an empty box", () => {
    for (const [kind, visual] of Object.entries(KIND_VISUALS)) {
      expect(visual.icon, kind).toMatch(/^M/);
      expect(visual.icon.length, kind).toBeGreaterThan(8);
    }
  });

  it("reads a kind it does not know as quiet, with no chip of its own", () => {
    expect(kindVisual("something-new")).toMatchObject({ word: "", tone: "quiet" });
    expect(kindVisual(undefined)).toMatchObject({ word: "", tone: "quiet" });
    expect(kindVisual("something-new").icon).toBe(kindVisual(undefined).icon);
  });
});
