import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlydDesk } from "../flyd-desk.js";
import { answeringLine, handoffLine, livened } from "../living.js";
import { isPlaceholderStatus, relayStatus, statusFromTool } from "../status-text.js";
import type { Exchange } from "../types.js";

/** Every placeholder George was shown in the review, in the variants the model produced. */
const PLACEHOLDERS = [
  "Remembering what I know about this",
  "remembering what i know",
  "Looking this up",
  "Working on it",
  "Looking into it",
  "One moment",
];

describe("isPlaceholderStatus", () => {
  it("rejects every placeholder seen on his status line, whatever the case", () => {
    for (const text of PLACEHOLDERS) expect(isPlaceholderStatus(text), text).toBe(true);
  });

  it("keeps a status that names the concrete thing being done", () => {
    const concrete = [
      "Searching memory for Canva",
      "Checking my own setup",
      "Searching the web: gpt-realtime-2.1 release notes",
      "Drafting the email to Maya",
    ];
    for (const text of concrete) expect(isPlaceholderStatus(text), text).toBe(false);
  });

  it("builds a concrete status from the tool call under way", () => {
    expect(statusFromTool({ tool: "Searching memory for", argument: "Canva" })).toBe("Searching memory for Canva");
  });

  it("never builds a substitute that is itself a placeholder or names nothing", () => {
    expect(relayStatus("Looking into it", { tool: "Looking into", argument: "this" })).toBe("");
    expect(relayStatus("Looking into it", { tool: "Looking into", argument: "" })).toBe("");
    expect(relayStatus("Working on it")).toBe("");
  });
});

describe("the status line George is shown", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-status-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const aRelay = (question: string): { desk: FlydDesk; sent: { id: string }; step: (line: string, tool?: { tool: string; argument?: string }) => void } => {
    let step!: (line: string, tool?: { tool: string; argument?: string }) => void;
    const desk = new FlydDesk({ dir, answer: (_question, _history, onStep) => {
      step = onStep!;
      return new Promise<string>(() => {});
    } });
    const sent = desk.ask(question);
    return { desk, sent, step };
  };

  it("replaces a relayed placeholder with the concrete lookup under way", () => {
    const { desk, sent, step } = aRelay("what do you know about Canva");
    step("Remembering what I know about this", { tool: "Searching memory for", argument: "Canva" });
    const waiting = desk.exchanges().find((exchange) => exchange.question.id === sent.id)!.waiting;
    expect(waiting).toContain("Canva");
    expect(waiting).not.toBe("Remembering what I know about this");
    expect(isPlaceholderStatus(waiting)).toBe(false);
    // What was relayed and what he was shown instead are both kept, for Flyd's self-review.
    const file = readdirSync(dir).find((name) => name.endsWith(".json"))!;
    expect(JSON.parse(readFileSync(join(dir, file), "utf8")).statusSubstitutions).toEqual([
      { raw: "Remembering what I know about this", shown: "Searching memory for Canva" },
    ]);
  });

  it("keeps a concrete line, never the placeholder or his own words, when no tool call is known", () => {
    const { desk, sent, step } = aRelay("what did Maya say about Thursday");
    step("Looking into it");
    const waiting = desk.exchanges().find((exchange) => exchange.question.id === sent.id)!.waiting;
    expect(waiting).toBe("Reading your message");
  });

  it("opens on what his question asks about, never a placeholder, before any step is known", () => {
    const { desk, sent } = aRelay("what is Canva?");
    expect(desk.exchanges().find((exchange) => exchange.question.id === sent.id)!.waiting).toBe("Looking up Canva");
    expect(answeringLine("whats there to do in bkk tonight?")).toBe("Reading your message");
    expect(answeringLine("", true)).toBe("Looking at your screenshot");
    for (const text of ["", "this", "it", ...PLACEHOLDERS]) {
      expect(isPlaceholderStatus(answeringLine(text)), text).toBe(false);
      expect(isPlaceholderStatus(answeringLine(text, true)), text).toBe(false);
    }
  });

  it("keeps its concrete line when a placeholder arrives with nothing to build from", () => {
    const { desk, sent, step } = aRelay("this");
    const before = desk.exchanges().find((exchange) => exchange.question.id === sent.id)!.waiting;
    step("Looking into it");
    expect(desk.exchanges().find((exchange) => exchange.question.id === sent.id)!.waiting).toBe(before);
  });

  it("names the picked-up note's own work when firstmate's step is a placeholder", () => {
    const note: Exchange = { question: { id: "q1", role: "user", text: "fix the footer on GNM" }, waiting: "", handoff: "taken" };
    const [live] = livened([note], { activity: "Working on it", workingOn: ["q1"], projects: ["GNM"] });
    expect(live!.waiting).toBe("Fixing the footer on GNM");
  });

  it("living.ts never renders a placeholder as its living line", () => {
    for (const text of PLACEHOLDERS) {
      const taken = handoffLine("taken", { activity: text });
      expect(isPlaceholderStatus(taken), `${text} -> ${taken}`).toBe(false);
      const note: Exchange = { question: { id: "q1", role: "user", text: "fix the footer on GNM" }, waiting: "", handoff: "taken" };
      const [live] = livened([note], { activity: text, workingOn: ["q1"] });
      expect(isPlaceholderStatus(live!.waiting), `${text} -> ${live!.waiting}`).toBe(false);
    }
  });
});
