import { describe, expect, it } from "vitest";
import { SIDEBAR_LIB } from "../page/sidebar-lib.js";
import { threadId } from "../project-threads.js";

// The sidebar's content rules run here exactly as the page runs them: the same browser code, on its own.
interface Item { title: string; text?: string; by?: string; at?: string; image?: string; intentional?: boolean }
const lib = new Function(`${SIDEBAR_LIB}; return { sideNowLine, sideSlug, sideShortcuts, sideShortcutFor, sideTerms, sideMatches, sidePicture, sideDotDetail };`)() as {
  sideNowLine(text: string, room?: number): string;
  sideSlug(name: string): string;
  sideShortcuts(threads: Array<{ id: string; name: string }>): Array<{ name: string; project: string; thread: string }>;
  sideShortcutFor(typed: string, shortcuts: Array<{ name: string; thread: string }>): { name: string; thread: string } | null;
  sideTerms(texts: string[], most?: number): string[];
  sideMatches(items: Item[], terms: string[], most?: number): Item[];
  sidePicture(item: Item): string;
  sideDotDetail(job: { state?: string; project?: string }, when?: string): string;
};

describe("the live line", () => {
  it("is one whole line: a short one as it is, a long one by its first sentence, never cut off with an ellipsis", () => {
    expect(lib.sideNowLine("Deploying notes 53–58 to Kinsta")).toBe("Deploying notes 53–58 to Kinsta");
    const long = "The swatch row is back at the top of the colour panel in Logan. The smart swatches sit underneath it and the HSB sliders below them, on a branch waiting for your look.";
    expect(lib.sideNowLine(long)).toBe("The swatch row is back at the top of the colour panel in Logan.");
    // With no sentence or clause that fits, the line stays whole and wraps rather than lose its end.
    const run = "Recording BTC windows across every five minute market and the fifteen minute ones too while the backtest keeps going";
    expect(lib.sideNowLine(run, 40)).toBe(run);
    for (const line of [long, run, "x".repeat(300)]) expect(lib.sideNowLine(line, 60)).not.toMatch(/…|\.\.\.$/);
  });

  it("drops the dangling end of a line that arrived already cut, keeping what it said whole", () => {
    expect(lib.sideNowLine("Pierre: hardware-style redesign lab on a Liesel board (Codex): Choose the...")).toBe("Pierre: hardware-style redesign lab on a Liesel board (Codex)");
    expect(lib.sideNowLine("Checking six pages live on phone…")).toBe("Checking six pages live on phone");
    // With no whole clause to fall back to, the words left hanging go too.
    expect(lib.sideNowLine("Deploy the hosting change to the...")).toBe("Deploy the hosting change");
    expect(lib.sideNowLine("Choose the...")).toBe("Choose");
  });

  it("puts the detail behind the dot in plain words: where it stands, where and since when", () => {
    expect(lib.sideDotDetail({ state: "Working", project: "Logan" }, "10:42")).toBe("Working in Logan, 10:42");
    expect(lib.sideDotDetail({}, "")).toBe("Under way");
  });
});

describe("the project shortcut", () => {
  const threads = [
    { id: threadId("Flyd"), name: "Flyd" },
    { id: threadId("Good Neighbours Market"), name: "Good Neighbours Market" },
    { id: "project:all", name: "All conversations" },
    { id: "project:other", name: "Other" },
  ];

  it("names each project by its thread's own slug, /flyd for Flyd, leaving out All and Other", () => {
    expect(lib.sideShortcuts(threads)).toEqual([
      { name: "flyd", project: "Flyd", thread: "project:flyd" },
      { name: "good-neighbours-market", project: "Good Neighbours Market", thread: "project:good-neighbours-market" },
    ]);
    expect(`project:${lib.sideSlug("Good Neighbours Market")}`).toBe(threadId("Good Neighbours Market"));
  });

  it("takes a message box holding exactly the shortcut, and nothing more", () => {
    const shortcuts = lib.sideShortcuts(threads);
    expect(lib.sideShortcutFor("/flyd", shortcuts)?.thread).toBe("project:flyd");
    expect(lib.sideShortcutFor("  /Flyd ", shortcuts)?.thread).toBe("project:flyd");
    expect(lib.sideShortcutFor("/flyd fix the news", shortcuts)).toBeNull();
    expect(lib.sideShortcutFor("/fly", shortcuts)).toBeNull();
    expect(lib.sideShortcutFor("flyd", shortcuts)).toBeNull();
  });
});

describe("for this chat", () => {
  it("reads what he is talking about from his newest words: names and longer words, not filler", () => {
    expect(lib.sideTerms(["How is polybot looking? Worth paper trading yet?", "Where are we with the Logan swatches?"])).toEqual(["Logan", "swatches", "polybot"]);
    expect(lib.sideTerms(["ok thanks", "yes please"])).toEqual([]);
  });

  it("shows only what matches the talk, best match first", () => {
    const items: Item[] = [
      { title: "Polymarket fees", text: "Taker only" },
      { title: "Logan swatches back at the top", text: "Smart swatches below" },
      { title: "Swatch picker idea", text: "Logan colour panel" },
    ];
    expect(lib.sideMatches(items, ["Logan", "swatches"]).map((item) => item.title)).toEqual(["Logan swatches back at the top", "Swatch picker idea"]);
    expect(lib.sideMatches(items, [])).toEqual([]);
  });

  it("shows a picture only when the item says it is meant to be seen, never because one exists", () => {
    expect(lib.sidePicture({ title: "A screenshot it only looked at", image: "/api/story-image?id=1" })).toBe("");
    expect(lib.sidePicture({ title: "Flagged off", image: "/api/story-image?id=1", intentional: false })).toBe("");
    expect(lib.sidePicture({ title: "Meant to be seen", image: "/api/story-image?id=2", intentional: true })).toBe("/api/story-image?id=2");
    expect(lib.sidePicture({ title: "Meant, but nothing to show", intentional: true })).toBe("");
  });
});
