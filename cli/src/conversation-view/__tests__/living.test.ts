import { describe, expect, it } from "vitest";
import { ANSWERING, handoffLine, livened, RECEIVED, WORKING } from "../living.js";
import type { Exchange } from "../types.js";

function note(id: string, handoff: Exchange["handoff"], text = "fix it", answered = false): Exchange {
  const question = { id, role: "user" as const, text };
  return { question, handoff, waiting: "", ...(answered ? { answer: { id: `${id}-r`, role: "assistant" as const, text: "Done, sir.", answers: id } } : {}) };
}

const HANDOFF = /firstmate|passing|is on it|one moment|let me check|got it|who should/i;

describe("the living line", () => {
  it("names the queue state without announcing routing or a handoff", () => {
    expect(RECEIVED).toBe(WORKING);
    expect(ANSWERING).toBe("Looking this up");
    expect(WORKING).toBe("Queued");
    expect(handoffLine("queued")).toBe("Queued for a next step");
    expect(handoffLine("taken")).toBe("Waiting for a clear next step");
    // A step only shows once the work has started, never while the note is still on its way.
    expect(handoffLine("queued", { activity: "Run the tests" })).toBe("Queued for a next step");
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
    expect(handoffLine("queued", { text: "set the timeout to 5s" })).toBe("Setting the timeout to 5s");
    expect(handoffLine("queued", { text: "the GNM hero is too tall", projects: ["GNM"] })).toBe("GNM: Queued for a next step");
  });

  it("never quotes his words back when they are not a task Flyd is doing", () => {
    expect(handoffLine("queued", { text: "what is usb overdrive?" })).toBe("Looking up usb overdrive");
    expect(handoffLine("queued", { text: "who's playing at art bangkok?" })).toBe("Queued for a next step");
    for (const text of ["what is the notch island doing wrong?", "Did you push it?", "can you deploy it?", "why did the build fail?", "is this normal?", "what is it?"]) {
      expect(handoffLine("queued", { text })).toBe("Queued for a next step");
    }
    expect(handoffLine("queued", { text: "the good neighbours market hero is too tall" })).toBe("Queued for a next step");
    for (const text of ["tell firstmate to fix the footer", "get the crew to land it", "/deploy staging", "can you show me the logs", "fix my site", "fix what I'm seeing on the island", "fix the bug I am seeing", "check what I've changed today", "update the copy we'll ship on our site", "/ce-code-review fix the branch", "fix it", "ok"]) {
      expect(handoffLine("queued", { text })).toBe("Queued for a next step");
    }
    expect(handoffLine("queued", { text: "fix the calendar", projects: [] })).not.toMatch(HANDOFF);
  });

  it("never puts firstmate's step on a note its turn did not pick up, and leaves answered ones alone", () => {
    // Firstmate busy shrinking a hero for another note: none of these notes gets that step as its line.
    const exchanges = livened(
      [note("a", "taken"), note("b", "taken", "the GNM footer"), note("c", "queued"), note("d", "taken", "x", true), { question: { id: "e", role: "user", text: "bkk?" }, waiting: ANSWERING }],
      { activity: "Shrinking hero on short screens, verify" },
    );
    expect(exchanges.map((exchange) => exchange.waiting)).toEqual(["Waiting for a clear next step", "Waiting for a clear next step", "Queued for a next step", "", "Looking this up"]);
  });

  it("keeps the running line under an outcome while work on that note carries on", () => {
    const settled = (id: string): Exchange => ({ question: { id, role: "user", text: "the hero is cut off" }, handoff: "taken", waiting: "I've logged it as a fix.", settled: true });
    const [crewed, turned, quiet] = livened([settled("note:a"), settled("note:b"), settled("note:c")], {
      steps: new Map([["note:a", "Measuring the hero on a short laptop"]]),
      activity: "Editing the styles",
      workingOn: ["note:b"],
    });
    expect(crewed).toMatchObject({ waiting: "I've logged it as a fix.", settled: true, doing: "Measuring the hero on a short laptop" });
    expect(turned).toMatchObject({ waiting: "I've logged it as a fix.", doing: "Editing the styles" });
    expect(quiet!.doing).toBeUndefined();
  });

  it("puts the crewmate's step on the note it is working on, and firstmate's own nowhere it did not pick up", () => {
    const note = (id: string, text: string): Exchange => ({ question: { id, role: "user", text }, handoff: "taken", waiting: WORKING });
    const steps = new Map([["note:a", "Checking how you like spacing"]]);
    const [a, b] = livened([note("note:a", "fix the header"), note("note:b", "fix the footer")], { steps, activity: "Running the tests" });
    expect(a!.waiting).toBe("Checking how you like spacing");
    expect(b!.waiting).toBe("Fixing the footer");
  });

  it("puts firstmate's own step on the notes its turn picked up, even before it files them", () => {
    const exchanges = livened([note("note:a", "taken", "the header"), note("note:b", "queued", "the map"), note("note:c", "queued", "the footer")], {
      activity: "Editing the styles",
      workingOn: ["note:b"],
    });
    expect(exchanges.map((exchange) => exchange.waiting)).toEqual(["Waiting for a clear next step", "Editing the styles", "Queued for a next step"]);
  });
});
