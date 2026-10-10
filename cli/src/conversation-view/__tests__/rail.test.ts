import { describe, expect, it } from "vitest";
import { composeRail, conversationPreviews, negationsIn, normalizeLoopback, previewCard, previewsIn, spoken, type RailArtefact } from "../rail.js";
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

  it("strips trailing punctuation and shows the same page once", () => {
    const previews = previewsIn("It is up at http://127.0.0.1:8088/. Reload http://127.0.0.1:8088/ or http://127.0.0.1:8088, then http://127.0.0.1:8088/.");
    expect(previews.map((preview) => preview.url)).toEqual(["http://127.0.0.1:8088/"]);
  });

  it("never previews a page the text rules out", () => {
    const text = "status=needs_decision: copy swap dispatched; preview is http://127.0.0.1:8097/ (not 8088). Old one was http://127.0.0.1:8088/.";
    expect(previewsIn(text).map((preview) => preview.url)).toEqual(["http://127.0.0.1:8097/"]);
    expect(previewsIn("use http://localhost:3000/a instead of http://localhost:3000/b").map((preview) => preview.url)).toEqual(["http://localhost:3000/a"]);
  });

  it("puts the URL the text names as the preview first", () => {
    const previews = previewsIn("The API runs on http://127.0.0.1:4815/health and the preview is at http://127.0.0.1:8097/.");
    expect(previews.map((preview) => preview.url)).toEqual(["http://127.0.0.1:8097/", "http://127.0.0.1:4815/health"]);
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

  it("keeps out an older page a newer line ruled out, and dedupes across lines", () => {
    const previews = conversationPreviews([
      user("a", "is it on http://127.0.0.1:8088/?"),
      assistant("b", "Preview is http://127.0.0.1:8097/ (not 8088).", "a"),
      user("c", "thanks, http://127.0.0.1:8097"),
    ]);
    expect(previews.map((preview) => preview.url)).toEqual(["http://127.0.0.1:8097/"]);
  });
});

describe("normalizeLoopback and negationsIn", () => {
  it("reads a URL as one page", () => {
    expect(normalizeLoopback("http://127.0.0.1:8088/.")).toBe("http://127.0.0.1:8088/");
    expect(normalizeLoopback("http://127.0.0.1:8088,")).toBe("http://127.0.0.1:8088/");
    expect(normalizeLoopback("http://localhost:3000/a?x=1;")).toBe("http://localhost:3000/a?x=1");
  });

  it("finds ruled-out ports and pages", () => {
    const found = negationsIn("preview is 8097, not 8088; no longer on http://127.0.0.1:9000/.");
    expect([...found.ports]).toEqual(["8088"]);
    expect([...found.urls]).toEqual(["http://127.0.0.1:9000/"]);
  });
});

describe("previewCard", () => {
  it("frames a live page and points a screenshot at the same-origin image route", () => {
    expect(previewCard({ id: "live:u", kind: "live", url: "http://127.0.0.1:8097/" })).toMatchObject({ title: "Live preview", preview: "http://127.0.0.1:8097/", url: "http://127.0.0.1:8097/" });
    const card = previewCard({ id: "image:p", kind: "image", url: "/Users/radarboy3000/a b.png" });
    expect(card.image).toBe("/api/rail-image?path=%2FUsers%2Fradarboy3000%2Fa%20b.png");
    expect(card.title).toBe("Screenshot");
  });

  it("says a page that does not answer is not running, and frames nothing until it does", () => {
    const down = previewCard({ id: "live:u", kind: "live", url: "http://127.0.0.1:8088/" }, "down");
    expect(down).toMatchObject({ title: "Preview not running", line: "127.0.0.1:8088/", url: "http://127.0.0.1:8088/", down: true });
    expect(down.preview).toBeUndefined();
    const checking = previewCard({ id: "live:u", kind: "live", url: "http://127.0.0.1:8088/" }, "checking");
    expect(checking).toMatchObject({ checking: true });
    expect(checking.preview).toBeUndefined();
  });
});

describe("spoken", () => {
  it("drops a machine status header", () => {
    expect(spoken("status=needs_decision: copy swap dispatched.")).toBe("Copy swap dispatched.");
    expect(spoken("Plain words stay.")).toBe("Plain words stay.");
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

  it("tells a machine reply in words, voiced when the server has a reading, and asks each page whether it answers", () => {
    const asked: string[] = [];
    const rail = composeRail(
      [{ question: user("q1", "swap the copy"), answer: assistant("a1", "status=needs_decision: copy swap dispatched; preview is http://127.0.0.1:8097/ (not 8088).", "note:q1") }],
      [],
      [{ id: "live:http://127.0.0.1:8088/", kind: "live", url: "http://127.0.0.1:8088/" }],
      {
        live: (url) => { asked.push(url); return url.includes("8097") ? "up" : "down"; },
        voice: (answer) => (answer.answers === "note:q1" ? "<p>The copy swap is under way, sir.</p>" : undefined),
      },
    );
    const talk = rail.conversations[0]!;
    expect(talk.answer).toBe("Copy swap dispatched; preview is http://127.0.0.1:8097/ (not 8088).");
    expect(talk.answerHtml).toBe("<p>The copy swap is under way, sir.</p>");
    expect(talk.previews!.map((card) => card.preview)).toEqual(["http://127.0.0.1:8097/"]);
    expect(rail.artefacts[0]).toMatchObject({ title: "Preview not running", down: true });
    expect(asked).toEqual(["http://127.0.0.1:8097/", "http://127.0.0.1:8088/"]);
  });

  it("drops conversation rows with no words", () => {
    const rail = composeRail([{ question: user("q", "   ") }], []);
    expect(rail.conversations).toEqual([]);
  });
});
