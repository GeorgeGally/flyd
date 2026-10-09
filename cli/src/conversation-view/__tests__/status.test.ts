import { describe, expect, it } from "vitest";
import { asksForDecision, headlineOf, statusOf, worthAnnouncing } from "../status.js";

describe("conversation status for the island", () => {
  it("leads with the reply's own » summary, else its first sentence, kept short", () => {
    expect(headlineOf("» Menu bar fixed and pushed.\n\nDetails…")).toBe("Menu bar fixed and pushed.");
    expect(headlineOf("Captain, the stats are centred. Also pushed.")).toBe("The stats are centred.");
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
      { id: "u2", role: "user" as const, text: "yes" },
    ];
    expect(statusOf({ messages, working: true, lastActivity: "2026-10-06T02:59:00Z" }, now)).toEqual({
      working: true,
      lastActivity: "2026-10-06T02:59:00Z",
      reply: { id: "r1", headline: "Pushed. Want me to merge?", asks: true },
    });
    expect(statusOf({ messages, working: true, lastActivity: "2026-10-06T02:00:00Z" }, now).working).toBe(false);
    expect(statusOf({ messages: [], working: false }, now)).toEqual({ working: false });
  });

  it("keeps firstmate's own supervision chatter off the island", () => {
    // Real replies firstmate made to its own wakes, from the captain's island log.
    for (const chatter of [
      "Captain, shipshape.",
      "Captain, shipshape. The Flyd worker received the decision and is moving on through the remaining checks.",
      "Captain, the Flyd island worker has posted an update. I'm reading it now and will report shortly.",
      "Captain, no news yet. The Flyd worker's update just confirmed it received my decision on the screenshots.",
      "Captain, I settled one review question on the Flyd island work myself.",
    ]) {
      expect(worthAnnouncing(chatter, false), chatter).toBe(false);
    }
  });

  it("announces a finished result firstmate reports on its own, but not a promise of one", () => {
    expect(worthAnnouncing("Captain, the island noise is fixed and pushed to main.", false)).toBe(true);
    expect(worthAnnouncing("Captain, the Flyd island work is moving again. It has passed review, tests, docs and lint, and has been pushed.", false)).toBe(true);
    expect(worthAnnouncing("Captain, shipshape. The banner fix is pushed.", false)).toBe(true);
    expect(worthAnnouncing("Captain, shipshape. This alert was for the old Flyd worker; its pull request, https://github.com/GeorgeGally/flyd/pull/56 , is still waiting.", false)).toBe(true);
    expect(worthAnnouncing("On it — will report once it's fixed.", false)).toBe(false);
    expect(worthAnnouncing("Captain, the worker is on the banner; I'll tell you when it's pushed.", false)).toBe(false);
  });

  it("keeps firstmate's talk about its crew quiet unless it carries a PR, a problem or a decision", () => {
    for (const chatter of [
      "Captain, the Flyd worker has finished its first pass and is now on the review step.",
      "Captain, the crewmate updated its plan.",
      "Captain, shipshape. The worker added the brief.",
      "Captain, the worker fixed and pushed the banner.",
    ]) {
      expect(worthAnnouncing(chatter, false), chatter).toBe(false);
    }
    expect(worthAnnouncing("Captain, the worker finished: https://github.com/GeorgeGally/flyd/pull/70 is ready for your review.", false)).toBe(true);
    expect(worthAnnouncing("Captain, the worker's checks failed on the banner.", false)).toBe(true);
    expect(worthAnnouncing("Captain, the worker finished the banner. Should I merge it?", false)).toBe(true);
  });

  it("announces decisions, outcomes and real problems, even unprompted", () => {
    expect(worthAnnouncing("Captain, the Flyd island redesign is ready for your review: https://github.com/GeorgeGally/flyd/pull/68", false)).toBe(true);
    expect(worthAnnouncing("Captain, your Mac is now badly overloaded: the load is about 416.", false)).toBe(true);
    expect(worthAnnouncing("Captain, one older piece of work was stuck: its checks passed but no pull request opened.", false)).toBe(true);
    expect(worthAnnouncing("Two ways to fix the banner. Which one do you want?", false)).toBe(true);
  });

  it("announces answers to George's own words unless they are routine", () => {
    expect(worthAnnouncing("Captain, your local Flyd copy is updated with the 30 new commits.", true)).toBe(true);
    expect(worthAnnouncing("Captain, shipshape.", true)).toBe(false);
    expect(worthAnnouncing("Captain, a worker is now on the Flyd fixes: it will trace the island noise.", true)).toBe(false);
  });

  it("names the newest reply worth announcing, and works only on George's turn", () => {
    const now = Date.parse("2026-10-09T02:00:00Z");
    const active = { working: true, lastActivity: "2026-10-09T01:59:30Z" };
    const messages = [
      { id: "u1", role: "user" as const, text: "pull and verify" },
      { id: "r1", role: "assistant" as const, text: "Captain, your local Flyd copy is updated." },
      { id: "r2", role: "assistant" as const, text: "Captain, shipshape." },
      { id: "r3", role: "assistant" as const, text: "Captain, the Flyd island worker has posted an update." },
    ];
    const quiet = statusOf({ messages, ...active }, now);
    expect(quiet.reply?.id).toBe("r1");
    expect(quiet.working).toBe(false);
    expect(statusOf({ messages: [...messages, { id: "u2", role: "user", text: "fix it" }], ...active }, now).working).toBe(true);
    expect(statusOf({ messages: [...messages.slice(0, 1)], ...active }, now).working).toBe(true);
    expect(statusOf({ messages: messages.slice(0, 2), ...active }, now).working).toBe(false);
  });
});
