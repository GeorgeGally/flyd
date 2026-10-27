import { describe, expect, it } from "vitest";
import { renderBriefing } from "../executive.js";
import { composeRail, conversationPreviews, MAX_RAIL_ARTEFACTS, loopbackPage, negationsIn, normalizeLoopback, outcomeFirst, phoneCommentNote, phoneWork, plainNote, previewCard, previewsIn, railImageSrc, railState, changeNotice, RAIL_CARD_TITLES, railServer, spoken, whoseFolder, type RailArtefact } from "../rail.js";
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

describe("outcomeFirst", () => {
  const REPLY = [
    "Captain, done on Visit → Hours:",
    "- **Position:** Mr Christmas now sits level with the green card, centred between it and his dance panel.",
    "- **Dance panel:** on the right is a small video-game-style panel:",
    "  - a dark box with a cream border",
    "  - all five dances are numbered",
    "- **Phones:** the panel sits bottom-right with him beside it.",
    "",
    "It's committed in your local copy only; refresh your tab.",
  ].join("\n");

  it("leads with what changed when the answer opens with only \"done on <place>\"", () => {
    const said = outcomeFirst(REPLY.replace("Captain,", "Sir,"));
    expect(said.split("\n")[0]).toBe("Mr Christmas now sits level with the green card, centred between it and his dance panel.");
    expect(said).not.toMatch(/\b(?:Sir|Captain)\b|done on Visit/);
    // The rest of the answer is still there, the sentence that leads now said once.
    expect(said).toContain("**Dance panel:**");
    expect(said).toContain("refresh your tab");
    expect(said.match(/sits level/g)).toHaveLength(1);
  });

  it("takes what changed from the reply when Flyd's reading of it is only \"done\"", () => {
    expect(outcomeFirst("Sir, done on Visit → Hours.", REPLY)).toBe("Mr Christmas now sits level with the green card, centred between it and his dance panel.");
    expect(outcomeFirst("Done.", "Captain, the hat is red now.")).toBe("The hat is red now.");
  });

  it("drops the salutation and keeps an answer that already says what changed", () => {
    expect(outcomeFirst("Sir, the hat is red now. Refresh to see it.")).toBe("The hat is red now. Refresh to see it.");
    expect(outcomeFirst("Captain: nothing else blocks.")).toBe("Nothing else blocks.");
    expect(outcomeFirst("Mr Christmas dances at 70% speed.")).toBe("Mr Christmas dances at 70% speed.");
  });

  it("keeps a bare acknowledgement when nothing says what changed", () => {
    expect(outcomeFirst("Sir, done.")).toBe("Done.");
  });

  it("never shows the internal word \"Landed\" in the column's status card", () => {
    const html = renderBriefing("Both are in.\n\n- The hat merged\n- The scarf landed", RAIL_CARD_TITLES);
    expect(html).toContain('<h4 class="sc-kicker">Done<span');
    expect(html).not.toMatch(/>Landed</i);
  });
});

