import { describe, expect, it } from "vitest";
import { ConversationHistoryStore } from "../conversation-history.js";
import { workSessionStore } from "../work-intelligence/work-session-store.js";

describe("ConversationHistoryStore", () => {
  it("keeps only the latest ten exchanges", () => {
    const store = new ConversationHistoryStore();
    for (let index = 0; index < 12; index += 1) {
      store.append("chat-1", `question ${index}`, `answer ${index}`, 1_000 + index);
    }

    const turns = store.get("chat-1", 2_000);
    expect(turns).toHaveLength(10);
    expect(turns[0]).toMatchObject({ user: "question 2", assistant: "answer 2" });
    expect(turns[9]).toMatchObject({ user: "question 11", assistant: "answer 11" });
  });

  it("expires an inactive conversation", () => {
    const store = new ConversationHistoryStore(10, 60_000);
    store.append("chat-1", "first question", "first answer", 1_000);

    expect(store.get("chat-1", 61_000)).toHaveLength(1);
    expect(store.get("chat-1", 61_001)).toEqual([]);
  });

  it("keeps conversations isolated", () => {
    const store = new ConversationHistoryStore();
    store.append("chat-1", "one", "answer one", 1_000);
    store.append("chat-2", "two", "answer two", 1_000);

    expect(store.get("chat-1", 2_000).map((turn) => turn.user)).toEqual(["one"]);
  });

  it("falls through to workSessionStore when conversation store is empty", () => {
    const store = new ConversationHistoryStore();
    const session = workSessionStore.createSession();
    workSessionStore.addTurn(session.sessionId, "what is this", "It is code", "work_intelligence");

    const turns = store.get(session.sessionId);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ user: "what is this", assistant: "It is code" });
  });

  it("limits workSessionStore fallback to last 6 turns", () => {
    const store = new ConversationHistoryStore();
    const session = workSessionStore.createSession();
    for (let i = 0; i < 10; i++) {
      workSessionStore.addTurn(session.sessionId, `question ${i}`, `answer ${i}`, "work_intelligence");
    }

    const turns = store.get(session.sessionId);
    expect(turns).toHaveLength(6);
    expect(turns[0]).toMatchObject({ user: "question 4", assistant: "answer 4" });
    expect(turns[5]).toMatchObject({ user: "question 9", assistant: "answer 9" });
  });

  it("returns empty when workSessionStore has no matching session", () => {
    const store = new ConversationHistoryStore();
    const turns = store.get("nonexistent-session-id");
    expect(turns).toEqual([]);
  });
});
