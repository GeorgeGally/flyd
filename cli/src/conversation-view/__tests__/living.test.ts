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

  it("puts the current step on the newest taken note only, and leaves answered ones alone", () => {
    const exchanges = livened(
      [note("a", "taken"), note("b", "taken", "the GNM footer"), note("c", "queued"), note("d", "taken", "x", true), { question: { id: "e", role: "user", text: "bkk?" }, waiting: ANSWERING }],
      { activity: "Run the tests" },
    );
    expect(exchanges.map((exchange) => exchange.waiting)).toEqual([WORKING, "Run the tests", WORKING, "", WORKING]);
  });
});
