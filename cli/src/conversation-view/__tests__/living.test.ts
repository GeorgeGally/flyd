import { describe, expect, it } from "vitest";
import { ANSWERING, handoffLine, livened, RECEIVED, WORKING } from "../living.js";
import type { Exchange } from "../types.js";

function note(id: string, handoff: Exchange["handoff"], text = "fix it", answered = false): Exchange {
  const question = { id, role: "user" as const, text };
  return { question, handoff, waiting: "", ...(answered ? { answer: { id: `${id}-r`, role: "assistant" as const, text: "Done, sir.", answers: id } } : {}) };
}

const HANDOFF = /firstmate|passing|is on it|one moment|let me check|got it|who should/i;

describe("the living line", () => {
  it("never announces routing or a handoff, only that the work is under way", () => {
    expect(RECEIVED).toBe(WORKING);
    expect(ANSWERING).toBe(WORKING);
    expect(WORKING).toBe("Working on it");
    expect(handoffLine("queued")).toBe(WORKING);
    expect(handoffLine("taken")).toBe(WORKING);
    // A step only shows once the work has started, never while the note is still on its way.
    expect(handoffLine("queued", { activity: "Run the tests" })).toBe(WORKING);
    for (const line of [RECEIVED, ANSWERING, handoffLine("queued"), handoffLine("taken")]) expect(line).not.toMatch(HANDOFF);
  });

  it("says the step itself when firstmate's current step is known", () => {
    expect(handoffLine("taken", { activity: "Run the tests." })).toBe("Run the tests");
    expect(handoffLine("taken", { activity: "fixing the calendar" })).toBe("Fixing the calendar");
    expect(handoffLine("taken", { activity: "PR checks are running" })).toBe("PR checks are running");
    expect(handoffLine("taken", { activity: "word ".repeat(40) }).length).toBeLessThan(120);
  });

  it("says what the message asks for, with the project he named, before any step is known", () => {
    expect(handoffLine("queued", { text: "can you fix the footer on the GNM site?" })).toBe("Fixing the footer on the GNM site");
    expect(handoffLine("queued", { text: "Please add a dark mode toggle", projects: ["Flyd", "GNM"] })).toBe("Adding a dark mode toggle");
    expect(handoffLine("queued", { text: "update the footer copy. GNM needs it by Friday", projects: ["GNM"] })).toBe("GNM: Updating the footer copy")
    expect(handoffLine("queued", { text: "fix the footer on GNM", projects: ["GNM"] })).toBe("Fixing the footer on GNM");
    expect(handoffLine("queued", { text: "can you show me the logs" })).toBe("Showing you the logs");
    expect(handoffLine("queued", { text: "fix my site" })).toBe("Fixing your site");
    expect(handoffLine("queued", { text: "set the timeout to 5s" })).toBe("Setting the timeout to 5s");
    expect(handoffLine("queued", { text: "the GNM hero is too tall", projects: ["GNM"] })).toBe("GNM: Working on it");
  });

  it("never quotes his words back when they are not a task Flyd is doing", () => {
    expect(handoffLine("queued", { text: "what is the notch island doing wrong?" })).toBe(WORKING);
    expect(handoffLine("queued", { text: "the good neighbours market hero is too tall" })).toBe(WORKING);
    expect(handoffLine("queued", { text: "tell firstmate to fix the footer" })).toBe(WORKING);
    expect(handoffLine("queued", { text: "get the crew to land it" })).toBe(WORKING);
    expect(handoffLine("queued", { text: "/deploy staging" })).toBe(WORKING);
    expect(handoffLine("queued", { text: "/ce-code-review fix the branch" })).toBe(WORKING);
    expect(handoffLine("queued", { text: "fix it" })).toBe(WORKING);
    expect(handoffLine("queued", { text: "ok" })).toBe(WORKING);
    expect(handoffLine("queued", { text: "fix the calendar", projects: [] })).not.toMatch(HANDOFF);
  });

  it("puts the current step on the newest taken note only, and leaves answered ones alone", () => {
    const exchanges = livened(
      [note("a", "taken"), note("b", "taken", "the GNM footer"), note("c", "queued"), note("d", "taken", "x", true), { question: { id: "e", role: "user", text: "bkk?" }, waiting: ANSWERING }],
      { activity: "Run the tests" },
    );
    expect(exchanges.map((exchange) => exchange.waiting)).toEqual([WORKING, "Run the tests", WORKING, "", WORKING]);
  });
});
