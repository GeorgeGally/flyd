import { describe, expect, it } from "vitest";
import { cardIntentOf } from "../card-intent.js";

describe("what makes a chat item a card", () => {
  it("is nothing for a plain reply: it has no words to read, only what it carries", () => {
    expect(cardIntentOf({ role: "assistant" })).toBeUndefined();
    expect(cardIntentOf({ role: "assistant", shots: [], landed: true })).toBeUndefined();
  });

  it("is never a screenshot the turn only looked at", () => {
    expect(cardIntentOf({ role: "assistant", shots: ["/tmp/shot.png"] })).toBeUndefined();
  });

  it("is a result for finished work: the page it changed, or a picture of what landed", () => {
    expect(cardIntentOf({ role: "assistant", page: { url: "http://127.0.0.1:4000/" } })).toBe("result");
    expect(cardIntentOf({ role: "assistant", shots: ["/tmp/shot.png"], landed: true })).toBe("result");
  });

  it("is never his own words, nor an answer whose shape Flyd chose", () => {
    expect(cardIntentOf({ role: "user", page: { url: "http://127.0.0.1:4000/" } })).toBeUndefined();
    expect(cardIntentOf({ role: "assistant", form: { kind: "table" }, page: { url: "http://127.0.0.1:4000/" } })).toBeUndefined();
  });
});
