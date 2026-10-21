import { describe, expect, it } from "vitest";
import { asksForDecision, forCaptain, headlineOf, islandStatusOf, statusOf } from "../status.js";
import { parseBearings } from "../artefact.js";
import { ABOUT_FIXES, PHANTOM_NOTICES, STAFF_LANDED, STAFF_PROGRESS } from "./fixtures/replies.js";

describe("conversation status for the island", () => {
  it("keeps job chatter off the island and rings only for a decision or notable result", () => {
    const current = statusOf({
      messages: [{ id: "a", role: "assistant", text: "The requested lookup is finished." }],
      working: true,
      activity: "Reading worker status from run 01M5",
    });
    const askFleet = parseBearings({ decisions_open: [{ id: "launch", summary: "Choose the launch date" }] });
    const ask = islandStatusOf(current, { ...askFleet, calls: [{ label: "Move launch or keep the date?", task: "launch", question: "Move launch or keep the date?", choices: ["Move launch", "Keep the date"] }] });
    expect(ask.reply).toEqual({ id: "decision:launch", headline: "Move launch or keep the date?", asks: true });
    expect(ask.activity).toBeUndefined();

    const ordinary = islandStatusOf(current, parseBearings({ in_flight: [{ id: "w", state: "working", name: "Build Flyd", doing: "checking tests" }] }));
    expect(ordinary.reply).toBeUndefined();
    expect(ordinary.activity).toBeUndefined();

    const notableFleet = parseBearings({ landed: [{ id: "result", what: "The release is verified" }] });
    const notable = islandStatusOf(current, { ...notableFleet, landed: [{ label: "The release is verified", task: "result", status: "verified", notable: true }] });
    expect(notable.reply).toEqual({ id: "outcome:result", headline: "The release is verified", asks: false });
  });

  it("keeps Flyd's answer to his own question and a failed send of his message on the island", () => {
    const answered = islandStatusOf({ working: false, reply: { id: "answer:1", headline: "Your flight leaves at nine.", asks: false } });
    expect(answered.reply).toEqual({ id: "answer:1", headline: "Your flight leaves at nine.", asks: false });
    const failed = islandStatusOf({ working: false, waiting: { id: "ask:2", text: "Could not send", failed: true } });
    expect(failed.waiting).toEqual({ id: "ask:2", text: "Could not send", failed: true });
    expect(islandStatusOf({ working: false, waiting: { id: "ask:3", text: "Queued" } }).waiting).toBeUndefined();
    expect(islandStatusOf({ working: false, reply: { id: "staff-1", headline: "Worker paused", asks: false } }).reply).toBeUndefined();
  });

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
    const pending = [...messages, { id: "u3", role: "user" as const, text: "and tomorrow?", waiting: "Working on it" }];
    expect(statusOf({ messages: pending, working: false }).waiting).toEqual({ id: "u3", text: "Working on it" });
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
    expect(statusOf({ messages: [{ id: "r1", role: "assistant", text: "Sir, the menu bar fix is merged.\n\nWant me to ship the island next?" }], working: false }).reply)
      .toMatchObject({ headline: "Want me to ship the island next?", asks: true });
    expect(asksForDecision("Pushed.\n\n```js\nif (x?.y) {}\n```\n\nAll green.")).toBe(false);
    expect(asksForDecision("The stats are centred and committed.")).toBe(false);
    expect(asksForDecision('Four Flyd changes in one batch.\n\nSay "go" and one worker builds them.')).toBe(true);
    expect(asksForDecision("Two pages landed.\n\nApprove the apply page and I'll merge it.")).toBe(true);
    expect(forCaptain("Captain, approve the apply page and I'll merge it.", new Set())).toBe(true);
    expect(asksForDecision("Sir, decide which hero we ship.")).toBe(true);
    expect(asksForDecision("» Docs landed.\n\nApprove the apply page and I'll merge it.\n\nAll checks are green.")).toBe(true);
    expect(asksForDecision("Sir, updates.\n\nWant me to ship the island?\n\n- Menu bar is merged.\n- Docs are merged.")).toBe(false);
    expect(headlineOf("- Menu bar fix is merged. Approve the island next.\n- Docs are merged.")).toBe("Approve the island next, plus 1 more");
    expect(statusOf({ messages: [{ id: "r7", role: "assistant", text: "- Menu bar fix is merged. Waiting on you for the island.\n- Docs are merged." }], working: false }).reply)
      .toMatchObject({ headline: "Waiting on you for the island, plus 1 more", asks: true });
    expect(headlineOf("- Island fix is merged, so the apply page is blocked.\n- Docs are merged.")).toBe("The apply page is blocked, plus 1 more");
    const plan = "- Island fix is merged; I'll approve the follow-up once green.\n- Docs are merged.";
    expect(statusOf({ messages: [{ id: "r8", role: "assistant", text: plan }], working: false }).reply).toMatchObject({ asks: false });
    expect(forCaptain(plan, new Set())).toBe(false);
    expect(headlineOf("- Island fix is merged, so the apply page is blocked. Approve the island next.\n- Docs are merged.")).toBe("The apply page is blocked, plus 1 more");
    expect(headlineOf(`- ${"The deals page now loads the newest twelve deals first and pages the rest in. ".repeat(4)}Approve the island next.\n- Docs are merged.`)).toBe("Approve the island next, plus 1 more");
    expect(statusOf({ messages: [{ id: "r9", role: "assistant", text: `» ${"The deals page now loads the newest twelve deals first and pages the rest in. ".repeat(2)}Want me to ship it?` }], working: false }).reply)
      .toMatchObject({ headline: "Want me to ship it?", asks: true });
    expect(forCaptain("Stale wake on the deals page. Was it the old timer? Yes, nothing to do.", new Set())).toBe(false);
    expect(forCaptain("Holding the bump until CI is green, then I'll approve it.", new Set())).toBe(false);
    expect(asksForDecision("Sir, the menu bar landed.\n\nDo you want the island next?\n\nThe docs are updated.")).toBe(false);
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
      reply: { id: "r1", headline: "Want me to merge?", asks: true },
    });
    expect(statusOf({ messages, working: true, lastActivity: "2026-10-06T02:00:00Z" }, now).working).toBe(false);
    expect(statusOf({ messages: [], working: false }, now)).toEqual({ working: false });
  });
});

