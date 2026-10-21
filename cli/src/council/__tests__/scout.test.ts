import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  editionActivityRecord, evolveScout, fitness, latestEdition, parseLast30days, readSources, readTaste, recentFlashes, recordScoutFeedback,
  runScout, scoutTick, SEED_TASTE, seedSources, takeEvolutionNotes, watchScout, writeSources, type Edition, type ScoutSource,
} from "../scout.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-scout-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const at = (iso: string) => new Date(iso);
const rss = (items: Array<{ title: string; link: string; date?: string }>) =>
  `<?xml version="1.0"?><rss><channel><title>Feed</title>${items.map((item) => `<item><title>${item.title}</title><link>${item.link}</link><pubDate>${item.date ?? "Sat, 26 Sep 2026 10:00:00 GMT"}</pubDate><description>about ${item.title}</description></item>`).join("")}</channel></rss>`;

function fakeFetch(byHost: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.entries(byHost).find(([key]) => url.includes(key));
    return hit ? new Response(hit[1], { status: 200 }) : new Response("nope", { status: 404 });
  }) as typeof fetch;
}

function onlySources(list: Array<Partial<ScoutSource> & Pick<ScoutSource, "kind" | "name" | "target">>): void {
  const own = list.map((source) => ({ id: `${source.kind}:${source.target.toLowerCase().replace(/^https?:\/\//, "")}`, status: "active", shown: 0, likes: 0, dislikes: 0, failures: 0, addedBy: "seed", addedAt: "2026-09-01T00:00:00Z", ...source } as ScoutSource));
  const ids = new Set(own.map((source) => source.id));
  writeSources([...own, ...seedSources(at("2026-09-01T00:00:00Z")).filter((source) => !ids.has(source.id)).map((source) => ({ ...source, status: "paused" as const }))], dir);
}

describe("scout sources", () => {
  it("seeds from George's own Hermes curator: his feeds, subreddits, and taste", () => {
    const sources = readSources(dir, at("2026-09-27T08:00:00Z"));
    expect(sources.some((source) => source.name === "Simon Willison" && source.status === "active")).toBe(true);
    expect(sources.some((source) => source.name === "r/GenerativeOrdinals")).toBe(true);
    expect(sources.some((source) => source.status === "reserve")).toBe(true);
    expect(readTaste(dir)).toBe(SEED_TASTE);
    expect(SEED_TASTE).toContain("Avoid: generic world news, politics, crypto price speculation");
  });

  it("unions defaults added later into the managed population without disturbing it", () => {
    writeSources([
      { id: "rss:waxy.org/feed", kind: "rss", name: "Waxy.org", target: "https://waxy.org/feed/", status: "active", shown: 9, likes: 4, dislikes: 0, failures: 0, addedBy: "george", addedAt: "2026-09-01T00:00:00Z" },
    ], dir);
    const sources = readSources(dir, at("2026-10-18T08:00:00Z"));
    expect(sources[0]).toMatchObject({ name: "Waxy.org", shown: 9, likes: 4, addedBy: "george" });
    expect(sources.some((source) => source.name === "r/Bitcoin" && source.status === "active")).toBe(true);
    expect(sources.some((source) => source.name === "FlowingData" && source.status === "reserve")).toBe(true);
    expect(readSources(dir).filter((source) => source.name === "r/Bitcoin")).toHaveLength(1);
  });

  it("leaves an unreadable sources file untouched", () => {
    writeFileSync(join(dir, "sources.json"), "[{ half-edited");
    expect(readSources(dir)).toEqual([]);
    expect(readFileSync(join(dir, "sources.json"), "utf8")).toBe("[{ half-edited");
  });

  it("scores fitness as a posterior that fades with unrewarded exposure", () => {
    expect(fitness({ likes: 0, dislikes: 0, shown: 0 })).toBe(0.5);
    expect(fitness({ likes: 3, dislikes: 0, shown: 3 })).toBeGreaterThan(0.75);
    expect(fitness({ likes: 0, dislikes: 0, shown: 12 })).toBeLessThan(0.3);
  });

  it("normalises last30days output", () => {
    const parsed = parseLast30days(JSON.stringify({ results: [{ url: "https://x.test/a", title: "A", source: "reddit", engagement: { upvotes: 40 } }, { title: "no url" }] }), "ai parenting apps");
    expect(parsed).toEqual([expect.objectContaining({ url: "https://x.test/a", topic: "ai parenting apps", engagement: "40 upvotes" })]);
  });
});

