import { describe, expect, it } from "vitest";
import { aboutQuestion, excerpt, followUps, inlineOutcomes, outcomeLine, sentenceTopics, topicWords, withFollowUps } from "../follow-ups.js";
import type { ConversationMessage, Exchange } from "../types.js";

const note = (id: string, text: string, at: string): Exchange => ({ question: { id: `note:${id}`, role: "user", text, timestamp: at }, waiting: "Working on it", handoff: "taken" });
const reply = (id: string, text: string, at: string, notes?: string[]): ConversationMessage => ({ id, role: "assistant", text, timestamp: at, ...(notes ? { notes } : {}) });
const filler = (n: number): ConversationMessage[] => Array.from({ length: n }, (_, i) => reply(`f${i}`, `Captain, the Christmas site at Nuanu is coming along nicely, item ${i}.`, `2026-10-10T18:0${i}:00Z`));

describe("followUps", () => {
  const notes = [
    note("1791659616-INIlQf", "top menu - needs menu item for all slides", "2026-10-10T19:13:36Z"),
    note("1791659679-Mszih8", "Located at Nuanu Creative City. -> add button -> find out more about nuanu", "2026-10-10T19:14:39Z"),
    note("1791660389-520khJ", "the site map can be full screen also", "2026-10-10T19:20:00Z"),
  ];

  it("answers a note with the reply of the turn that handled it, in Flyd's voice", () => {
    const found = followUps(notes, [
      ...filler(6),
      reply("r1", "Captain, every slide will get its own short item in the top menu. This is in the same pass.", "2026-10-10T19:14:00Z", ["1791659616-INIlQf"]),
      reply("r2", "Captain, shipshape.", "2026-10-10T19:14:30Z"),
    ]);
    expect(found["note:1791659616-INIlQf"]).toMatchObject({ id: "r1", answers: "note:1791659616-INIlQf" });
    expect(found["note:1791659616-INIlQf"]!.text).toMatch(/^Sir, every slide/);
    expect(found["note:1791659679-Mszih8"]).toBeUndefined();
  });

  it("keeps updating: a later report plainly about the note replaces the first answer", () => {
    const found = followUps(notes, [
      ...filler(6),
      reply("r1", "Captain, noted: the site map goes full screen in the same pass as the rest.", "2026-10-10T19:21:00Z", ["1791660389-520khJ"]),
      reply("r2", "Captain, the site map is now full screen in your local copy, zoom at the bottom right.", "2026-10-10T19:40:00Z"),
    ]);
    expect(found["note:1791660389-520khJ"]!.id).toBe("r2");
  });

  it("gives an untagged report to the one note it is most about, never to notes it only brushes", () => {
    const found = followUps(notes, [
      ...filler(6),
      reply("r1", "Captain, the top menu item for every slide is done in your local copy.", "2026-10-10T19:30:00Z"),
    ]);
    expect(Object.keys(found)).toEqual(["note:1791659616-INIlQf"]);
  });

  it("never lets a report that only brushes the question's words across sentences take it", () => {
    const found = followUps(notes, [
      ...filler(6),
      reply("r1", "Captain, both decks are ready: 12 slides each. The menu is unchanged. One item is still open on top of that.", "2026-10-10T19:30:00Z"),
    ]);
    expect(found).toEqual({});
  });

  it("takes only the part of a many-point report about the note, under its heading", () => {
    const report = "Captain, both decks are ready.\n\nAlso in your local copy now:\n- the brands section second\n\nStill coming:\n- a menu item for every top slide\n- the full-screen site map";
    const found = followUps(notes, [...filler(6), reply("r1", report, "2026-10-10T19:30:00Z")]);
    expect(found["note:1791659616-INIlQf"]!.text).toBe("Still coming: a menu item for every top slide");
    expect(excerpt("Done:\n1. one\n2. two", 2)).toBe("Done: two");
    expect(excerpt("Plain line.", 0)).toBe("Plain line.");
  });

  it("never gives a reply to another note's turn to a note it merely resembles", () => {
    const found = followUps(notes, [
      ...filler(6),
      reply("r1", "Captain, the top menu item for every slide is done in your local copy.", "2026-10-10T19:30:00Z", ["1791650000-Other1"]),
    ]);
    expect(found).toEqual({});
  });

  it("never takes a report from before the note was sent, or one with no outcome", () => {
    const found = followUps(notes, [
      ...filler(6),
      reply("r0", "Captain, the site map is now full screen in your local copy.", "2026-10-10T19:00:00Z"),
      reply("r1", "Captain, thinking about whether the site map could go full screen.", "2026-10-10T19:30:00Z"),
    ]);
    expect(found["note:1791660389-520khJ"]).toBeUndefined();
  });

  it("answers notes taken in a batch with the first reply settled after taking them, by the line about each", () => {
    const taken = (id: string, text: string, at: string): Exchange => ({ ...note(id, text, at), takenAt: "2026-10-10T20:09:36Z" });
    const batch = [
      taken("1791661488-Ii4Idq", "the image can get a bit of a border", "2026-10-10T19:44:48Z"),
      taken("1791661816-OFMyDA", "http://127.0.0.1:8088/ are we on a different server?", "2026-10-10T19:50:16Z"),
    ];
    const report = [
      "Captain, all of your notes are done in your local copy.",
      "",
      "**Brands screen:**",
      "- The photo has a thin cream border.",
      "",
      "**Your server question:** 8088 is your own server showing your local copy live. Use 8088.",
    ].join("\n");
    const messages = [reply("early", "Captain, looking at the Christmas site notes now, one moment.", "2026-10-10T20:00:00Z"), reply("r", report, "2026-10-10T20:09:42Z")];
    const found = followUps(batch, messages);
    expect(found["note:1791661488-Ii4Idq"]!.text).toBe("The photo has a thin cream border.");
    expect(found["note:1791661816-OFMyDA"]!.text).toBe("**Your server question:** 8088 is your own server showing your local copy live. Use 8088.");
    // Mid-turn, the newest reply is not an answer yet.
    expect(followUps(batch, messages, true)).toEqual({});
    // A reply that handled another note by name is that note's, not the batch's.
    expect(followUps(batch, [reply("other", report, "2026-10-10T20:09:42Z", ["1791600000-zzzzzz"])])).toEqual({});
  });

  describe("for notes that opened domain runs", () => {
    const RUN_A = "desk-0b5e7c1d-1111-2222-3333-aaaaaaaaaaaa";
    const RUN_B = "desk-0b5e7c1d-1111-2222-3333-bbbbbbbbbbbb";
    const runNote = (id: string, text: string, at: string, run: string, handoff: "taken" | "queued" = "taken"): Exchange =>
      ({ question: { id: `note:${id}`, role: "user", text, timestamp: at, run }, waiting: "Working on it", handoff, ...(handoff === "taken" ? { takenAt: "2026-10-10T20:00:00Z" } : {}) });

    it("takes no chat as a run's answer until its receipt shows firstmate took the note up", () => {
      const queued = runNote("1791700000-aaaaaa", "the footer link opens the wrong partners page", "2026-10-10T19:00:00Z", RUN_A, "queued");
      const said = [...filler(6), reply("r1", "Captain, the footer link now opens the right partners page in your local copy.", "2026-10-10T19:30:00Z", ["1791700000-aaaaaa"])];
      expect(followUps([queued], said)).toEqual({});
      // Taken up, with no formal reply on it: the turn that handled it is the fallback.
      expect(followUps([{ ...queued, handoff: "taken", takenAt: "2026-10-10T19:20:00Z" }], said)["note:1791700000-aaaaaa"]!.id).toBe("r1");
    });

    it("never gives one run's formal words, said again in chat, to another run", () => {
      const footer: Exchange = {
        ...runNote("1791700000-aaaaaa", "fix the footer partners link", "2026-10-10T19:00:00Z", RUN_A),
        answer: { id: "note-reply:1791700000-aaaaaa", role: "assistant", text: "Sir, the footer partners link is fixed and done.", timestamp: "2026-10-10T19:40:00Z", answers: "note:1791700000-aaaaaa" },
        waiting: "",
      };
      const other = runNote("1791700001-bbbbbb", "the footer partners link colour is off", "2026-10-10T19:05:00Z", RUN_B);
      const found = followUps([footer, other], [...filler(6), reply("echo", "Captain, the footer partners link is fixed and done.", "2026-10-10T19:41:00Z")]);
      expect(found["note:1791700001-bbbbbb"]).toBeUndefined();
    });

    it("gives a report two runs took together only to the run a line of it is plainly about", () => {
      const hero = { ...runNote("1791700000-aaaaaa", "the hero image is too tall on phones", "2026-10-10T19:00:00Z", RUN_A), takenAt: "2026-10-10T20:00:00Z" };
      const pricing = { ...runNote("1791700001-bbbbbb", "pricing table needs annual toggle", "2026-10-10T19:05:00Z", RUN_B), takenAt: "2026-10-10T20:00:00Z" };
      const report = reply("r", "Captain, the hero image is shorter on phones now.", "2026-10-10T20:05:00Z");
      const found = followUps([hero, pricing], [...filler(6), report]);
      expect(found["note:1791700000-aaaaaa"]!.id).toBe("r");
      expect(found["note:1791700001-bbbbbb"]).toBeUndefined();
    });
  });

  it("ignores Flyd's own questions", () => {
    const asks: Exchange[] = [{ question: { id: "ask:1", role: "user", text: "site map full screen?", timestamp: "2026-10-10T19:00:00Z" }, waiting: "" }];
    expect(followUps(asks, [reply("r", "Captain, the site map is now full screen in your local copy.", "2026-10-10T19:30:00Z")])).toEqual({});
  });
});

