import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { editionStories } from "../../conversation-view/activity.js";
import { runScout } from "../scout.js";
import { mixInspiration, workFocus, type InspirationItem, type WorkFocus } from "../inspiration.js";
import { figureIn, gatherInspiration, mediaFromCommons, quoteIn, quotesFromWikiquote, statsFromWikipedia, threadsFromHn } from "../inspiration-sources.js";

const now = Date.parse("2026-10-27T08:00:00Z");
const focus: WorkFocus[] = [{ id: "flyd", title: "Flyd", detail: "personal intelligence for the launch" }];

function item(partial: InspirationItem): InspirationItem {
  return partial;
}

describe("mixInspiration", () => {
  const stat = item({
    url: "https://en.wikipedia.org/wiki/Flyd", title: "Flyd sessions", source: "Wikipedia", sourceId: "wiki:flyd",
    summary: "Flyd kept 12% of sessions after the launch.", media: "stat", figure: "12%", obscure: true,
  });
  const otherStat = item({
    url: "https://en.wikipedia.org/wiki/Census", title: "Census", source: "Wikipedia", sourceId: "wiki:census",
    summary: "A census counted 4 million people.", media: "stat", figure: "4 million", obscure: true,
  });
  const verge = item({
    url: "https://www.theverge.com/2026/10/26/gadget", title: "Another phone", source: "The Verge", sourceId: "verge",
    summary: "A review of a phone.", media: "article", published: "2026-10-26",
  });
  const blog = item({
    url: "https://plotter.example/obscure", title: "A pen plotter nobody covers", source: "Studio", sourceId: "studio",
    summary: "An obscure plotter.", media: "article", published: "2026-10-26", obscure: true,
  });
  const gif = item({
    url: "https://commons.wikimedia.org/wiki/File:Loop.gif", title: "Loop", source: "Wikimedia Commons", sourceId: "commons:gif",
    summary: "Loop", media: "gif", mediaUrl: "https://upload.wikimedia.org/loop.gif", obscure: true,
  });
  const video = item({
    url: "https://commons.wikimedia.org/wiki/File:Talk.webm", title: "Talk", source: "Wikimedia Commons", sourceId: "commons:video",
    summary: "Talk", media: "video", obscure: true,
  });
  const image = item({
    url: "https://commons.wikimedia.org/wiki/File:Print.jpg", title: "Print", source: "Wikimedia Commons", sourceId: "commons:image",
    summary: "Print", media: "image", obscure: true,
  });
  const quote = item({
    url: "https://en.wikiquote.org/wiki/Flyd", title: "Flyd", source: "Wikiquote", sourceId: "wikiquote",
    summary: "The weights live beside the prompt.", media: "quote", quote: "The weights live beside the prompt.", attribution: "A note", obscure: true,
  });
  const thread = item({
    url: "https://news.ycombinator.com/item?id=9", title: "A quiet thread on Flyd", source: "Hacker News", sourceId: "hn",
    summary: "Thread about a small host.", media: "thread", obscure: true,
  });

  it("holds a seat for each medium and prefers the project and the obscure source", () => {
    const mixed = mixInspiration([otherStat, stat, verge, blog, gif, video, image, quote, thread], focus, { now, limit: 7 });
    expect(mixed.find((hit) => hit.media === "stat")?.figure).toBe("12%");
    expect(mixed.map((hit) => hit.media).sort()).toEqual(["article", "gif", "image", "quote", "stat", "thread", "video"]);
    expect(mixed.some((hit) => hit.url.includes("theverge"))).toBe(false);
    expect(mixed.find((hit) => hit.media === "article")?.url).toBe(blog.url);
    expect(mixed.find((hit) => hit.media === "stat")?.match).toBe("Flyd");
  });

  it("drops a seen article and a stale one, and waits to repeat a quote", () => {
    const stale = item({ ...blog, url: "https://plotter.example/old", sourceId: "old", published: "2020-01-01" });
    const seen = new Set([blog.url]);
    const mixed = mixInspiration([blog, stale, quote], focus, { now, seen, lastShown: new Map([[quote.url, now - 60_000]]) });
    expect(mixed.map((hit) => hit.url)).toEqual([]);
  });

  it("reads active projects and open jobs, and skips a finished job", () => {
    expect(workFocus(
      [{ id: "flyd", name: "Flyd", status: "active", what: "personal intelligence", now: "the launch" }, { id: "old", name: "Old", status: "done", what: "retired" }],
      [{ title: "Ship the sidebar", project: "Flyd", group: "working", next: "cards" }, { title: "Archive it", project: "Old", group: "done" }],
    ).map((job) => job.title)).toEqual(["Flyd"]);
  });
});

