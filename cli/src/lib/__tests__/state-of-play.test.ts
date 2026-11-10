import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStateReport, playKind, StateOfPlay, stateOfPlayBlock } from "../state-of-play.js";

const ROUND_UP = `DIR
- More videos and GIFs: landed and pushed. It goes live with the next deploy.
  - Videos go from 25% to 55% of artwork. GIFs go from 25% to 30%. Everything else drops from 50% to 15%.
  - The delayed lerp points artworks no longer get cut off after a few seconds.
- Station ID between sets: started. Each set ends with a short ident.
- Still in progress: the slow start, the generation fix (now deploying), the 16:9 previews, and the request page.

Flyd
- Bug card: a fix is under way so Flyd keeps that Expected/Observed/Cause card to itself.
- Deep dive: started. It reads the whole conversation view.`;

const PROJECTS = [{ name: "DIR", aliases: ["Dead Internet Radio"] }, { name: "Flyd", aliases: ["flyd"] }];

describe("state of play", () => {
  it("reads firstmate's round-up as each project's state, in a short line apiece", () => {
    const sections = parseStateReport(ROUND_UP, PROJECTS);
    expect(sections.map((section) => section.project)).toEqual(["DIR", "Flyd"]);
    // As firstmate writes it: bold headings and bold item leads.
    const bold = ROUND_UP.replace(/^(DIR|Flyd)$/gm, "**$1**").replace("- Station ID between sets: started.", "- **Station ID between sets: started.**");
    expect(parseStateReport(`Captain, here's where things stand.\n\n${bold}`, PROJECTS).map((section) => section.items.length)).toEqual([3, 2]);
    const file = join(mkdtempSync(join(tmpdir(), "play-")), "state.json");
    const play = new StateOfPlay(file);
    const now = Date.parse("2026-11-10T02:00:00Z");
    const news = play.record({ id: "m1", text: ROUND_UP, timestamp: "2026-11-10T01:30:00Z" }, PROJECTS, now);
    expect(news.map((item) => item.line)).toEqual([
      "DIR: more videos and GIFs landed; station ID between sets and 4 more under way.",
      "Flyd: bug card and deep dive under way.",
    ]);
    expect(playKind(news)).toBe("deliverable");
    // Read again (the transcript is re-read every few seconds): nothing new to tell.
    expect(play.record({ id: "m1", text: ROUND_UP, timestamp: "2026-11-10T01:30:00Z" }, PROJECTS, now)).toEqual([]);
    expect(stateOfPlayBlock(file, now)).toContain("- DIR: more videos and GIFs landed");
    expect(play.untold(now)).toHaveLength(2);
    play.markTold(play.untold(now));
    expect(play.untold(now)).toEqual([]);
  });

  it("leaves ordinary replies and unknown headings alone", () => {
    expect(parseStateReport("Done — the island filter is fixed and merged.", PROJECTS)).toEqual([]);
    expect(parseStateReport("Notes\n- Tests: started.\n- Lint: started.", PROJECTS)).toEqual([]);
  });

  it("an older report never overwrites a newer one, and history is not news", () => {
    const file = join(mkdtempSync(join(tmpdir(), "play-")), "state.json");
    const play = new StateOfPlay(file);
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(play.record({ id: "new", text: ROUND_UP, timestamp: "2026-11-10T01:00:00Z" }, PROJECTS, now)).toEqual([]);
    play.record({ id: "old", text: "DIR\n- Request page: blocked on the login.\n- Previews: started.", timestamp: "2026-11-09T20:00:00Z" }, PROJECTS, now);
    expect(play.current(now).find((item) => item.project === "DIR")?.source).toBe("new");
  });

  it("reads each item's state from its status, not from words in what it is about", () => {
    const report = `DIR
- Fix for the failing previews: landed and pushed.
- Layout: Flyd will decide the layout next.
- Request page: landed after review.
- Still in progress: search and replace.
- Still in progress: the intro, the outro and the credits.
- Blocked: waiting on the PC.
- Up next: the intro, the outro and the credits.`;
    const [dir] = parseStateReport(report, PROJECTS);
    expect(dir!.items.map((item) => [item.label, item.state, item.count])).toEqual([
      ["Fix for the failing previews", "landed", 1],
      ["Layout", "moving", 1],
      ["Request page", "landed", 1],
      ["Still in progress", "moving", 1],
      ["Still in progress", "moving", 3],
      ["Blocked", "stuck", 1],
      ["Up next", "moving", 1],
    ]);
    const file = join(mkdtempSync(join(tmpdir(), "play-")), "state.json");
    const news = new StateOfPlay(file).record({ id: "m", text: report.split("\n").slice(0, 2).join("\n") + "\n- Deep dive: started.", timestamp: "2026-11-10T01:30:00Z" }, PROJECTS, Date.parse("2026-11-10T02:00:00Z"));
    expect(playKind(news)).toBe("deliverable");
  });
});