describe("withFollowUps", () => {
  it("puts the newest word under the question: a chat reply when there is no formal one, or a newer one", () => {
    const pending = note("a", "q", "2026-10-10T19:00:00Z");
    const formal: Exchange = { ...note("b", "q", "2026-10-10T19:00:00Z"), answer: { id: "fr", role: "assistant", text: "formal", timestamp: "2026-10-10T19:30:00Z", answers: "note:b" }, waiting: "" };
    const chat = (at: string, answers: string): ConversationMessage => ({ id: `c-${answers}`, role: "assistant", text: "chat", timestamp: at, answers });
    const merged = withFollowUps([pending, formal], { "note:a": chat("2026-10-10T19:10:00Z", "note:a"), "note:b": chat("2026-10-10T19:10:00Z", "note:b") });
    expect(merged[0]).toMatchObject({ answer: { text: "chat" }, waiting: "" });
    expect(merged[1]!.answer!.text).toBe("formal");
    expect(withFollowUps([formal], { "note:b": chat("2026-10-10T19:45:00Z", "note:b") })[0]!.answer!.text).toBe("chat");
  });

  it("keeps a domain run's own reply under its note: chat matched by topic words is only the fallback", () => {
    const formal: Exchange = {
      question: { id: "note:b", role: "user", text: "fix the footer link", timestamp: "2026-10-10T19:00:00Z", run: "desk-0b5e7c1d-1111-2222-3333-444455556666" },
      answer: { id: "note-reply:b", role: "assistant", text: "Done: the footer link opens the partners page.", timestamp: "2026-10-10T19:30:00Z", answers: "note:b" },
      waiting: "",
    };
    const later: ConversationMessage = { id: "c-b", role: "assistant", text: "The footer link is fixed and the partners page is live.", timestamp: "2026-10-10T19:45:00Z", answers: "note:b" };
    expect(withFollowUps([formal], { "note:b": later })[0]!.answer!.text).toBe("Done: the footer link opens the partners page.");
    // With no reply yet, the chat fallback answers it once the receipts show firstmate took the note up.
    const { answer: _none, ...unanswered } = formal;
    expect(withFollowUps([{ ...unanswered, waiting: "Working on it", handoff: "taken" }], { "note:b": later })[0]!.answer!.text).toBe(later.text);
    // Still sitting in the inbox, it has no answer but its formal reply, whatever the chat said.
    expect(withFollowUps([{ ...unanswered, waiting: "Queued", handoff: "queued" }], { "note:b": later })[0]!.answer).toBeUndefined();
  });

  it("calls a taken note with no words answered, except the newest while firstmate is mid-turn", () => {
    const older = note("a", "q", "2026-10-10T19:00:00Z");
    const newest = note("b", "q", "2026-10-10T19:05:00Z");
    const queued: Exchange = { ...note("c", "q", "2026-10-10T19:06:00Z"), handoff: "queued" };
    expect(withFollowUps([older, newest, queued], {}).map((exchange) => [exchange.answered ?? false, exchange.waiting])).toEqual([[true, ""], [true, ""], [false, "Working on it"]]);
    expect(withFollowUps([older, newest, queued], {}, true).map((exchange) => [exchange.answered ?? false, exchange.waiting])).toEqual([[true, ""], [false, "Working on it"], [false, "Working on it"]]);
  });
});

