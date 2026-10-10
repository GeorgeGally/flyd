import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { htmlTitle, openBoards, recentDeliverables, Workshop } from "../workshop.js";

function tree(): string {
  const data = join(mkdtempSync(join(tmpdir(), "flyd-workshop-")), "data");
  mkdirSync(join(data, "gnm-decks"), { recursive: true });
  writeFileSync(join(data, "gnm-decks", "review.html"), "<html><head><title>GNM Sponsor Decks</title></head></html>");
  writeFileSync(join(data, "gnm-decks", "sponsor-deck.html"), "<title>Good Neighbours Sponsor Deck</title>");
  writeFileSync(join(data, "gnm-decks", "sponsor-deck.pdf"), "%PDF");
  writeFileSync(join(data, "gnm-decks", "bintang-deck.pdf"), "%PDF");
  writeFileSync(join(data, "gnm-decks", "report.md"), "# report");
  return data;
}

const state = (data: string) => JSON.stringify({
  sessions: {
    old: { key: "old", file: join(data, "gnm-decks", "lab.html"), url: "http://127.0.0.1:4387/session/old", status: "ended" },
    ea82: { key: "ea82", file: join(data, "gnm-decks", "review.html"), url: "http://127.0.0.1:4387/session/ea82", status: "open" },
    remote: { key: "remote", file: "/x.html", url: "https://example.com/session/x", status: "open" },
  },
});

describe("openBoards", () => {
  it("lists only open loopback Lavish boards, titled by the page they review", () => {
    const data = tree();
    expect(openBoards(state(data), data)).toEqual([
      { key: "ea82", url: "http://127.0.0.1:4387/session/ea82", file: join(data, "gnm-decks", "review.html"), title: "GNM Sponsor Decks", task: "gnm-decks" },
    ]);
    expect(openBoards("not json", data)).toEqual([]);
  });
});

describe("recentDeliverables", () => {
  it("pairs a deck's PDF and HTML, skips a board's own page and anything old", () => {
    const data = tree();
    const old = join(data, "gnm-decks", "bintang-deck.pdf");
    utimesSync(old, new Date("2026-01-01"), new Date("2026-01-01"));
    const found = recentDeliverables(data, Date.now(), new Set([join(data, "gnm-decks", "review.html")]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      title: "Good Neighbours Sponsor Deck",
      task: "gnm-decks",
      open: join(data, "gnm-decks", "sponsor-deck.pdf"),
      html: join(data, "gnm-decks", "sponsor-deck.html"),
      kinds: ["pdf", "html"],
    });
  });

  it("names a lone PDF from its file name", () => {
    const data = tree();
    const found = recentDeliverables(data, Date.now(), new Set([join(data, "gnm-decks", "review.html"), join(data, "gnm-decks", "sponsor-deck.html"), join(data, "gnm-decks", "sponsor-deck.pdf")]));
    expect(found.map((entry) => entry.title)).toEqual(["Bintang deck"]);
  });
});

describe("Workshop", () => {
  it("keeps a board's page out of the deliverables", () => {
    const data = tree();
    const stateFile = join(data, "..", "state.json");
    writeFileSync(stateFile, state(data));
    const { boards, deliverables } = new Workshop(() => data, () => stateFile).current();
    expect(boards.map((board) => board.key)).toEqual(["ea82"]);
    expect(deliverables.some((entry) => entry.html?.endsWith("review.html"))).toBe(false);
  });

  it("reads a title from the head only", () => {
    const data = tree();
    expect(htmlTitle(join(data, "gnm-decks", "review.html"))).toBe("GNM Sponsor Decks");
    expect(htmlTitle(join(data, "missing.html"))).toBeUndefined();
  });
});
