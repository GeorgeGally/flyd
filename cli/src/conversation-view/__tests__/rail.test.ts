import { describe, expect, it } from "vitest";
import { composeRail, conversationPreviews, previewCard, previewsIn, type RailArtefact } from "../rail.js";
import type { ConversationMessage } from "../types.js";

const user = (id: string, text: string, at = "2026-10-10T17:24:00Z"): ConversationMessage => ({ id, role: "user", text, timestamp: at });
const assistant = (id: string, text: string, answers: string): ConversationMessage => ({ id, role: "assistant", text, answers });

describe("previewsIn", () => {
  it("finds a live local page and a local screenshot path in a reply", () => {
    const previews = previewsIn("Serving it live at http://127.0.0.1:8097/ and a shot at /Users/radarboy3000/Documents/firstmate/data/gnm/after.png");
    expect(previews).toEqual([
      { id: "live:http://127.0.0.1:8097/", kind: "live", url: "http://127.0.0.1:8097/" },
      { id: "image:/Users/radarboy3000/Documents/firstmate/data/gnm/after.png", kind: "image", url: "/Users/radarboy3000/Documents/firstmate/data/gnm/after.png" },
    ]);
  });

  it("ignores remote URLs and non-images", () => {
    expect(previewsIn("see https://example.com/x and /Users/me/notes.txt")).toEqual([]);
  });
});

describe("conversationPreviews", () => {
  it("takes the newest previews across the recent conversation, capped", () => {
    const previews = conversationPreviews([
      user("a", "look at http://127.0.0.1:8097/"),
      assistant("b", "here: /Users/radarboy3000/shot.png", "a"),
    ]);
    expect(previews.map((preview) => preview.url)).toEqual(["/Users/radarboy3000/shot.png", "http://127.0.0.1:8097/"]);
  });
});

describe("previewCard", () => {
  it("frames a live page and points a screenshot at the same-origin image route", () => {
    expect(previewCard({ id: "live:u", kind: "live", url: "http://127.0.0.1:8097/" })).toMatchObject({ title: "Live preview", preview: "http://127.0.0.1:8097/", url: "http://127.0.0.1:8097/" });
    const card = previewCard({ id: "image:p", kind: "image", url: "/Users/radarboy3000/a b.png" });
    expect(card.image).toBe("/api/rail-image?path=%2FUsers%2Fradarboy3000%2Fa%20b.png");
    expect(card.title).toBe("Screenshot");
  });
});

describe("composeRail", () => {
  const artefacts: RailArtefact[] = [{ id: "landed:x", title: "Christmas Nuanu map", line: "just landed" }];

  it("puts each answer below its question, with the reply's own preview under it", () => {
    const rail = composeRail(
      [
        { question: user("q1", "make a playlist"), answer: assistant("a1", "Nine tracks. Preview at http://127.0.0.1:8097/", "q1") },
        { question: user("q2", "and tickets?"), waiting: "Working on it" },
      ],
      artefacts,
    );
    expect(rail.conversations[0]).toMatchObject({ id: "q1", question: "make a playlist", answer: "Nine tracks. Preview at http://127.0.0.1:8097/" });
    expect(rail.conversations[0]!.previews![0]).toMatchObject({ title: "Live preview", preview: "http://127.0.0.1:8097/" });
    expect(rail.conversations[1]).toMatchObject({ id: "q2", waiting: "Working on it" });
    expect(rail.conversations[1]!.answer).toBeUndefined();
  });

  it("shows a preview from outside the exchanges as its own artefact, and never twice", () => {
    const rail = composeRail(
      [{ question: user("q1", "make a playlist"), answer: assistant("a1", "Nine tracks.", "q1") }],
      artefacts,
      [{ id: "live:http://127.0.0.1:8097/", kind: "live", url: "http://127.0.0.1:8097/" }],
    );
    expect(rail.artefacts[0]).toMatchObject({ title: "Live preview", preview: "http://127.0.0.1:8097/" });
    expect(rail.artefacts.filter((card) => card.preview === "http://127.0.0.1:8097/")).toHaveLength(1);
    expect(rail.conversations[0]!.previews).toBeUndefined();
  });

  it("drops conversation rows with no words", () => {
    const rail = composeRail([{ question: user("q", "   ") }], []);
    expect(rail.conversations).toEqual([]);
  });
});
