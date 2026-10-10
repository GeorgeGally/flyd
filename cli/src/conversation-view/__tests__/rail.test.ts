import { describe, expect, it } from "vitest";
import { composeRail, conversationPreview, type RailArtefact } from "../rail.js";
import type { ConversationMessage } from "../types.js";

const user = (id: string, text: string, at = "2026-10-10T17:24:00Z"): ConversationMessage => ({ id, role: "user", text, timestamp: at });
const assistant = (id: string, text: string, answers: string): ConversationMessage => ({ id, role: "assistant", text, answers });

describe("conversationPreview", () => {
  it("takes the newest loopback URL the captain himself named, so we preview the site we are talking about", () => {
    const messages = [
      user("a", "check the site at http://127.0.0.1:8097/index.html please"),
      assistant("b", "I'll look", "a"),
      user("c", "thats one of the things the artefacts can show"),
    ];
    expect(conversationPreview(messages)).toBe("http://127.0.0.1:8097/index.html");
  });

  it("ignores a loopback URL Flyd said and any remote URL", () => {
    expect(conversationPreview([
      assistant("a", "see http://127.0.0.1:4818/", "x"),
      user("b", "read https://example.com/thing"),
      user("c", "and http://localhost:8097 is where it runs"),
    ])).toBe("http://localhost:8097");
  });

  it("is nothing when no local site was named", () => {
    expect(conversationPreview([user("a", "make a playlist"), assistant("b", "done", "a")])).toBeUndefined();
  });
});

describe("composeRail", () => {
  const artefacts: RailArtefact[] = [{ id: "landed:x", title: "Christmas Nuanu map", line: "just landed" }];

  it("puts each answer below its question and a live preview card at the front of the artefacts", () => {
    const rail = composeRail(
      [{ question: user("q1", "make a playlist"), answer: assistant("a1", "Nine tracks.", "q1") }, { question: user("q2", "and tickets?"), waiting: "Working on it" }],
      artefacts,
      "http://127.0.0.1:8097/",
    );
    expect(rail.conversations[0]).toMatchObject({ id: "q1", question: "make a playlist", answer: "Nine tracks." });
    expect(rail.conversations[1]).toMatchObject({ id: "q2", waiting: "Working on it" });
    expect(rail.conversations[1]!.answer).toBeUndefined();
    expect(rail.artefacts[0]).toMatchObject({ title: "Live preview", preview: "http://127.0.0.1:8097/", line: "127.0.0.1:8097/" });
    expect(rail.artefacts[1]).toMatchObject({ title: "Christmas Nuanu map" });
  });

  it("never adds a preview card twice and drops conversation rows with no words", () => {
    const rail = composeRail([{ question: user("q", "   ") }], [{ id: "p", title: "Live preview", preview: "http://127.0.0.1:8097/" }], "http://127.0.0.1:8097/");
    expect(rail.conversations).toEqual([]);
    expect(rail.artefacts).toHaveLength(1);
  });
});