describe("composeRail", () => {
  const artefacts: RailArtefact[] = [{ id: "landed:x", title: "Christmas Nuanu map", line: "just landed" }];

  it("never cuts a card the window points to, and fills the rest of the column in order", () => {
    const many: RailArtefact[] = Array.from({ length: MAX_RAIL_ARTEFACTS + 2 }, (_, index) => ({ id: `site:${index}`, title: `Site ${index}` }));
    const reply: RailArtefact = { id: "reply:r1", title: "Fix the redirects", steps: ["Delete the rule.", "Add the rule."] };
    const rail = composeRail([], [...many, reply], [], { kept: new Set(["reply:r1"]) });
    expect(rail.artefacts.map((card) => card.id)).toEqual([...many.slice(0, MAX_RAIL_ARTEFACTS - 1).map((card) => card.id), "reply:r1"]);
  });

  it("puts each answer below its question, with the reply's own preview under it", () => {
    const rail = composeRail(
      [
        { question: user("q1", "make a playlist"), answer: assistant("a1", "Nine tracks. Preview at http://127.0.0.1:8097/", "q1") },
        { question: user("q2", "and tickets?", "2026-10-10T17:40:00Z"), waiting: "Working on it" },
      ],
      artefacts,
    );
    expect(rail.conversations[0]).toMatchObject({ id: "q1", question: "make a playlist", answer: "Nine tracks. Preview at http://127.0.0.1:8097/" });
    expect(rail.conversations[0]!.previews![0]).toMatchObject({ title: "Live preview", preview: "http://127.0.0.1:8097/" });
    expect(rail.conversations[1]).toMatchObject({ id: "q2", waiting: "Working on it" });
    expect(rail.conversations[1]!.answer).toBeUndefined();
  });

  it("says a question is answered when firstmate has finished with it and has no words to show", () => {
    const rail = composeRail([{ question: user("q", "are we on a different server?"), waiting: "", answered: true }], []);
    expect(rail.conversations[0]).toMatchObject({ id: "q", answered: true });
    expect(rail.conversations[0]!.waiting).toBeUndefined();
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

  it("shows a plain answer leading with what changed, without the salutation", () => {
    const rail = composeRail([{ question: user("q", "move bunny up"), answer: assistant("a", "Captain, done on Visit → Hours:\n- **Position:** Mr Christmas now sits level with the green card.", "q") }], []);
    expect(rail.conversations[0]!.answer).toBe("Mr Christmas now sits level with the green card.");
  });

  it("shows a saved file's screenshot in place of a frame, and a file with neither as a plain line", () => {
    expect(previewCard({ id: "file:/d/deck", kind: "file", url: "/rail-file/t/d/deck.html", frame: "/rail-file/t/d/deck.html", image: "/d/deck-desktop.png" })).toMatchObject({ image: railImageSrc("/d/deck-desktop.png") });
    expect(previewCard({ id: "file:/d/deck", kind: "file", url: "/rail-file/t/d/deck.html" }).preview).toBeUndefined();
  });

  it("shows a review board through its own page, and a reply naming the board gets the same card", () => {
    const board = { id: "live:http://127.0.0.1:4387/session/ea82", kind: "live" as const, url: "http://127.0.0.1:4387/session/ea82", title: "Review board: GNM Sponsor Decks", line: "gnm-decks", frame: "/rail-file/t/data/gnm-decks/review.html" };
    const deck = { id: "file:/d/deck", kind: "file" as const, url: "/rail-file/t/d/deck.pdf", title: "Sponsor deck", line: "gnm-decks · PDF + HTML", frame: "/rail-file/t/d/deck.html" };
    const options = { live: () => "blocked" as const, known: (preview: { url: string }) => (preview.url === board.url ? board : preview) as never };
    const alone = composeRail([], [], [board, deck], options);
    expect(alone.artefacts[0]).toMatchObject({ title: "Review board: GNM Sponsor Decks", url: board.url, preview: board.frame });
    expect(alone.artefacts[1]).toMatchObject({ title: "Sponsor deck", url: deck.url, preview: deck.frame });
    const named = composeRail([{ question: user("q", "decks?"), answer: assistant("a", "Board is at http://127.0.0.1:4387/session/ea82.", "q") }], [], [board, deck], options);
    expect(named.conversations[0]!.previews![0]).toMatchObject({ title: "Review board: GNM Sponsor Decks", preview: board.frame });
    expect(named.artefacts.map((card) => card.id)).toEqual([deck.id]);
  });

  it("links a live page that refuses framing instead of framing it blank", () => {
    const card = previewCard({ id: "live:u", kind: "live", url: "http://127.0.0.1:4387/session/x" }, "blocked");
    expect(card).toMatchObject({ blocked: true, url: "http://127.0.0.1:4387/session/x" });
    expect(card.preview).toBeUndefined();
  });

  it("drops conversation rows with no words", () => {
    const rail = composeRail([{ question: user("q", "   ") }], []);
    expect(rail.conversations).toEqual([]);
  });
});

describe("the server behind a live preview", () => {
  const projects = [{ id: "gnm-good-neighbours-market", name: "GNM (Good Neighbours Market)", repos: ["/Users/george/Documents/good_neighbours"] }];
  const home = "/Users/george";

  it("says the project's own folder, or a copy of it", () => {
    expect(whoseFolder("/Users/george/Documents/good_neighbours", projects)).toEqual({ whose: "GNM's own folder", own: true });
    expect(whoseFolder("/Users/george/Documents/firstmate/data/gnm-preview/site", projects)).toEqual({ whose: "a copy, not GNM's own folder", own: false });
    expect(whoseFolder("/tmp/elsewhere", projects)).toBeUndefined();
  });

  it("puts the process, folder and whose it is on the card", () => {
    const server = railServer("http://127.0.0.1:8088/", { server: { pid: 9, command: "php -S", folder: "/Users/george/Documents/good_neighbours" } }, projects, home);
    expect(server).toEqual({ address: "127.0.0.1:8088", command: "php -S", folder: "~/Documents/good_neighbours", whose: "GNM's own folder", own: true });
    const card = previewCard({ id: "live:http://127.0.0.1:8088/", kind: "live", url: "http://127.0.0.1:8088/" }, "up", server);
    expect(card.server).toBe(server);
    expect(card.preview).toBe("http://127.0.0.1:8088/");
  });

  it("tells what changed behind the address and when", () => {
    const at = "2026-10-11T10:42:00.000Z";
    const own = { pid: 1, command: "php -S", folder: "/Users/george/Documents/good_neighbours" };
    const copy = { pid: 2, command: "php -S", folder: "/Users/george/data/gnm-preview/site" };
    expect(changeNotice({ at, was: null, now: own }, home)).toEqual({ at, title: "Server started", detail: "php -S serving ~/Documents/good_neighbours" });
    expect(changeNotice({ at, was: own, now: null }, home)).toEqual({ at, title: "Server stopped", detail: "was php -S serving ~/Documents/good_neighbours" });
    expect(changeNotice({ at, was: own, now: copy }, home)).toEqual({ at, title: "Server changed", detail: "now php -S serving ~/data/gnm-preview/site, was ~/Documents/good_neighbours" });
    expect(changeNotice({ at, was: own, now: { ...own, pid: 3 } }, home).title).toBe("Server restarted");
    const down = previewCard({ id: "live:x", kind: "live", url: "http://127.0.0.1:8088/" }, "down", railServer("http://127.0.0.1:8088/", { server: null, change: { at, was: own, now: null } }, projects, home));
    expect(down.down).toBe(true);
    expect(down.server?.changed?.title).toBe("Server stopped");
    expect(down.server?.command).toBeUndefined();
  });

  it("asks the server only for live pages", () => {
    const asked: string[] = [];
    const rail = composeRail([], [], [
      { id: "live:http://127.0.0.1:8088/", kind: "live", url: "http://127.0.0.1:8088/" },
      { id: "image:/tmp/a.png", kind: "image", url: "/tmp/a.png" },
    ], { live: () => "up", server: (url) => { asked.push(url); return { address: "127.0.0.1:8088", command: "php -S" }; } });
    expect(asked).toEqual(["http://127.0.0.1:8088/"]);
    expect(rail.artefacts[0]!.server?.command).toBe("php -S");
    expect(rail.artefacts[1]!.server).toBeUndefined();
  });
});

describe("one row per message", () => {
  const at = (minute: number) => `2026-10-12T09:${String(minute).padStart(2, "0")}:00Z`;

  it("keeps every message its own row with its own answer, however close behind the last it came", () => {
    const rail = composeRail([
      { question: user("q1", "make the header sticky", at(0)), answer: assistant("a1", "Sticky now.", "q1") },
      { question: user("q2", "and darker", at(3)), waiting: "Working on it" },
    ], []);
    expect(rail.conversations.map((talk) => [talk.id, talk.answer, talk.state])).toEqual([["q1", "Sticky now.", "done"], ["q2", undefined, "underway"]]);
  });

  it("says where each stands: an answer that asks him something needs him, any other is done, none is under way", () => {
    expect(railState({ answer: assistant("a", "Both are live now.", "q") })).toBe("done");
    expect(railState({ answer: assistant("a", "It's built. Want me to merge it?", "q") })).toBe("needs");
    expect(railState({ answer: assistant("a", "Ready, it waits on your go-ahead.", "q") })).toBe("needs");
    expect(railState({ answer: assistant("a", "Agreed. Each note gets a row tagged done, under way or needs you.", "q") })).toBe("done");
    expect(railState({ answer: assistant("a", "The fix is under way; a worker is running the checks.", "q") })).toBe("underway");
    expect(railState({ answer: assistant("a", "Merged. The checks were running for a while.", "q") })).toBe("done");
    for (const text of ["Your Rails dev server is running on port 3000.", "USB Overdrive is a driver being sold since 2000.", "Running the tests showed 3 failures."]) {
      expect(railState({ answer: assistant("a", text, "q") })).toBe("done");
    }
    expect(railState({ answer: assistant("a", "The checks are still running.", "ask:1") })).toBe("done");
    expect(railState({ answered: true })).toBe("done");
    expect(railState({})).toBe("underway");
    expect(railState({ answered: true, state: "underway" })).toBe("underway");
  });

  it("names the artefact or decision a note was about, linked, and never shows the task id or raw page line", () => {
    const note = 'About the artefact "Flyd island notification spans from screen middle to the right edge"\nTask: flyd-island-half\nPage: https://github.com/GeorgeGally/flyd/pull/139\n\nthe island is too tall and big.';
    expect(plainNote(note)).toEqual({
      words: "the island is too tall and big.",
      about: { title: "Flyd island notification spans from screen middle to the right edge", url: "https://github.com/GeorgeGally/flyd/pull/139" },
    });
    expect(plainNote("Answer to pending decision gnm-sell-step-pick: Pick a layout\nQuestion: Which one?\n\n3")).toEqual({ words: "3", about: { title: "Pick a layout" } });
    expect(plainNote("just words")).toEqual({ words: "just words" });
    expect(plainNote('About the artefact "He prefers "calm" UI"\nDetail: Quiet colours, no motion\n\nwhy?')).toEqual({ words: "why?", about: { title: 'He prefers "calm" UI' } });
    expect(plainNote('About the artefact "Finished a job for you"\nLine: gnm notes\nDetail: The file is at ~/x.md\n\nOpen it')).toEqual({ words: "Open it", about: { title: "Finished a job for you" } });
    const rail = composeRail([{ question: user("note:1", note, at(0)), waiting: "" }], []);
    expect(rail.conversations[0]).toMatchObject({ question: "the island is too tall and big.", about: { title: expect.stringContaining("Flyd island") } });
    expect(JSON.stringify(rail.conversations[0])).not.toMatch(/Task: |Page: /);
  });
});

describe("phone work", () => {
  const said = (text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({ id: text, role: "user", text, ...extra });

  it("knows the work is at phone width from its words or its screenshots", () => {
    expect(phoneWork([said("the hero on mobile is cramped")])).toBe(true);
    expect(phoneWork([said("check it at 390px wide")])).toBe(true);
    expect(phoneWork([said("looks off at 375x812")])).toBe(true);
    expect(phoneWork([said("Done.", { role: "assistant", shots: ["/tmp/shots/after-phone.png"] })])).toBe(true);
    expect(phoneWork([said("tighten the header on desktop")])).toBe(false);
    expect(phoneWork([said("add a phone number to the footer")])).toBe(false);
    // Only lately: talk of phones long ago is not this work.
    expect(phoneWork([said("on mobile it wraps"), ...Array.from({ length: 12 }, (_, index) => said(`desktop pass ${index}`))])).toBe(false);
  });

  it("shows a framed live page on a phone while the work is at phone width", () => {
    const preview = { id: "live:http://127.0.0.1:8088/", kind: "live" as const, url: "http://127.0.0.1:8088/" };
    expect(composeRail([], [], [preview], { phone: true }).artefacts[0]).toMatchObject({ preview: "http://127.0.0.1:8088/", phone: true });
    expect(composeRail([], [], [preview]).artefacts[0]!.phone).toBeUndefined();
    // A page not running is not put on a phone.
    expect(composeRail([], [], [preview], { phone: true, live: () => "down" }).artefacts[0]!.phone).toBeUndefined();
  });

  it("writes his comment as a note with the page, the viewport and the spot", () => {
    expect(phoneCommentNote({ url: "http://127.0.0.1:8088/", x: 12.6, y: 40, text: " Bigger. " })).toBe("Comment on the phone preview of http://127.0.0.1:8088/ (390×844 viewport), at x 13, y 40 of the screen:\n\nBigger.");
    expect(loopbackPage("http://localhost:3000/a#b")).toBe("http://localhost:3000/a#b");
    expect(loopbackPage("https://example.com/")).toBeNull();
    expect(loopbackPage("file:///etc/passwd")).toBeNull();
  });
});
