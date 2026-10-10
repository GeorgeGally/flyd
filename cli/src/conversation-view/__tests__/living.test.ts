import { describe, expect, it } from "vitest";
import { ANSWERING, handoffLine, livened, projectNamed, RECEIVED } from "../living.js";
import type { Exchange } from "../types.js";

const PROJECTS = [{ name: "GNM (Good Neighbours Market)" }, { name: "Flyd" }, { name: "Capfive client work" }, { name: "DIR (Dead Internet Radio)" }];

function note(id: string, handoff: Exchange["handoff"], text = "fix it", answered = false): Exchange {
  const question = { id, role: "user" as const, text };
  return { question, handoff, waiting: "", ...(answered ? { answer: { id: `${id}-r`, role: "assistant" as const, text: "Done, sir.", answers: id } } : {}) };
}

describe("the living line", () => {
  it("says plainly where a message stands, in one short line", () => {
    expect(RECEIVED).not.toMatch(/\n/);
    expect(ANSWERING).toBe("Answering");
    expect(handoffLine("queued")).toBe("Passing this to firstmate");
    expect(handoffLine("queued", { project: "Good Neighbours Market" })).toBe("Passing this to firstmate - Good Neighbours Market");
    expect(handoffLine("taken")).toBe("Firstmate is on it");
    expect(handoffLine("taken", { project: "Flyd", activity: "Run the tests." })).toBe("Firstmate is on it: run the tests");
    expect(handoffLine("taken", { activity: "PR checks are running" })).toBe("Firstmate is on it: PR checks are running");
    expect(handoffLine("taken", { activity: "word ".repeat(40) }).length).toBeLessThan(120);
  });

  it("names a project only when his own words name exactly one", () => {
    expect(projectNamed("the good neighbours market hero is too tall", PROJECTS)).toBe("Good Neighbours Market");
    expect(projectNamed("GNM: the footer", PROJECTS)).toBe("GNM");
    expect(projectNamed("flyd's island", PROJECTS)).toBe("Flyd");
    expect(projectNamed("flydish things", PROJECTS)).toBeUndefined();
    expect(projectNamed("move the GNM footer like flyd's", PROJECTS)).toBeUndefined();
    expect(projectNamed("what is the weather", PROJECTS)).toBeUndefined();
    // An acronym counts only as he capitalised it.
    expect(projectNamed("which dir is it in", PROJECTS)).toBeUndefined();
  });

  it("puts firstmate's current step on the newest taken note only, and leaves answered ones alone", () => {
    const exchanges = livened(
      [note("a", "taken"), note("b", "taken", "the GNM footer"), note("c", "queued"), note("d", "taken", "x", true), { question: { id: "e", role: "user", text: "bkk?" }, waiting: ANSWERING }],
      { activity: "Run the tests", projectOf: (text) => projectNamed(text, PROJECTS) },
    );
    expect(exchanges.map((exchange) => exchange.waiting)).toEqual(["Firstmate is on it", "Firstmate is on it: run the tests", "Passing this to firstmate", "", ANSWERING]);
  });
});
