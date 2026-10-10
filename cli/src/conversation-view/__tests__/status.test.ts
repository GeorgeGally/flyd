import { describe, expect, it } from "vitest";
import { asksForDecision, headlineOf, statusOf } from "../status.js";
import { ABOUT_FIXES } from "./fixtures/replies.js";

describe("conversation status for the island", () => {
  it("leads with the reply's own » summary, else its first sentence without the salutation, kept short", () => {
    expect(headlineOf("» Menu bar fixed and pushed.\n\nDetails…")).toBe("Menu bar fixed and pushed.");
    expect(headlineOf("Captain, the stats are centred. Also pushed.")).toBe("The stats are centred.");
    expect(headlineOf("Captain, agreed. Today Flyd's profile of you misses your design taste.")).toBe("Today Flyd's profile of you misses your design taste.");
    const long = headlineOf(`» ${"The deals page now loads the newest twelve deals first and pages the rest in ".repeat(2)}`);
    expect(long.length).toBeLessThanOrEqual(73);
    expect(long.endsWith("…")).toBe(true);
  });

  it("names every part of a numbered report, not just its opening line", () => {
    expect(headlineOf(ABOUT_FIXES)).toBe("Why CapFive cards · Leadership · Board pop-up on short phones");
  });

  it("stays quiet about routine replies: the island keeps the last reply that mattered", () => {
    const messages = [
      { id: "r1", role: "assistant" as const, text: ABOUT_FIXES },
      { id: "u2", role: "user" as const, text: "thanks" },
      { id: "r2", role: "assistant" as const, text: "Captain, shipshape." },
    ];
    expect(statusOf({ messages, working: false })?.reply?.id).toBe("r1");
  });

  it("says what is happening only to his newest message, never an older one left waiting", () => {
    const messages = [
      { id: "u1", role: "user" as const, text: "check the deploy", waiting: "Flyd was interrupted before answering; send it again" },
      { id: "u2", role: "user" as const, text: "what's the weather?" },
      { id: "r2", role: "assistant" as const, text: "Sunny all day." },
    ];
    expect(statusOf({ messages, working: false }).waiting).toBeUndefined();
    const pending = [...messages, { id: "u3", role: "user" as const, text: "and tomorrow?", waiting: "Answering" }];
    expect(statusOf({ messages: pending, working: false }).waiting).toEqual({ id: "u3", text: "Answering" });
    const failed = [...messages, { id: "u3", role: "user" as const, text: "and tomorrow?", waiting: "Flyd couldn't answer this: offline", waitingFailed: true }];
    expect(statusOf({ messages: failed, working: false }).waiting).toEqual({ id: "u3", text: "Flyd couldn't answer this: offline", failed: true });
  });

  it("names what the assistant is doing only while it works", () => {
    const now = Date.parse("2026-10-06T03:00:00Z");
    const snapshot = { messages: [], working: true, activity: "Dispatching a crewmate", lastActivity: "2026-10-06T02:59:00Z" };
    expect(statusOf(snapshot, now).activity).toBe("Dispatching a crewmate");
    expect(statusOf({ ...snapshot, working: false }, now).activity).toBeUndefined();
  });

  it("knows when a reply needs the captain's decision", () => {
    expect(asksForDecision("Done.\n\nDo you want me to push it?")).toBe(true);
    expect(asksForDecision("» Two options for the hero — your call.\n\n- A\n- B")).toBe(true);
    expect(asksForDecision("I can keep a minimum size on phones. Should I?")).toBe(true);
    expect(asksForDecision("Pushed.\n\n```js\nif (x?.y) {}\n```\n\nAll green.")).toBe(false);
    expect(asksForDecision("The stats are centred and committed.")).toBe(false);
    expect(asksForDecision('Four Flyd changes in one batch.\n\nSay "go" and one worker builds them.')).toBe(true);
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
