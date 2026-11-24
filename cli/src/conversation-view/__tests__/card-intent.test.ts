import { describe, expect, it } from "vitest";
import { cardIntentOf } from "../card-intent.js";

describe("what makes a chat item a card", () => {
  it("is nothing for a plain reply: it has no words to read, only what it carries", () => {
    expect(cardIntentOf({ role: "assistant" })).toBeUndefined();
    expect(cardIntentOf({ role: "assistant", shots: [] })).toBeUndefined();
  });

  it("is a decision only for a question with answer buttons", () => {
    expect(cardIntentOf({ role: "assistant", choice: { options: ["Yes", "No"] } })).toBe("decision");
    expect(cardIntentOf({ role: "assistant", choice: { options: [], steps: [{ question: "Push it?", options: ["Yes", "No"] }] } })).toBe("decision");
    // Asked so only his own words can answer: no buttons, so it stays a message with its answer box.
    expect(cardIntentOf({ role: "assistant", choice: { options: [] } })).toBeUndefined();
  });

  it("is a result for finished work with its picture or the page it changed", () => {
    expect(cardIntentOf({ role: "assistant", shots: ["/tmp/shot.png"] })).toBe("result");
    expect(cardIntentOf({ role: "assistant", page: { url: "http://127.0.0.1:4000/" } })).toBe("result");
  });

  it("is never his own words, nor an answer whose shape Flyd chose", () => {
    expect(cardIntentOf({ role: "user", shots: ["/tmp/shot.png"], choice: { options: ["Yes"] } })).toBeUndefined();
    expect(cardIntentOf({ role: "assistant", form: { kind: "table" }, shots: ["/tmp/shot.png"] })).toBeUndefined();
  });
});