describe("edition, feedback, and watch", () => {
  it("ranks a personal edition, never repeats an item, and learns from feedback", async () => {
    onlySources([
      { kind: "rss", name: "Waxy.org", target: "https://waxy.org/feed/" },
      { kind: "reddit", name: "r/generative", target: "generative" },
    ]);
    const fetchFn = fakeFetch({
      "waxy.org": rss([{ title: "An archive of 1990s GeoCities art", link: "https://waxy.org/geocities" }]),
      "reddit.com/r/generative": rss([{ title: "New on-chain generative audio technique", link: "https://reddit.com/r/generative/abc" }]),
    });
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Plan 4")) return '{"topics": []}';
      prompts.push(prompt);
      const indexOf = (title: string) => prompt.split("\n").find((line) => line.includes(title))?.match(/^\[(\d+)\]/)?.[1];
      return JSON.stringify({ picks: [
        { index: Number(indexOf("on-chain generative audio")), kind: "relevant", why: "Direct precedent for Music for Blockchains." },
        { index: Number(indexOf("GeoCities")), kind: "rabbit_hole", why: "Internet archaeology you love." },
      ] });
    });
    const now = at("2026-09-27T07:00:00Z");
    const first = await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => now });
    expect(first.edition?.items.map((item) => item.kind)).toEqual(["relevant", "rabbit_hole"]);
    expect(prompts[0]).toContain("crypto art, generative art, and creative tech");
    expect(await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => now })).toMatchObject({ skipped: "already_today" });

    expect(recordScoutFeedback(1, "more", dir, now)?.title).toBe("New on-chain generative audio technique");
    const generative = readSources(dir).find((source) => source.name === "r/generative")!;
    expect(generative).toMatchObject({ likes: 1, shown: 1 });

    const second = await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, force: true, now: () => at("2026-09-28T07:00:00Z") });
    expect(second.edition?.items).toEqual([]);
    expect(prompts).toHaveLength(1);
  });

  it("treats a Reddit rate limit as a pause, not a failing source", async () => {
    onlySources([
      { kind: "reddit", name: "r/one", target: "one" },
      { kind: "reddit", name: "r/two", target: "two" },
    ]);
    const hits: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => { hits.push(String(input)); return new Response("slow down", { status: 429 }); }) as typeof fetch;
    await runScout({ complete: vi.fn(async () => '{"picks": []}'), fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-09-27T07:00:00Z") });
    expect(hits).toHaveLength(1);
    expect(readSources(dir).slice(0, 2).every((source) => source.failures === 0 && source.status === "active")).toBe(true);
  });

  it("lets every source reach the ranker even when early feeds alone would fill the candidate cap", async () => {
    const feeds = Array.from({ length: 14 }, (_, index) => ({ kind: "rss" as const, name: `Feed ${index}`, target: `https://feed${index}.test/rss` }));
    onlySources([...feeds, { kind: "reddit", name: "r/ordinals", target: "ordinals" }]);
    const fetchFn = fakeFetch({
      ...Object.fromEntries(feeds.map((_, index) => [`feed${index}.test`, rss(Array.from({ length: 12 }, (_, item) => ({ title: `Feed ${index} story ${item}`, link: `https://feed${index}.test/${item}` })))])),
      "reddit.com/r/ordinals": rss([{ title: "A new recursive inscription technique", link: "https://reddit.com/r/ordinals/xyz" }]),
    });
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Plan 4")) return '{"topics": []}';
      prompts.push(prompt);
      return '{"picks": []}';
    });
    await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-09-27T07:00:00Z") });
    const candidates = prompts[0]!.split("\n").filter((line) => /^\[\d+\]/.test(line));
    expect(candidates).toHaveLength(150);
    expect(prompts[0]).toContain("A new recursive inscription technique");
    expect(feeds.every((_, index) => prompts[0]!.includes(`Feed ${index} story 0`))).toBe(true);
  });

  it("pauses a source after repeated fetch failures instead of dropping it", async () => {
    onlySources([{ kind: "rss", name: "Dead feed", target: "https://dead.test/feed" }]);
    const complete = vi.fn(async () => '{"picks": []}');
    for (let day = 1; day <= 5; day += 1) {
      await runScout({ complete, fetchFn: fakeFetch({}), dir, force: true, now: () => at(`2026-09-${String(20 + day).padStart(2, "0")}T07:00:00Z`) });
    }
    expect(readSources(dir)[0]).toMatchObject({ status: "paused", failures: 5 });
  });

  it("watch stays silent unless something is must-know, and notifies within the daily cap", async () => {
    onlySources([{ kind: "rss", name: "TechCrunch", target: "https://techcrunch.test/feed" }]);
    const fetchFn = fakeFetch({ "techcrunch.test": rss([
      { title: "Ollie raises $7.5M for AI parenting assistant", link: "https://tc.test/ollie" },
      { title: "Another phone launched", link: "https://tc.test/phone" },
    ]) });
    const notify = vi.fn(async () => {});
    const complete = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("quiet background watch");
      const index = prompt.split("\n").find((line) => line.includes("Ollie"))?.match(/^\[(\d+)\]/)?.[1];
      return JSON.stringify({ picks: [{ index: Number(index), kind: "must", why: "A direct Koko competitor just raised." }] });
    });
    const now = at("2026-09-27T09:00:00Z");
    const musts = await watchScout({ complete, fetchFn, notify, dir, redditSpacingMs: 0, now: () => now });
    expect(musts.map((item) => item.title)).toEqual(["Ollie raises $7.5M for AI parenting assistant"]);
    expect(notify).toHaveBeenCalledWith("Flyd", "Ollie raises $7.5M for AI parenting assistant — A direct Koko competitor just raised.");
    expect(recentFlashes(dir, now)).toHaveLength(1);
    // Already examined: the next watch does not even call the model.
    expect(await watchScout({ complete, fetchFn, notify, dir, redditSpacingMs: 0, now: () => now })).toEqual([]);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe("edition brief", () => {
  const edition: Edition = {
    date: "2026-10-18",
    generatedAt: "2026-10-18T06:00:00.000Z",
    topics: ["Bitcoin & Crypto Art", "Creative Coding"],
    items: [
      { n: 1, title: "A new ordinal generative technique", url: "https://x.test/ordinal", source: "r/ordinals", topic: "Bitcoin & Crypto Art", why: "Direct precedent for your work", kind: "must" },
      { n: 2, title: "Game of Life on a torus", url: "https://x.test/torus", source: "r/creativecoding", topic: "Creative Coding", why: "Creative coding you love", kind: "rabbit_hole" },
    ],
  };

  it("keeps the whole brief as one record whose card opens to it", () => {
    const record = editionActivityRecord(edition);
    expect(record).toMatchObject({ key: "scout-edition", kind: "news", title: "Put together today's news", line: "2 stories from your sources.", state: "done", at: edition.generatedAt });
    expect(record.stories).toEqual([
      { title: "A new ordinal generative technique", url: "https://x.test/ordinal", gist: "Direct precedent for your work", source: "r/ordinals" },
      { title: "Game of Life on a torus", url: "https://x.test/torus", gist: "Creative coding you love", source: "r/creativecoding" },
    ]);
    expect(record).not.toHaveProperty("detail");
  });

  it("records the day's brief with the activity only when it has stories and is wired to", async () => {
    onlySources([{ kind: "rss", name: "Waxy.org", target: "https://waxy.org/feed/" }]);
    const fetchFn = fakeFetch({ "waxy.org": rss([{ title: "Story", link: "https://waxy.org/s" }]) });
    const planning = '{"topics": []}';
    const empty = vi.fn();
    await runScout({ complete: vi.fn(async (prompt: string) => prompt.startsWith("Plan 4") ? planning : '{"picks": []}'), fetchFn, dir, record: empty, now: () => at("2026-09-26T07:00:00Z") });
    expect(empty).not.toHaveBeenCalled();
    const record = vi.fn();
    await runScout({ complete: vi.fn(async (prompt: string) => prompt.startsWith("Plan 4") ? planning : '{"picks": [{"index": 0, "kind": "relevant", "why": "worth his time"}]}'), fetchFn, dir, record, force: true, now: () => at("2026-09-27T07:00:00Z") });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-09-27" }));
  });
});

