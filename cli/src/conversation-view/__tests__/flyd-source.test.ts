import { mkdtempSync, rmSync } from "node:fs";
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
  it("keeps the whole current session in the main pane and lists earlier sessions behind it by their own identity", async () => {
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
    desk.ask("First Flyd question", [], "earlier");
    await vi.waitFor(() => expect(desk.exchanges("earlier").at(-1)?.answer).toBeDefined());
    await source.send("conversation", "A general question");
    await vi.waitFor(async () => expect((await source.read("conversation")).messages.at(-1)?.role).toBe("assistant"));
    await source.send("conversation", "And the second part?");
    await vi.waitFor(async () => expect((await source.read("conversation")).messages.at(-1)?.role).toBe("assistant"));

    const sessions = await source.listSessions();
    expect(sessions.map((session) => [session.id, session.title, session.project])).toEqual([
      ["conversation", "A general question", undefined],
      ["earlier", "First Flyd question", "Flyd"],
    ]);
    expect((await source.read("conversation")).messages.map((message) => message.text)).toEqual([
      "A general question", "Answer: A general question", "And the second part?", "Answer: And the second part?",
    ]);

    await source.send("earlier", "Continue that Flyd question");
    await vi.waitFor(async () => expect((await source.read("earlier")).messages.at(-1)?.text).toBe("Answer: Continue that Flyd question"));
    expect(contexts.at(-1)?.history).toContainEqual({ role: "user", content: "First Flyd question" });
    expect((await source.listSessions())[0]?.id).toBe("conversation");
    expect((await source.read("earlier")).messages.map((message) => message.text)).toEqual([
      "First Flyd question", "Answer: First Flyd question", "Continue that Flyd question", "Answer: Continue that Flyd question",
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
    const follower = source.follow("conversation", (snapshot) => updates.push(JSON.stringify(snapshot)));
    const sent = await source.send("conversation", "what should I do next?");

    expect(source.assistantLabel).toBe("Flyd");
    expect(source.canSend).toBe(true);
    expect(sent.id).toMatch(/^ask:/);
    await vi.waitFor(async () => {
      const snapshot = await source.read("conversation");
      expect(snapshot.working).toBe(true);
      expect(snapshot.messages).toContainEqual(expect.objectContaining({ role: "user", text: "what should I do next?" }));
    });
    finishAnswer("I can help with the next step.");
    await vi.waitFor(async () => expect((await source.read("conversation")).messages)
      .toContainEqual(expect.objectContaining({ role: "assistant", text: "I can help with the next step." })));
    expect(afterTurn).toHaveBeenCalledWith({
      sessionId: "conversation",
      user: "what should I do next?",
      assistant: "I can help with the next step.",
    });
    expect(updates.length).toBeGreaterThan(1);
    follower.close();
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