describe("the island and his staff's chatter", () => {
  it("never names a progress report Flyd keeps, and names a landing by its one line", () => {
    const quiet = statusOf({ messages: [{ id: "t1", role: "assistant", text: STAFF_PROGRESS, aside: true }], working: false });
    expect(quiet.reply).toBeUndefined();
    const landed = statusOf({ messages: [{ id: "t0", role: "assistant", text: STAFF_LANDED, aside: true }, { id: "t1", role: "assistant", text: STAFF_PROGRESS, aside: true }], working: false });
    expect(landed.reply).toEqual({ id: "t0", headline: "The island text fix is merged", asks: false });
  });
});

describe("a decision on the island is named in plain words", () => {
  it("never turns a quoted notice into his decision", () => {
    // The island read 'YOUR DECISION: "Claude: waiting on your input", plus 1 more'.
    const quoted = statusOf({ messages: [{ id: "a", role: "assistant", text: PHANTOM_NOTICES }], working: false });
    expect(quoted.reply?.asks).toBe(false);
    expect(quoted.reply?.headline).not.toMatch(/waiting on your input|Needs your decision/);
    // Relayed from the staff, it is chatter Flyd keeps: nothing on the island at all.
    expect(statusOf({ messages: [{ id: "a", role: "assistant", text: PHANTOM_NOTICES, aside: true }], working: false }).reply).toBeUndefined();
  });
});

describe("a decision already answered or done never rings the island", () => {
  it("does not raise the clean-up question again once he said yes and it was done", () => {
    const asked = "Sir, still waiting on you: may I delete the 44,148 test-junk records from Flyd's memory? A backup is taken first.";
    const done = "Done: the test junk is gone from Flyd's memory. That's 44,148 records deleted, leaving 54,997 real ones, and a backup is kept.";
    const snapshot = { messages: [
      { id: "t1", role: "assistant" as const, text: asked, aside: true },
      { id: "t2", role: "assistant" as const, text: asked.replace("Sir, ", "Sir, shipshape. "), aside: true },
      { id: "note:9", role: "user" as const, text: "Yes, delete the junk." },
      { id: "t3", role: "assistant" as const, text: done, aside: true },
    ], working: false };
    expect(statusOf(snapshot).reply).toMatchObject({ id: "t3", asks: false });
    // Even with the outcome missing, the answered question is not his decision any more.
    expect(statusOf({ ...snapshot, messages: snapshot.messages.slice(0, 3) }).reply?.asks ?? false).toBe(false);
  });
});