describe("evolution", () => {
  it("pauses sources that keep missing, explores the reserve, breeds new sources, revises taste, and tells George", async () => {
    writeSources([
      { id: "rss:dull.test/feed", kind: "rss", name: "Dull", target: "https://dull.test/feed", status: "active", shown: 10, likes: 0, dislikes: 2, failures: 0, addedBy: "seed", addedAt: "2026-09-01T00:00:00Z" },
      { id: "reddit:generative", kind: "reddit", name: "r/generative", target: "generative", status: "active", shown: 4, likes: 3, dislikes: 0, failures: 0, addedBy: "seed", addedAt: "2026-09-01T00:00:00Z" },
      { id: "rss:flowingdata.com/feed", kind: "rss", name: "FlowingData", target: "https://flowingdata.com/feed", status: "reserve", shown: 0, likes: 0, dislikes: 0, failures: 0, addedBy: "seed", addedAt: "2026-09-01T00:00:00Z" },
    ], dir);
    const complete = vi.fn(async () => JSON.stringify({
      add: [
        { kind: "reddit", name: "r/algorithmicmusic", target: "r/algorithmicmusic", why: "He liked on-chain generative audio" },
        { kind: "rss", target: "http://insecure.test/feed" },
        { kind: "reddit", target: "generative" },
      ],
      taste: `${SEED_TASTE}\nFavour especially: generative audio and sound-reactive work.`,
      taste_change: "now favours generative audio",
    }));
    const changes = await evolveScout({ complete, dir, now: () => at("2026-09-27T07:00:00Z") });
    expect(changes.map((change) => change.kind)).toEqual(["paused", "revived", "added", "taste"]);
    const sources = readSources(dir);
    expect(sources.find((source) => source.name === "Dull")?.status).toBe("paused");
    expect(sources.find((source) => source.name === "FlowingData")?.status).toBe("active");
    expect(sources.find((source) => source.target === "algorithmicmusic")).toMatchObject({ addedBy: "evolution", status: "active" });
    expect(sources.some((source) => source.target === "http://insecure.test/feed")).toBe(false);
    expect(readTaste(dir)).toContain("generative audio");
    expect(readFileSync(join(dir, "taste-history.jsonl"), "utf8")).toContain("crypto art");
    expect(takeEvolutionNotes(dir)).toEqual([
      "paused: Dull (fit 0.17 after 10 shown)", "revived: trying FlowingData",
      "added: r/algorithmicmusic — He liked on-chain generative audio", "taste: now favours generative audio",
    ]);
    expect(takeEvolutionNotes(dir)).toEqual([]);
  });

  it("the tick builds the morning edition, then watches, and only evolves once there is feedback", async () => {
    onlySources([{ kind: "rss", name: "Waxy.org", target: "https://waxy.org/feed/" }]);
    const fetchFn = fakeFetch({ "waxy.org": rss([{ title: "Story", link: "https://waxy.org/s" }]) });
    const complete = vi.fn(async () => '{"picks": []}');
    // Scout keeps George's local clock, so the morning is 07:30 wherever the test runs.
    const morning = new Date(2026, 8, 27, 7, 30);
    expect(await scoutTick({ complete, fetchFn, dir, now: () => morning })).toEqual(["edition: 0 items"]);
    expect(latestEdition(dir)?.items).toEqual([]);
    expect(await scoutTick({ complete, fetchFn, dir, now: () => morning })).toEqual(["watch: 0 must-know"]);
  });
});
