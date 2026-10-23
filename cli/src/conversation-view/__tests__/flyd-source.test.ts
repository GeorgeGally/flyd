import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlydConversationSource } from "../flyd-source.js";
import { FlydDesk } from "../flyd-desk.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("Flyd's standalone conversation source", () => {
  it("gives each window its own conversation and lists the others newest first by their own identity", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-history-"));
    const contexts: Array<{ question: string; history: Array<{ role: string; content: string }> }> = [];
    const desk = new FlydDesk({
      dir,
      answer: async (question, history, _onStep, turn) => {
        contexts.push({ question, history });
        turn?.onUnderstanding({ version: "conversational-presence.v1", route: "answer", source: "room", project: question.includes("Flyd") ? "Flyd" : null });
        return `Answer: ${question}`;
      },
    });
    const source = new FlydConversationSource({ desk });
    expect(source.newSession("window:first-window")).toMatchObject({ id: "window:first-window" });
    expect(source.newSession("conversation")).toBeUndefined();
    expect((await source.read("window:first-window")).messages).toEqual([]);

    await source.send("window:first-window", "First Flyd question");
    await vi.waitFor(async () => expect((await source.read("window:first-window")).messages.at(-1)?.role).toBe("assistant"));
    await source.send("window:second-window", "A general question");
    await vi.waitFor(async () => expect((await source.read("window:second-window")).messages.at(-1)?.role).toBe("assistant"));
    await source.send("window:second-window", "And the second part?");
    await vi.waitFor(async () => expect((await source.read("window:second-window")).messages.at(-1)?.role).toBe("assistant"));

    expect((await source.listSessions()).map((session) => [session.id, session.title, session.project])).toEqual([
      ["window:second-window", "A general question", undefined],
      ["window:first-window", "First Flyd question", "Flyd"],
    ]);
    expect((await source.read("window:second-window")).messages.map((message) => message.text)).toEqual([
      "A general question", "Answer: A general question", "And the second part?", "Answer: And the second part?",
    ]);

    await source.send("window:first-window", "Continue that Flyd question");
    await vi.waitFor(async () => expect((await source.read("window:first-window")).messages.at(-1)?.text).toBe("Answer: Continue that Flyd question"));
    expect(contexts.at(-1)?.history).toContainEqual({ role: "user", content: "First Flyd question" });
    expect((await source.read("window:first-window")).messages.map((message) => message.text)).toEqual([
      "First Flyd question", "Answer: First Flyd question", "Continue that Flyd question", "Answer: Continue that Flyd question",
    ]);
    await expect(source.send("conversation", "the old single thread")).rejects.toThrow("No such Flyd conversation");
  });

  it("splits the old single thread by calendar day, each day titled by its first message and date", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-legacy-"));
    const ask = (id: string, at: Date, text: string, sessionId?: string) => writeFileSync(join(dir!, `${id}.json`), JSON.stringify({
      id, at: at.toISOString(), text, answer: `Answer: ${text}`, answeredAt: at.toISOString(), ...(sessionId ? { sessionId } : {}),
    }));
    ask("a1", new Date(2026, 9, 20, 9), "Morning plans");
    ask("a2", new Date(2026, 9, 20, 22), "Evening follow-up", "conversation");
    ask("a3", new Date(2026, 9, 21, 8), "Next day question");
    const source = new FlydConversationSource({ desk: new FlydDesk({ dir, answer: async () => "unused" }) });

    expect((await source.listSessions()).map((session) => [session.id, session.title])).toEqual([
      ["day:2026-10-21", "Next day question · 21 Oct 2026"],
      ["day:2026-10-20", "Morning plans · 20 Oct 2026"],
    ]);
    expect((await source.read("day:2026-10-20")).messages.map((message) => message.text)).toEqual([
      "Morning plans", "Answer: Morning plans", "Evening follow-up", "Answer: Evening follow-up",
    ]);
  });

  it("keeps a Flyd question and its own answer in a live session", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-source-"));
    let finishAnswer: (answer: string) => void = () => undefined;
    const answer = new Promise<string>((resolve) => { finishAnswer = resolve; });
    const afterTurn = vi.fn();
    const desk = new FlydDesk({
      dir,
      answer: async () => answer,
      afterTurn,
    });
    const source = new FlydConversationSource({ desk, pollMs: 5 });
    const updates: string[] = [];
    const follower = source.follow("window:live-window", (snapshot) => updates.push(JSON.stringify(snapshot)));
    const sent = await source.send("window:live-window", "what should I do next?");

    expect(source.assistantLabel).toBe("Flyd");
    expect(source.canSend).toBe(true);
    expect(sent.id).toMatch(/^ask:/);
    await vi.waitFor(async () => {
      const snapshot = await source.read("window:live-window");
      expect(snapshot.working).toBe(true);
      expect(snapshot.messages).toContainEqual(expect.objectContaining({ role: "user", text: "what should I do next?" }));
    });
    finishAnswer("I can help with the next step.");
    await vi.waitFor(async () => expect((await source.read("window:live-window")).messages)
      .toContainEqual(expect.objectContaining({ role: "assistant", text: "I can help with the next step." })));
    expect(afterTurn).toHaveBeenCalledWith({
      sessionId: "window:live-window",
      user: "what should I do next?",
      assistant: "I can help with the next step.",
    });
    expect(updates.length).toBeGreaterThan(1);
    follower.close();
  });

  it("keeps decision answers and artefact notes in the window's own conversation", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-decision-window-"));
    const source = new FlydConversationSource({
      desk: new FlydDesk({ dir, answer: async (question) => `Answer: ${question}` }),
      resolveDecision: async () => undefined,
    });
    await source.sendDecision("bring in the missing tools", [], { decisionId: "decision-1", taskId: "run-1" }, "window:decision-window");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await source.sendDecision("About the artefact \"Deals page\"", [], undefined, "window:decision-window");
    await vi.waitFor(async () => expect((await source.read("window:decision-window")).messages.at(-1)?.text).toBe("Answer: About the artefact \"Deals page\""));
    expect((await source.read("window:decision-window")).messages.map((message) => message.text)).toEqual([
      "bring in the missing tools", "I've passed your choice to the work it answers.",
      "About the artefact \"Deals page\"", "Answer: About the artefact \"Deals page\"",
    ]);
    expect((await source.listSessions()).map((session) => session.id)).toEqual(["window:decision-window"]);
  });

  it("records a chosen executive decision only after its internal handoff succeeds", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-decision-answer-"));
    const resolveDecision = vi.fn(async () => undefined);
    const source = new FlydConversationSource({
      desk: new FlydDesk({ dir, answer: async () => "unused" }),
      resolveDecision,
    });

    const sent = await source.sendDecision("bring in the missing tools", [], { decisionId: "decision-1", taskId: "run-1" });
    const exchange = source.exchanges()?.[0];

    expect(resolveDecision).toHaveBeenCalledWith("decision-1", "run-1", "bring in the missing tools");
    expect(sent.id).toMatch(/^ask:/);
    expect(exchange).toMatchObject({
      question: { text: "bring in the missing tools" },
      answer: { text: "I've passed your choice to the work it answers." },
    });
  });
});
