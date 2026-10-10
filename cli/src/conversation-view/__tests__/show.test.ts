import { describe, expect, it } from "vitest";
import { SnapshotDiffer } from "../server.js";
import { MAX_SHOW_ITEMS, showOf, situationOf, titleOf } from "../show.js";
import type { ConversationMessage, ConversationSnapshot } from "../types.js";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const PR = "https://github.com/GeorgeGally/flyd/pull/74";

function snapshot(messages: ConversationMessage[], extra: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return { messages, working: false, ...extra };
}
const captain = (id: string, text: string, minutes: number, extra: Partial<ConversationMessage> = {}): ConversationMessage =>
  ({ id, role: "user", text, timestamp: minutesAgo(minutes), ...extra });
const fleet = (id: string, text: string, minutes: number, extra: Partial<ConversationMessage> = {}): ConversationMessage =>
  ({ id, role: "assistant", text, timestamp: minutesAgo(minutes), ...extra });

describe("showOf", () => {
  it("leads with the call only he can make, then what landed, then what is moving", () => {
    const screen = showOf(snapshot([
      captain("u1", "how are the PRs?", 90),
      fleet("a1", `Sir, the setup card fix merged into main: ${PR}. Nothing else changed.`, 60, { aside: true }),
      fleet("a2", "Sir, the island filter is still paused on your call. A or B?", 5, { aside: true }),
    ], { working: true, activity: "Running the Swift tests", lastActivity: minutesAgo(1) }), { now: NOW });

    expect(screen.items.map((item) => item.kind)).toEqual(["call", "landed", "live"]);
    expect(screen.title).toBe("Your move, sir.");
    expect(screen.live).toBe(true);
    const [call, landed, live] = screen.items;
    expect(call).toMatchObject({ id: "call:a2", ref: "a2", headline: "The island filter is still paused on your call. A or B?", why: "waiting on you" });
    expect(landed).toMatchObject({ id: "landed:a1", headline: "The setup card fix merged into main: #74.", links: [{ label: "flyd #74", url: PR }] });
    expect(live).toMatchObject({ id: "live", headline: "Running the Swift tests", why: "firstmate is on it now" });
  });

  it("never shows more than a few things", () => {
    const screen = showOf(snapshot([
      fleet("a1", "Sir, the scout fix shipped.", 30),
      fleet("a2", "Sir, the crew run is finished and the report is ready to read in full.", 20),
      captain("u1", "can you check the notch island?", 10, { waiting: "firstmate is on it" }),
      fleet("a3", "Should I land the taste page too?", 2),
    ], { working: true, activity: "Reading the island code", lastActivity: minutesAgo(1) }), { now: NOW });
    expect(screen.items).toHaveLength(MAX_SHOW_ITEMS);
  });

  it("forgets a call once he has spoken since", () => {
    const screen = showOf(snapshot([
      fleet("a1", "Sir, which colour do you want for the badge? Red or teal?", 30),
      captain("u1", "teal", 20),
    ]), { now: NOW });
    expect(screen.items.map((item) => item.kind)).not.toContain("call");
  });

  it("treats work handed to him as his call", () => {
    const screen = showOf(snapshot([fleet("a1", `PR ${PR} is green and ready to merge.`, 15)]), { now: NOW });
    expect(screen.items[0]).toMatchObject({ kind: "call", headline: "PR #74 is green and ready to merge." });
  });

  it("does not call something landed that has not happened yet", () => {
    const screen = showOf(snapshot([
      fleet("a1", "Sir, it is not merged yet; CI is still running.", 10),
      fleet("a2", "I will deploy once you say so, after lunch.", 5),
    ]), { now: NOW });
    expect(screen.items.map((item) => item.kind)).not.toContain("landed");
  });

  it("recaps the last real activity when nothing is outstanding, passing over routine chatter", () => {
    const screen = showOf(snapshot([
      fleet("a1", "Sir, the dossier renderer shipped.", 60 * 30),
      fleet("a2", "Shipshape.", 3),
    ]), { now: NOW });
    expect(screen.items).toEqual([{ id: "landed:a1", kind: "landed", headline: "The dossier renderer shipped.", why: "last landed", at: minutesAgo(60 * 30), ref: "a1" }]);
    expect(screen.title).toBe("Here's where things stand, sir.");
  });

  it("recaps what last ran, newest first, when nothing is outstanding", () => {
    const screen = showOf(snapshot([
      fleet("a1", "Sir, the scout is evolving its sources.", 60 * 30),
      fleet("a2", "Sir, the island fix is queued next.", 60 * 20),
    ]), { now: NOW });
    expect(screen.items.map((item) => [item.kind, item.why])).toEqual([
      ["news", "last from firstmate"],
      ["news", "last from firstmate"],
    ]);
    expect(screen.items.map((item) => item.ref)).toEqual(["a2", "a1"]);
    expect(screen.title).toBe("Here's where things stand, sir.");
  });

  it("shows a bare session as all clear when there is no activity at all", () => {
    const screen = showOf(snapshot([]), { now: NOW });
    expect(screen.items).toEqual([{ id: "clear", kind: "clear", headline: "Nothing needs you right now.", why: "I'll flag it when something does" }]);
    expect(screen.title).toBe("All quiet, sir.");
  });

  it("leads the screen with Flyd's artefact, then the conversation", () => {
    const screen = showOf(snapshot([fleet("a1", "Sir, the dossier renderer shipped.", 5)]), {
      now: NOW,
      artefact: {
        fleet: { calls: [{ label: "Keep or remove the Jev log?" }], live: [], ready: [], landed: [], held: [], next: [] },
        memories: ["George wants Bloom finished."],
        news: [{ title: "Hybrid RAG" }],
        taste: [],
      },
    });
    expect(screen.items.map((item) => [item.kind, item.headline])).toEqual([
      ["call", "Keep or remove the Jev log?"],
      ["news", "George wants Bloom finished."],
      ["news", "Hybrid RAG"],
      ["landed", "The dossier renderer shipped."],
    ]);
    expect(screen.title).toBe("Your move, sir.");
    expect(screen.summary).toBe("1 call waits on you.");
    expect(screen.counts).toMatchObject({ call: 1, landed: 1 });
  });

  it("sums up the whole fleet, counting past what the screen shows", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ label: `Piece ${index}`, repo: "flyd" }));
    const screen = showOf(snapshot([]), {
      now: NOW,
      projects: [{ name: "Flyd", repos: ["/Users/george/Documents/flyd"] }],
      artefact: {
        fleet: { generated: "2026-10-09T11:58:00Z", calls: [], live: many, ready: many.slice(0, 2), landed: [], held: [], next: [] },
        memories: [],
        news: [],
        taste: [],
        landedByDay: [{ day: "2026-10-09", count: 2 }],
      },
    });
    expect(screen.summary).toBe("Nothing waits on you, 9 under way, 2 waiting to land.");
    expect(screen.counts).toMatchObject({ live: 9, ready: 2 });
    expect(screen.items.filter((item) => item.kind === "live")).toHaveLength(4);
    expect(screen.items[0]).toMatchObject({ project: "Flyd", headline: "Piece 0" });
    expect(screen.landedByDay).toEqual([{ day: "2026-10-09", count: 2 }]);
    expect(screen.read).toBe("2026-10-09T11:58:00Z");
  });

  it("says plainly when the fleet could not be read", () => {
    expect(situationOf({}, "timed out")).toBe("I couldn't read firstmate's fleet just now (timed out).");
    expect(situationOf({ call: 2, waiting: 1 })).toBe("2 calls wait on you, 1 held up.");
  });

  it("says all clear beside queued work, so the screen always has something to show", () => {
    const screen = showOf(snapshot([]), {
      now: NOW,
      artefact: { fleet: { calls: [], live: [], ready: [], landed: [], held: [], next: [{ label: "Gate the notch island" }] }, memories: [], news: [], taste: [] },
    });
    expect(screen.items.map((item) => item.kind)).toEqual(["next", "clear"]);
  });

  it("shows a taste note only when there is nothing else at all", () => {
    const screen = showOf(snapshot([]), { now: NOW, artefact: { memories: [], news: [], taste: ["No eyebrow above a headline."] } });
    expect(screen.items).toEqual([{ id: "taste", kind: "news", headline: "No eyebrow above a headline.", why: "what I'm learning about your taste" }]);
  });

  it("shows a question of his that is still waiting, in his own words", () => {
    const screen = showOf(snapshot([captain("note:1", "can **you** check the notch island?", 4, { waiting: "passed to firstmate" })]), { now: NOW });
    expect(screen.items).toEqual([{ id: "waiting:note:1", kind: "waiting", headline: "“can you check the notch island?”", why: "passed to firstmate", at: minutesAgo(4), ref: "note:1" }]);
  });

  it("speaks with Flyd's reading of an answer when it has one", () => {
    const answer = fleet("note-reply:1", "Captain, PR 74 is done. Merge it? Reply yes.", 3, { answers: "note:1" });
    const screen = showOf(snapshot([captain("note:1", "status?", 5), answer]), {
      now: NOW,
      reading: (message) => (message.id === answer.id ? "Sir, the setup card is fixed and waiting on you. Shall I merge it?" : undefined),
    });
    expect(screen.items[0]).toMatchObject({ kind: "call", headline: "The setup card is fixed and waiting on you. Shall I merge it?" });
  });

  it("leaves Flyd's own answers to his questions off the screen", () => {
    const screen = showOf(snapshot([
      captain("ask:1", "what's on in Bangkok tonight?", 10),
      fleet("answer:1", "Sir, the night market is open; want me to book a table?", 9, { answers: "ask:1" }),
    ]), { now: NOW });
    expect(screen.items.map((item) => item.kind)).toEqual(["clear"]);
  });

  it("passes over replies Flyd's model judged routine", () => {
    const screen = showOf(snapshot([fleet("a1", "Sir, the queue is quiet and the island filter kept to its last setting all morning, so there is nothing new to tell.", 5)]), {
      now: NOW,
      muted: () => true,
    });
    expect(screen.items.map((item) => item.kind)).toEqual(["clear"]);
  });

  it("names things by his own projects", () => {
    const projects = [{ name: "Flyd", repos: ["/Users/george/Documents/flyd"] }, { name: "CapFive", repos: [] }];
    const byRepo = showOf(snapshot([fleet("a1", `Sir, the island fix merged: ${PR}.`, 5)]), { now: NOW, projects });
    expect(byRepo.items[0]!.project).toBe("Flyd");
    const byName = showOf(snapshot([fleet("a1", "Sir, the capfive deals page shipped.", 5)]), { now: NOW, projects });
    expect(byName.items[0]!.project).toBe("CapFive");
  });

  it("picks the same things from the same inputs", () => {
    const messages = [
      fleet("a1", `Sir, ${PR} merged.`, 50),
      captain("u1", "nice", 40),
      fleet("a2", "Sir, the scout is evolving its sources; the report lands tomorrow.", 30),
    ];
    expect(showOf(snapshot(messages), { now: NOW })).toEqual(showOf(snapshot(messages), { now: NOW }));
  });

  it("titles the screen by the most important thing on it", () => {
    expect(titleOf([{ id: "x", kind: "live", headline: "", why: "" }])).toBe("Under way, sir.");
    expect(titleOf([{ id: "x", kind: "news", headline: "", why: "" }, { id: "y", kind: "landed", headline: "", why: "" }])).toBe("Good news, sir.");
  });
});

describe("SnapshotDiffer show", () => {
  it("sends the show screen with every update, by the source's own label", () => {
    const differ = new SnapshotDiffer(undefined, { assistant: "firstmate" });
    const shipped: ConversationMessage = { id: "a1", role: "assistant", text: "Sir, the menu change shipped to production." };
    const update = differ.next(snapshot([shipped], { working: true, activity: "Checking the live site", lastActivity: new Date().toISOString() }));
    expect(update.show.items.map((item) => [item.kind, item.headline, item.why])).toEqual([
      ["landed", "The menu change shipped to production.", "just landed"],
      ["live", "Checking the live site", "firstmate is on it now"],
    ]);
    expect(update.show.title).toBe("Good news, sir.");
  });
});