describe("topicWords and aboutQuestion", () => {
  it("drops filler words and needs most of the question's words", () => {
    expect([...topicWords("the site map can be full screen also")].sort()).toEqual(["full", "map", "screen", "site"]);
    const question = new Set(["top", "menu", "item", "slide"]);
    expect(aboutQuestion(question, sentenceTopics("Every slide now has its own item in the top menu.")).share).toBe(1);
    expect(aboutQuestion(question, sentenceTopics("Both decks are ready, 12 slides. The menu panel moved. One item is left.")).share).toBe(0);
  });
});

describe("inlineOutcomes", () => {
  const asked = note("1791700000-aaaaaa", "merge date and remind me pages", "2026-10-11T05:00:00Z");

  it("puts firstmate's chat outcome under his message in place of the living line", () => {
    const answer = reply("r1", "Captain, done.\n\nThe date and remind-me pages are now **one page** at /remind.\n\n- Old links redirect.", "2026-10-11T05:10:00Z", ["1791700000-aaaaaa"]);
    const [exchange] = inlineOutcomes(withFollowUps([asked], followUps([asked], [answer])));
    expect(exchange).toMatchObject({ waiting: "The date and remind-me pages are now one page at /remind.", settled: true });
    expect(exchange!.answer).toBeUndefined();
  });

  it("keeps a formal reply as the note's answer", () => {
    const formal = { ...asked, answer: { id: "note-reply:1791700000-aaaaaa", role: "assistant" as const, text: "Merged.", answers: asked.question.id }, waiting: "" };
    expect(inlineOutcomes([formal])).toEqual([formal]);
  });

  it("says a note firstmate finished with is answered, never that it is still being worked on", () => {
    expect(inlineOutcomes(withFollowUps([asked], {}))).toMatchObject([{ waiting: "Answered", settled: true }]);
  });

  it("leaves the living line while firstmate is still on the newest note", () => {
    expect(inlineOutcomes(withFollowUps([asked], {}, true))).toMatchObject([{ waiting: "Working on it" }]);
  });
});

describe("outcomeLine", () => {
  it("clips a long outcome at a word", () => {
    const line = outcomeLine(`The hero now reads ${"very ".repeat(60)}well.`);
    expect(line.length).toBeLessThanOrEqual(161);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("outcomeLine for a batch", () => {
  it("picks the line about his question from a reply that covers several notes", () => {
    const text = "Three changes, all committed locally only.\n\n- The hero headline now reads Celebrate Christmas.\n- The site map opens full screen.\n- The menu has an item for every slide.";
    expect(outcomeLine(text, "the site map can be full screen also")).toBe("The site map opens full screen.");
  });
});
