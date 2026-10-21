import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlydConversationSource } from "../flyd-source.js";
import { FlydDesk } from "../flyd-desk.js";
import { conversationSourceForView } from "../../commands/view-source.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("Flyd's standalone conversation source", () => {
  it("owns the default view even when there is no FirstMate source", () => {
    const flyd = new FlydConversationSource({ desk: new FlydDesk({ dir: join(tmpdir(), "flyd-source-unused"), answer: async () => "" }) });
    const firstmate = { assistantLabel: "firstmate" } as never;

    expect(conversationSourceForView({}, flyd, firstmate)).toBe(flyd);
    expect(conversationSourceForView({ project: "/tmp/firstmate" }, flyd, firstmate)).toBe(firstmate);
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
