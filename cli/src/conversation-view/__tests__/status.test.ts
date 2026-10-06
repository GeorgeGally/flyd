import { describe, expect, it } from "vitest";
import { asksForDecision, headlineOf, statusOf } from "../status.js";

describe("conversation status for the island", () => {
  it("leads with the reply's own » summary, else its first sentence, kept short", () => {
    expect(headlineOf("» Menu bar fixed and pushed.\n\nDetails…")).toBe("Menu bar fixed and pushed.");
    expect(headlineOf("Captain, the stats are centred. Also pushed.")).toBe("Captain, the stats are centred.");
    const long = headlineOf(`» ${"The deals page now loads the newest twelve deals first and pages the rest in ".repeat(2)}`);
    expect(long.length).toBeLessThanOrEqual(73);
    expect(long.endsWith("…")).toBe(true);
  });

  it("knows when a reply needs the captain's decision", () => {
    expect(asksForDecision("Done.\n\nDo you want me to push it?")).toBe(true);
    expect(asksForDecision("» Two options for the hero — your call.\n\n- A\n- B")).toBe(true);
    expect(asksForDecision("I can keep a minimum size on phones. Should I?")).toBe(true);
    expect(asksForDecision("Pushed.\n\n```js\nif (x?.y) {}\n```\n\nAll green.")).toBe(false);
    expect(asksForDecision("The stats are centred and committed.")).toBe(false);
  });

  it("is working only while the turn is open and recently active, and names the newest reply", () => {
    const now = Date.parse("2026-10-06T03:00:00Z");
    const messages = [
      { id: "u1", role: "user" as const, text: "hi" },
      { id: "r1", role: "assistant" as const, text: "» Pushed. Want me to merge?" },
    ];
    expect(statusOf({ messages, working: true, lastActivity: "2026-10-06T02:59:00Z" }, now)).toEqual({
      working: true,
      lastActivity: "2026-10-06T02:59:00Z",
      reply: { id: "r1", headline: "Pushed. Want me to merge?", asks: true },
    });
    expect(statusOf({ messages, working: true, lastActivity: "2026-10-06T02:00:00Z" }, now).working).toBe(false);
    expect(statusOf({ messages: [], working: false }, now)).toEqual({ working: false });
  });
});
