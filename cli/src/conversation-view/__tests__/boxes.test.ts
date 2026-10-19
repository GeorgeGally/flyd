import { describe, expect, it } from "vitest";
import { alertsOf, boxesOf, clampDepth, instrumentsOf, MAX_DEPTH, withClosedLinks, type Box } from "../boxes.js";
import type { ShowItem, ShowScreen } from "../show.js";
import type { WeatherReading } from "../weather.js";

const NOW = Date.parse("2026-10-10T04:00:00Z");

function screen(items: ShowItem[], extra: Partial<ShowScreen> = {}): ShowScreen {
  return { title: "Your move, sir.", summary: "One needs you.", items, counts: {}, live: false, ...extra };
}

const call: ShowItem = { id: "call:1", kind: "call", headline: "The island filter is paused on your call. A or B?", why: "waiting on you", ref: "m1" };
const landed: ShowItem = {
  id: "landed:2",
  kind: "landed",
  headline: "The setup card fix landed",
  why: "just landed",
  shots: [{ src: "/a.png", label: "after" }, { src: "/b.png", label: "before" }, { src: "/c.png", label: "extra" }],
};
const news: ShowItem = { id: "news:3", kind: "news", headline: "Open-weight model released", why: "from the news" };

function depth(boxes: Box[], level = 1): number {
  return Math.max(0, ...boxes.map((box) => (box.children ? depth(box.children, level + 1) : level)));
}

describe("boxesOf", () => {
  it("leads with the calls only he can make", () => {
    const boxes = boxesOf(screen([landed, call, news]), { now: NOW });
    expect(boxes[0]).toMatchObject({ id: "calls", kind: "group", size: "lead", title: "One call only you can make" });
    expect(boxes[0]!.children?.[0]).toMatchObject({ kind: "call", title: call.headline, ref: "m1" });
  });

  it("opens on the work itself when nothing waits on him, with no filler line", () => {
    const boxes = boxesOf(screen([landed]), { now: NOW });
    expect(boxes[0]).toMatchObject({ id: "stories" });
    expect(boxes.some((box) => box.id === "situation")).toBe(false);
  });

  it("says where things stand only when there is nothing else to show", () => {
    const boxes = boxesOf(screen([]), { now: NOW });
    expect(boxes[0]).toMatchObject({ id: "situation", kind: "note" });
  });

  it("puts stories in one group, each holding at most four of its screenshots", () => {
    const many = { ...landed, shots: [...landed.shots!, { src: "/d.png", label: "d" }, { src: "/e.png", label: "e" }] };
    const stories = boxesOf(screen([many, news]), { now: NOW }).find((box) => box.id === "stories")!;
    expect(stories.children?.map((box) => box.title)).toEqual([landed.headline, news.headline]);
    expect(stories.children?.[0]!.children?.map((box) => box.kind)).toEqual(["shot", "shot", "shot", "shot"]);
  });

  it("tells the work with pictures first, and only a couple of stories in words", () => {
    const words = (id: string): ShowItem => ({ id, kind: "live", headline: `Words ${id}`, why: "" });
    const pictured = (id: string): ShowItem => ({ ...landed, id, headline: `Pictured ${id}` });
    const stories = boxesOf(screen([words("w1"), words("w2"), words("w3"), pictured("p1"), pictured("p2")]), { now: NOW }).find((box) => box.id === "stories")!;
    expect(stories.children?.map((box) => box.title)).toEqual(["Pictured p1", "Pictured p2", "Words w1", "Words w2"]);
  });

  it("never shows more than MAX_DEPTH levels", () => {
    expect(depth(boxesOf(screen([call, landed]), { now: NOW }))).toBeLessThanOrEqual(MAX_DEPTH);
  });

  it("opens the side column with what Flyd sees coming, before the numbers", () => {
    const boxes = boxesOf(screen([call, landed]), { now: NOW, plan: { source: "quota-axi", windows: [{ label: "weekly", percentRemaining: 12 }] } });
    expect(boxes.map((box) => [box.id, box.size])).toEqual([["calls", "lead"], ["stories", "main"], ["instruments", "side"]]);
    expect(boxes[2]!.children?.map((box) => box.id)).toEqual(["alert:plan:weekly", "plan"]);
  });
});

