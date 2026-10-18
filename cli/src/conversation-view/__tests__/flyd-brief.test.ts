import { describe, expect, it } from "vitest";
import type { Project } from "../../council/projects.js";
import { briefPrompt, flydBrief, projectNamed, type BriefSources } from "../flyd-brief.js";
import { interpretPrompt } from "../interpret.js";
import { routePrompt } from "../flyd-desk.js";

const SOURCES: BriefSources = {
  profile: "George runs Good Neighbours Market with Ana. He hates eyebrows above headlines.",
  memory: "## Decisions\n- The GNM hero stays one line on phones (2026-10-12).",
  project: { about: "Good Neighbours Market (gnm): the market's site — live; now: Christmas campaign", taste: "Good Neighbours Market:\n- Keep the hero to one line." },
};

const project = (name: string, id: string): Project => ({ id, name, what: "", kind: "venture", status: "active", now: "", people: [], repos: [] } as unknown as Project);

describe("Flyd's brief for firstmate", () => {
  it("asks Flyd, as chief of staff, for what only it knows: his history, his project, his taste, done, and its own call", () => {
    const prompt = briefPrompt("the GNM hero is too tall on phones", [], SOURCES);
    expect(prompt).toMatch(/^You are Flyd, George's chief of staff\. .*firstmate, the engineering lead on your staff/);
    expect(prompt).toContain("what done looks like to him");
    expect(prompt).toContain("what firstmate settles itself without asking him");
    expect(prompt).toContain("never invent a fact");
    expect(prompt).toContain("reply exactly NONE");
    for (const known of [SOURCES.profile!, SOURCES.memory, SOURCES.project!.about, SOURCES.project!.taste!]) expect(prompt).toContain(known);
    expect(prompt).toContain("George's words: the GNM hero is too tall on phones");
  });

  it("leaves out what it does not know", () => {
    const prompt = briefPrompt("fix the footer", [], { profile: null, memory: "" });
    expect(prompt).not.toMatch(/What you know about George|Your memory|The project he named|His taste/);
  });

  it("is Flyd's words, or nothing: never holding up his message", async () => {
    expect(await flydBrief("fix it", [], async () => "  The hero must stay one line; settle the CSS yourself.  ", { sources: SOURCES })).toBe("The hero must stay one line; settle the CSS yourself.");
    expect(await flydBrief("fix it", [], async () => "NONE", { sources: SOURCES })).toBeUndefined();
    expect(await flydBrief("fix it", [], async () => { throw new Error("no model"); }, { sources: SOURCES })).toBeUndefined();
    expect(await flydBrief("fix it", [], () => new Promise<string>(() => {}), { sources: SOURCES, timeoutMs: 10 })).toBeUndefined();
    expect(await flydBrief("   ", [], async () => "unused", { sources: SOURCES })).toBeUndefined();
  });

  it("finds the project his words name by his own name for it", () => {
    const projects = [project("Good Neighbours Market", "gnm"), project("Flyd", "flyd")];
    expect(projectNamed("the gnm hero is too tall", projects)?.id).toBe("gnm");
    expect(projectNamed("Good Neighbours Market footer", projects)?.id).toBe("gnm");
    expect(projectNamed("fix the island", projects)).toBeUndefined();
  });
});

describe("Flyd answering from what it knows", () => {
  it("keeps questions about where his work stands with Flyd", () => {
    expect(routePrompt("did the island fix land?", [])).toContain("Where his work stands (what is under way, what landed, what is waiting on him, what was decided) is Flyd's");
  });

  it("tells firstmate's answer as his chief of staff, with its own memory", () => {
    const prompt = interpretPrompt({ question: "is the hero fixed?", answer: "Merged.", recent: [] }, "George runs GNM.", "## Decisions\n- The GNM hero stays one line.");
    expect(prompt).toMatch(/^You are Flyd, George's chief of staff\. .*You own the outcome: judge the answer against what he asked and what you know of him/);
    expect(prompt).toContain("Your memory:\n## Decisions\n- The GNM hero stays one line.");
  });
});
