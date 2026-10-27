import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { editionStories } from "../../conversation-view/activity.js";
import { runScout } from "../scout.js";
import { fileURLToPath } from "node:url";
import {
  buildDigest, dedupeInspiration, ensureQueryAnchor, matchContext, minOverlap, mixInspiration, ngramTerms, workFocus,
  type InspirationItem, type WorkFocus,
} from "../inspiration.js";
import {
  acceptStat, expandQuery, figureIn, gatherInspiration, gifsFromGiphy, giphyCooldownUntil, imagesFromPexels,
  mediaFromCommons, newsFromBrave, quoteIn, quotesFromWikiquote, quotesFromZen, readShown, markShown,
  statsFromBrave, statsFromOwidCsv, statsFromWikipedia, statsFromWorldBank, threadsFromHn, threadsFromReddit,
  trendsFromRss, videosFromPexels,
} from "../inspiration-sources.js";

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

  it("drops a seen article and a stale one, and recycles the oldest quote when nothing fresh is left", () => {
    const stale = item({ ...blog, url: "https://plotter.example/old", sourceId: "old", published: "2020-01-01" });
    const older = item({ ...quote, url: "https://en.wikiquote.org/wiki/Older", quote: "Older line about a quiet workshop.", summary: "Older line about a quiet workshop." });
    const newer = item({ ...quote, url: "https://en.wikiquote.org/wiki/Newer", quote: "Newer line about a quiet workshop.", summary: "Newer line about a quiet workshop." });
    expect(mixInspiration([blog, stale], focus, { now, seen: new Set([blog.url]) })).toEqual([]);
    const recycled = mixInspiration([newer, older], focus, {
      now,
      lastShown: new Map([[newer.url, now - 1_000], [older.url, now - 50_000]]),
      limit: 1,
    });
    expect(recycled.map((hit) => hit.url)).toEqual([older.url]);
    const fresh = mixInspiration([newer, quote], focus, { now, lastShown: new Map([[newer.url, now - 1_000]]), limit: 1 });
    expect(fresh[0]?.url).toBe(quote.url);
  });

  it("round-robins sources and drops a repeated url or the same quote", () => {
    const a1 = item({ url: "https://a.example/1", title: "Alpha one", source: "A", sourceId: "a", summary: "Alpha one piece.", media: "article", published: "2026-10-26" });
    const a2 = item({ url: "https://a.example/2", title: "Alpha two", source: "A", sourceId: "a", summary: "Alpha two piece.", media: "article", published: "2026-10-26" });
    const b1 = item({ url: "https://b.example/1", title: "Beta one", source: "B", sourceId: "b", summary: "Beta one piece.", media: "article", published: "2026-10-26" });
    expect(mixInspiration([a1, a2, b1, { ...a1 }], [], { now, limit: 3 }).map((hit) => hit.url)).toEqual([a1.url, b1.url, a2.url]);
    const again = item({ ...quote, url: "https://en.wikiquote.org/wiki/Copy" });
    expect(dedupeInspiration([quote, again, quote]).map((hit) => hit.url)).toEqual([quote.url]);
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
    await gatherInspiration(dir, [{ id: "cap", title: "Capfire", detail: "a different open job" }], { now: new Date(now + 60_000), search });
    expect(calls).toBe(2);
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

  it("skips keyed sources when the env var is absent, and remembers a Giphy 429", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-inspire-keys-"));
    const saved = Object.fromEntries(["GIPHY_API_KEY", "PEXELS_API_KEY", "REDDIT_CLIENT_ID", "REDDIT_API_SECRET", "BRAVE_SEARCH_API_KEY", "BRAVE_SEARCH_GOGGLES"].map((name) => [name, process.env[name]]));
    for (const name of Object.keys(saved)) delete process.env[name];
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response("{}", { status: 404 });
    };
    try {
      await gatherInspiration(dir, focus, { now: new Date(now), fetchImpl });
      const joined = urls.join("\n");
      expect(joined).toContain("hn.algolia.com");
      expect(joined).toContain("zenquotes.io");
      expect(joined).toContain("trends.google.com/trending/rss");
      expect(joined).not.toContain("giphy");
      expect(joined).not.toContain("pexels");
      expect(joined).not.toContain("reddit");
      expect(joined).not.toContain("brave");
      expect(joined).not.toContain("worldbank");
      expect(joined).not.toContain("ourworldindata");
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("context digest and expansion", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("builds a lexical digest of the open job and ignores a merely related phrase", () => {
    expect(() => buildDigest(null as never)).not.toThrow();
    const digest = buildDigest(focus);
    expect(digest.promptContext.split("\n").length).toBeLessThanOrEqual(6);
    expect(digest.signature).not.toBe(buildDigest([{ id: "cap", title: "Capfire", detail: "a different job" }]).signature);
    expect(JSON.stringify(digest)).not.toMatch(/embed/i);
    const hit = matchContext("How Flyd handles personal intelligence", digest, "news");
    expect(hit.topics.map((topic) => topic.name)).toContain("Flyd");
    expect(hit.beliefs.length).toBeGreaterThan(0);
    const miss = matchContext("quarterly revenue forecast", digest, "news");
    expect(miss.topics).toEqual([]);
    expect(miss.beliefs).toEqual([]);
    const short = buildDigest([], { beliefs: [{ topic: "Flyd", claim: "launch" }] });
    expect(minOverlap(2, "facts")).toBe(2);
    expect(matchContext("flyd only", short, "facts").beliefs).toEqual([]);
    expect(matchContext("flyd launch day", short, "facts").beliefs).toHaveLength(1);
  });

  it("keeps the original term and falls back to n-grams when the model throws", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-inspire-expand-"));
    expect(ensureQueryAnchor("flyd", ["flyd", "tools", "personal intelligence", "one two three four five six"])).toEqual(["flyd", "personal intelligence"]);
    const digest = buildDigest(focus);
    expect(ngramTerms(digest, "flyd", now)[0]).toBe("flyd");
    const logs: string[] = [];
    let calls = 0;
    const ask = async (prompt: string) => {
      calls += 1;
      expect(prompt).toContain("only if it is directly relevant");
      expect(prompt).toContain("flyd");
      if (calls === 1) throw new Error("model down");
      return '{"search_terms":["personal intelligence","quiet tools"]}';
    };
    const fallen = await expandQuery(dir, "flyd", digest, { now: new Date(now), ask, log: (line) => logs.push(line) });
    expect(fallen[0]).toBe("flyd");
    expect(fallen.length).toBeGreaterThan(1);
    expect(logs).toEqual([]);
    const modeled = await expandQuery(dir, "flyd", digest, { now: new Date(now + 25 * 3_600_000), ask, log: (line) => logs.push(line) });
    expect(modeled).toEqual(["flyd", "personal intelligence", "quiet tools"]);
    expect(logs[0]).toMatch(/est_usd=/);
    expect(logs[0]).toMatch(/not a bill/);
    const again = await expandQuery(dir, "flyd", digest, { now: new Date(now + 26 * 3_600_000), ask: async () => { throw new Error("should be cached"); } });
    expect(again).toEqual(modeled);
    expect(calls).toBe(2);
  });
});

describe("keyed source parsers", () => {
  it("reads real payloads and refuses a number that was not in them", () => {
    expect(gifsFromGiphy({ data: [{ title: "Loop", url: "https://giphy.com/gifs/loop", images: { original: { url: "https://media.giphy.com/loop.gif" } } }] })[0]).toMatchObject({ media: "gif", source: "Giphy" });
    expect(imagesFromPexels({ photos: [{ url: "https://www.pexels.com/photo/1/", alt: "A plotter", photographer: "Ada", src: { landscape: "https://images.pexels.com/p.jpg" } }] })[0]).toMatchObject({ media: "image", source: "Pexels" });
    expect(videosFromPexels({ videos: [{ url: "https://www.pexels.com/video/1/", duration: 75, user: { name: "Ada" }, video_files: [{ quality: "sd", file_type: "video/mp4", link: "https://v.pexels.com/sd.mp4", width: 640 }, { quality: "hd", file_type: "video/mp4", link: "https://v.pexels.com/hd.mp4", width: 1280 }] }] })[0]).toMatchObject({ media: "video", mediaUrl: "https://v.pexels.com/hd.mp4", summary: "1:15 · Ada" });
    const reddit = threadsFromReddit({ data: { children: [
      { data: { title: "Recalled", subreddit: "invented", author: "nobody" } },
      { data: { title: "A quiet workaround", permalink: "/r/plotter/comments/abc/title/", subreddit: "plotter", author: "ada" } },
    ] } });
    expect(reddit).toHaveLength(1);
    expect(reddit[0]?.url).toBe("https://www.reddit.com/r/plotter/comments/abc/title/");
    expect(quotesFromZen([{ q: "Intelligence is the ability to adapt to the work.", a: "A note" }, { q: "The sun also rises over the harbour.", a: "Someone" }], "personal intelligence")).toHaveLength(1);
    const trends = trendsFromRss(`<rss><channel><item><title>plotter</title><ht:news_item><ht:news_item_title>A small studio</ht:news_item_title><ht:news_item_url>https://studio.example/a</ht:news_item_url></ht:news_item></item><item><title>bare</title></item></channel></rss>`);
    expect(trends).toEqual([expect.objectContaining({ url: "https://studio.example/a", source: "Google Trends" })]);
    expect(newsFromBrave({ results: [
      { title: "10 best gadgets - The Verge", url: "https://www.theverge.com/list", description: "A listicle long enough to pass the description length check here." },
      { title: "A pen plotter - Studio", url: "https://studio.example/plotter", description: "A workshop note that is definitely longer than fifty characters.", age: "1 day ago" },
    ] }, now)[0]?.url).toBe("https://studio.example/plotter");
    expect(statsFromBrave({ web: { results: [
      { title: "Papers", url: "https://doi.org/10.1/abc", description: "About 12% of papers, doi:10.1000/xyz and et al." },
      { title: "Towns", url: "https://archive.example/2018", description: "In 2018, 12% of towns kept a press." },
      { title: "Studios", url: "https://studio.example/2024", description: "In 2024, 12% of studios shipped a plotter." },
    ] } }, now).map((hit) => hit.url)).toEqual(["https://studio.example/2024"]);
    expect(acceptStat("007 printers", "007", now)).toBe(false);
    const bank = statsFromWorldBank([{ page: 1 }, [
      { indicator: { id: "SP.POP.TOTL", value: "Population, total" }, country: { value: "World" }, date: "2025", value: 8215424893 },
      { indicator: { id: "EMPTY", value: "Empty" }, country: { value: "World" }, date: "2025", value: null },
    ]], now);
    expect(bank).toHaveLength(1);
    expect(bank[0]?.figure?.replace(/,/g, "")).toBe("8215424893");
    expect(bank[0]?.source).toBe("World Bank");
    expect(statsFromWorldBank([{ page: 1 }, [{ value: null }]], now)).toEqual([]);
    const owid = statsFromOwidCsv("entity,code,year,population_historical\nWorld,OWID_WRL,2010,7000000000\nWorld,OWID_WRL,2023,8000000000\n", "population", "World population", now);
    expect(owid[0]?.figure?.replace(/,/g, "")).toBe("8000000000");
    expect(owid[0]?.source).toBe("Our World in Data");
    expect(statsFromOwidCsv("<html>12%</html>", "population", "World population", now)).toEqual([]);
    expect(statsFromOwidCsv("entity,code,year,population_historical\nWorld,OWID_WRL,2010,12\n", "population", "World population", now)).toEqual([]);
    expect(giphyCooldownUntil(new Headers({ "x-ratelimit-reset": "3600" }), now)).toBe(new Date(now + 3_600_000).toISOString());
    const source = readFileSync(fileURLToPath(new URL("../inspiration-sources.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("VERIFY_NONE");
    expect(source).not.toContain("rejectUnauthorized");
  });

  it("does not call Giphy again while the cooldown is set", async () => {
    const saved = process.env.GIPHY_API_KEY;
    process.env.GIPHY_API_KEY = "test-key";
    const local = mkdtempSync(join(tmpdir(), "flyd-inspire-giphy-"));
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.giphy.com")) {
        calls += 1;
        return new Response("no", { status: 429, headers: { "x-ratelimit-reset": "3600" } });
      }
      return new Response("{}", { status: 404 });
    };
    try {
      await gatherInspiration(local, focus, { now: new Date(now), fetchImpl });
      await gatherInspiration(local, focus, { now: new Date(now + 60_000), fetchImpl });
      expect(calls).toBe(1);
      markShown(local, ["https://en.wikiquote.org/wiki/Older"], new Date(now - 50_000));
      markShown(local, ["https://en.wikiquote.org/wiki/Newer"], new Date(now - 1_000));
      const shown = readShown(local);
      expect(shown.get("https://en.wikiquote.org/wiki/Older")).toBeLessThan(shown.get("https://en.wikiquote.org/wiki/Newer") ?? 0);
    } finally {
      if (saved === undefined) delete process.env.GIPHY_API_KEY;
      else process.env.GIPHY_API_KEY = saved;
      rmSync(local, { recursive: true, force: true });
    }
  });
});