describe("inspiration parsers", () => {
  it("reads a figure, a quote, a commons file and a quiet thread", () => {
    expect(figureIn("About 12% of studios shipped.")).toBe("12%");
    expect(quoteIn('She said “The weights live beside the prompt.” — Ada')).toEqual({ quote: "The weights live beside the prompt.", attribution: "Ada" });
    const stats = statsFromWikipedia({ query: { pages: { "1": { title: "Flyd", extract: "Flyd kept 12% of sessions after the launch. The rest is history." } } } });
    expect(stats[0]).toMatchObject({ media: "stat", figure: "12%", obscure: true });
    const quotes = quotesFromWikiquote({ query: { pages: { "1": { title: "Ada", extract: '“The weights live beside the prompt.” — Ada' } } } });
    expect(quotes[0]).toMatchObject({ media: "quote", quote: "The weights live beside the prompt." });
    const media = mediaFromCommons({ query: { pages: {
      a: { title: "File:Loop.gif", imageinfo: [{ url: "https://upload.wikimedia.org/loop.gif", mime: "image/gif" }] },
      b: { title: "File:Print.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/print.jpg", mime: "image/jpeg" }] },
      c: { title: "File:Talk.webm", imageinfo: [{ url: "https://upload.wikimedia.org/talk.webm", mime: "video/webm" }] },
    } } });
    expect(media.map((hit) => hit.media).sort()).toEqual(["gif", "image", "video"]);
    const threads = threadsFromHn({ hits: [
      { objectID: "2", title: "Loud", url: "https://www.theverge.com/x", points: 400 },
      { objectID: "9", title: "Quiet", url: "https://plotter.example/x", points: 3 },
    ] });
    expect(threads[0]).toMatchObject({ title: "Quiet", media: "thread", url: "https://news.ycombinator.com/item?id=9" });
    expect(JSON.stringify(threads)).not.toContain("400");
  });
});

describe("gatherInspiration", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("fetches once and then serves the cache", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-inspire-"));
    let calls = 0;
    const search = async () => {
      calls += 1;
      return [item({ url: "https://en.wikipedia.org/wiki/Flyd", title: "Flyd", source: "Wikipedia", sourceId: "wiki", summary: "12%", media: "stat", figure: "12%" })];
    };
    const first = await gatherInspiration(dir, focus, { now: new Date(now), search });
    const second = await gatherInspiration(dir, focus, { now: new Date(now + 60_000), search: async () => { throw new Error("fetched again"); } });
    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it("seats the cached finds in the day's edition", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-inspire-edition-"));
    const inspiration = [
      item({ url: "https://en.wikipedia.org/wiki/Flyd", title: "Flyd sessions", source: "Wikipedia", sourceId: "wiki", summary: "Flyd kept 12% of sessions.", media: "stat", figure: "12%", obscure: true }),
      item({ url: "https://commons.wikimedia.org/wiki/File:Loop.gif", title: "Loop", source: "Wikimedia Commons", sourceId: "commons:gif", summary: "Loop", media: "gif", mediaUrl: "https://upload.wikimedia.org/loop.gif", obscure: true }),
    ];
    const result = await runScout({
      complete: async (prompt) => prompt.startsWith("Plan ") ? '{"topics":[]}' : '{"picks":[]}',
      fetchFn: (async () => new Response("no", { status: 404 })) as typeof fetch,
      dir,
      redditSpacingMs: 0,
      now: () => new Date(now),
      focus,
      inspiration,
    });
    expect(result.edition?.items.map((hit) => hit.media)).toEqual(["stat", "gif"]);
    const stories = editionStories(result.edition, "2026-10-27")?.stories;
    expect(stories?.[0]).toMatchObject({ media: "stat", figure: "12%" });
    expect(stories?.[1]).toMatchObject({ media: "gif" });
    expect(JSON.stringify(stories)).not.toContain("upload.wikimedia.org");
  });
});