describe("alertsOf", () => {
  const rainy: WeatherReading = {
    place: "Canggu",
    tempC: 29,
    code: 80,
    condition: "showers",
    read: "2026-10-10T04:00:00Z",
    hours: [
      { at: "2026-10-10T11:00", tempC: 29, rainChance: 20 },
      { at: "2026-10-10T12:00", tempC: 29, rainChance: 40 },
      { at: "2026-10-10T13:00", tempC: 28, rainChance: 75 },
    ],
  };

  it("says rain is coming before it starts", () => {
    expect(alertsOf({ weather: rainy, now: NOW })).toEqual([
      expect.objectContaining({ id: "alert:rain", title: "Rain likely from 13:00 in Canggu (75%).", tone: "warn" }),
    ]);
  });

  it("stays quiet about rain past the next few hours", () => {
    const later = { ...rainy, hours: [...Array(6).fill({ at: "2026-10-10T11:00", tempC: 29, rainChance: 10 }), { at: "2026-10-10T17:00", tempC: 27, rainChance: 90 }] };
    expect(alertsOf({ weather: later, now: NOW })).toEqual([]);
  });

  it("warns about a plan limit running low, with when it resets", () => {
    const alerts = alertsOf({ now: NOW, plan: { source: "quota-axi", windows: [{ label: "session", percentRemaining: 18, resetsAt: "2026-10-10T07:00:00Z" }, { label: "weekly", percentRemaining: 60 }] } });
    expect(alerts.map((box) => box.title)).toEqual(["Claude session limit: 18% left, resets in 3h."]);
  });
});

describe("instrumentsOf", () => {
  it("draws weather, plan, the week and the work by state, leaving out what has no data", () => {
    const boxes = instrumentsOf(
      screen([], {
        counts: { call: 1, live: 2, next: 0 },
        landedByDay: [{ day: "2026-10-09", count: 2 }, { day: "2026-10-10", count: 1 }],
      }),
      { plan: { source: "quota-axi", windows: [{ label: "weekly", percentRemaining: 70 }] } },
    );
    expect(boxes.map((box) => box.id)).toEqual(["plan", "landed-week", "work-state"]);
    expect(boxes[0]!.gauges).toEqual([{ label: "weekly", used: 30 }]);
    expect(boxes[1]!.bars?.map((bar) => bar.label)).toEqual(["Fri", "Sat"]);
    expect(boxes[2]!.bars?.map((bar) => [bar.label, bar.value])).toEqual([["need you", 1], ["under way", 2]]);
  });

  it("draws nothing for a week with nothing landed", () => {
    expect(instrumentsOf(screen([], { landedByDay: [{ day: "2026-10-10", count: 0 }] }), {})).toEqual([]);
  });
});

describe("clampDepth", () => {
  it("drops children past the limit", () => {
    const leaf = (id: string, children?: Box[]): Box => ({ id, kind: "group", size: "wide", title: id, why: "", ...(children ? { children } : {}) });
    const deep = leaf("a", [leaf("b", [leaf("c", [leaf("d")])])]);
    const clamped = clampDepth([deep])[0]!;
    expect(clamped.children?.[0]!.children?.[0]!.title).toBe("c");
    expect(clamped.children?.[0]!.children?.[0]!.children).toBeUndefined();
  });
});

describe("withClosedLinks", () => {
  it("marks a link to a page on this machine that stopped answering, and leaves the rest as links", () => {
    const links = [
      { label: "Open design review", url: "http://127.0.0.1:4387/session/a" },
      { label: "Preview", url: "http://localhost:8097/" },
      { label: "flyd #9", url: "https://github.com/o/flyd/pull/9" },
    ];
    const boxes: Box[] = [{ id: "calls", kind: "group", size: "lead", title: "", why: "", children: [{ id: "c", kind: "call", size: "wide", title: "Pick", why: "", links }] }];
    const asked: string[] = [];
    const marked = withClosedLinks(boxes, (url) => { asked.push(url); return url.includes("4387") ? "down" : "up"; });
    expect(marked[0]!.children![0]!.links).toEqual([{ ...links[0], closed: true }, links[1], links[2]]);
    // Only pages on this machine are checked.
    expect(asked).toEqual([links[0]!.url, links[1]!.url]);
    expect(withClosedLinks(boxes, () => "checking")[0]!.children![0]!.links).toEqual(links);
  });
});
