import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  editionActivityRecord, evolveScout, reviveFailedSources, fitness, latestEdition, parseLast30days, readSources, readTaste, recentFlashes, recordScoutFeedback,
  runScout, scoutTick, SEED_TASTE, seedSources, takeEvolutionNotes, watchScout, writeSources, type Edition, type ScoutSource,
} from "../scout.js";
import { activityFromRecords } from "../../conversation-view/activity.js";

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
      { title: "A new ordinal generative technique", url: "https://x.test/ordinal", kind: "must", gist: "Direct precedent for your work", source: "r/ordinals" },
      { title: "Game of Life on a torus", url: "https://x.test/torus", kind: "rabbit_hole", gist: "Creative coding you love", source: "r/creativecoding" },
    ]);
    expect(record).not.toHaveProperty("detail");
    expect(activityFromRecords([record], Date.parse(edition.generatedAt) + 60_000).done[0]!.stories!.map((story) => story.mark)).toEqual(["Hot", "Rabbit hole"]);
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

  it("the tick evolves weekly without waiting for feedback, builds the morning edition, then watches", async () => {
    onlySources([{ kind: "rss", name: "Waxy.org", target: "https://waxy.org/feed/" }]);
    const fetchFn = fakeFetch({ "waxy.org": rss([{ title: "Story", link: "https://waxy.org/s" }]) });
    const complete = vi.fn(async () => '{"picks": []}');
    // Scout keeps George's local clock, so the morning is 07:30 wherever the test runs.
    const morning = new Date(2026, 8, 27, 7, 30);
    expect(await scoutTick({ complete, fetchFn, dir, now: () => morning })).toEqual(["evolved: no changes", "edition: 0 items"]);
    expect(latestEdition(dir)?.items).toEqual([]);
    expect(await scoutTick({ complete, fetchFn, dir, now: () => morning })).toEqual(["watch: 0 must-know"]);
  });

  it("gives failure-paused sources one retry after they rest, but leaves taste pauses alone", () => {
    const base = { shown: 0, likes: 0, dislikes: 0, addedBy: "seed" as const, addedAt: "2026-09-01T00:00:00Z" };
    const sources: ScoutSource[] = [
      { ...base, id: "reddit:ordinals", kind: "reddit", name: "r/ordinals", target: "ordinals", status: "paused", failures: 5, note: "paused after 5 consecutive fetch failures", lastFetchedAt: "2026-10-12T09:00:00Z" },
      { ...base, id: "reddit:p5js", kind: "reddit", name: "r/p5js", target: "p5js", status: "paused", failures: 5, note: "paused after 5 consecutive fetch failures", pausedAt: "2026-10-23T09:00:00Z" },
      { ...base, id: "rss:dull.test/feed", kind: "rss", name: "Dull", target: "https://dull.test/feed", status: "paused", failures: 0, note: "paused by evolution 2026-09-01", pausedAt: "2026-09-01T00:00:00Z" },
    ];
    const { sources: next, revived } = reviveFailedSources(sources, at("2026-10-24T10:00:00Z"));
    expect(revived.map((source) => source.name)).toEqual(["r/ordinals"]);
    // One failure from paused again.
    expect(next[0]).toMatchObject({ status: "active", failures: 4 });
    expect(next[1]!.status).toBe("paused");
    expect(next[2]!.status).toBe("paused");
  });

  it("evolves with no feedback: explores more reserve while sources are paused, and replans topics from taste", async () => {
    const base = { shown: 0, likes: 0, dislikes: 0, failures: 0, addedBy: "seed" as const, addedAt: "2026-09-01T00:00:00Z" };
    writeSources([
      { ...base, id: "reddit:a", kind: "reddit", name: "r/a", target: "a", status: "paused", note: "paused by evolution 2026-09-01" },
      { ...base, id: "reddit:b", kind: "reddit", name: "r/b", target: "b", status: "paused", note: "paused by evolution 2026-09-01" },
      { ...base, id: "rss:one.test/feed", kind: "rss", name: "One", target: "https://one.test/feed", status: "reserve" },
      { ...base, id: "rss:two.test/feed", kind: "rss", name: "Two", target: "https://two.test/feed", status: "reserve" },
      { ...base, id: "rss:three.test/feed", kind: "rss", name: "Three", target: "https://three.test/feed", status: "reserve" },
      { ...base, id: "topic:hybrid search query rewriting", kind: "topic", name: "hybrid search query rewriting", target: "hybrid search query rewriting", status: "active", addedBy: "evolution" },
      { ...base, id: "topic:ordinals recursion", kind: "topic", name: "ordinals recursion", target: "ordinals recursion", status: "active", addedBy: "george" },
    ], dir);
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return prompt.startsWith("Plan 3") ? JSON.stringify({ topics: [
        { topic: "touchdesigner audio reactive", why: "creative coding" },
        { topic: "ordinals recursion", why: "duplicate of a kept one" },
        { topic: "esp32 cyberdeck builds", why: "hardware hacking" },
      ] }) : "{}";
    });
    const changes = await evolveScout({ complete, dir, now: () => at("2026-10-24T07:00:00Z") });
    const sources = readSources(dir);
    expect(sources.filter((source) => source.status === "active" && source.target.includes(".test/")).map((source) => source.name)).toEqual(["One", "Two"]);
    expect(prompts[0]).toContain("crypto art, generative art");
    expect(prompts[0]).toContain("Already searching (do not repeat): ordinals recursion");
    const topics = sources.filter((source) => source.kind === "topic" && source.status === "active").map((source) => source.target);
    expect(topics).toEqual(["ordinals recursion", "touchdesigner audio reactive", "esp32 cyberdeck builds"]);
    expect(sources.find((source) => source.target === "hybrid search query rewriting")?.status).toBe("paused");
    expect(changes.map((change) => change.kind)).toEqual(["revived", "revived", "topics"]);
  });

  it("records more/less by story link or source id, for a view button", async () => {
    onlySources([{ kind: "rss", name: "Waxy.org", target: "https://waxy.org/feed/" }]);
    const now = at("2026-09-27T07:00:00Z");
    const edition: Edition = { date: "2026-09-27", generatedAt: now.toISOString(), topics: ["Internet"], items: [
      { n: 1, title: "Story", url: "https://waxy.org/s", source: "Waxy.org", sourceId: "rss:waxy.org/feed/", topic: "Internet", why: "good", kind: "relevant" },
    ] };
    writeFileSync(join(dir, "edition-latest.json"), JSON.stringify(edition));
    expect(recordScoutFeedback("https://waxy.org/s", "more", dir, now)?.title).toBe("Story");
    expect(recordScoutFeedback({ sourceId: "rss:waxy.org/feed/" }, "less", dir, now)?.title).toBe("Waxy.org");
    expect(recordScoutFeedback("https://nowhere.test/x", "more", dir, now)).toBeNull();
    expect(readSources(dir).find((source) => source.name === "Waxy.org")).toMatchObject({ likes: 1, dislikes: 1 });
    expect(readFileSync(join(dir, "feedback.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });
});

describe("the edition draws on the whole day", () => {
  const indexOf = (prompt: string, title: string) => Number(prompt.split("\n").find((line) => line.includes(title))?.match(/^\[(\d+)\]/)?.[1]);

  it("ranks what the day's watches fetched even when Reddit rate-limits the morning edition", async () => {
    onlySources([
      { kind: "rss", name: "Hackaday", target: "https://hackaday.test/feed" },
      { kind: "reddit", name: "r/generative", target: "generative" },
    ]);
    let redditBlocked = false;
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("hackaday.test")) return new Response(rss([{ title: "A clamp meter runs DOOM", link: "https://hackaday.test/doom" }]), { status: 200 });
      if (url.includes("reddit.com/r/generative")) {
        return redditBlocked ? new Response("slow down", { status: 429 }) : new Response(rss([{ title: "Flow fields from bird migration data", link: "https://www.reddit.com/r/generative/flow" }]), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    }) as typeof fetch;

    // A daytime watch fetches the subreddit; nothing in it is must-know.
    await watchScout({ complete: vi.fn(async () => '{"picks": []}'), fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-09-27T09:00:00Z") });

    // Next morning Reddit answers 429, but the edition still sees the watch's find.
    redditBlocked = true;
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Plan 4")) return '{"topics": []}';
      prompts.push(prompt);
      return JSON.stringify({ picks: [{ index: indexOf(prompt, "Flow fields"), kind: "relevant", why: "Data as a brush." }] });
    });
    const result = await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-09-28T06:00:00Z") });
    expect(prompts[0]).toContain("A clamp meter runs DOOM");
    expect(result.edition?.items.map((item) => item.source)).toEqual(["r/generative"]);

    // Used once: the pool empties with the edition, so the next one does not rank it again.
    const later: string[] = [];
    await runScout({ complete: vi.fn(async (prompt: string) => { later.push(prompt); return '{"picks": []}'; }), fetchFn, dir, redditSpacingMs: 0, force: true, now: () => at("2026-09-29T06:00:00Z") });
    expect(later.join("\n")).not.toContain("Flow fields");
  });

  it("caps any one source so a prolific feed cannot fill the edition", async () => {
    onlySources([
      { kind: "rss", name: "Hackaday", target: "https://hackaday.test/feed" },
      { kind: "rss", name: "Waxy.org", target: "https://waxy.test/feed" },
    ]);
    const fetchFn = fakeFetch({
      "hackaday.test": rss(Array.from({ length: 6 }, (_, n) => ({ title: `Hack ${n}`, link: `https://hackaday.test/${n}` }))),
      "waxy.test": rss([{ title: "Waxy link", link: "https://waxy.test/1" }]),
    });
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Plan 4")) return '{"topics": []}';
      expect(prompt).toContain("at most 3 picks from any one source");
      const picks = [...Array.from({ length: 6 }, (_, n) => `Hack ${n}`), "Waxy link"].map((title) => ({ index: indexOf(prompt, title), kind: "relevant", why: "good" }));
      return JSON.stringify({ picks });
    });
    const result = await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-09-27T06:00:00Z") });
    expect(result.edition?.items.filter((item) => item.source === "Hackaday")).toHaveLength(3);
    expect(result.edition?.items.some((item) => item.source === "Waxy.org")).toBe(true);
  });

  it("names every subreddit r/<name>, whether seeded, bred by evolution, or stored before the fix", async () => {
    writeSources([
      { id: "reddit:oldinternet", kind: "reddit", name: "oldinternet", target: "oldinternet", status: "active", shown: 0, likes: 0, dislikes: 0, failures: 0, addedBy: "evolution", addedAt: "2026-10-24T00:00:00Z" },
    ], dir);
    expect(readSources(dir).find((source) => source.target === "oldinternet")?.name).toBe("r/oldinternet");
    const complete = vi.fn(async (prompt: string) => prompt.startsWith("Plan") ? '{"topics": []}' : JSON.stringify({ add: [{ kind: "reddit", name: "IndustrialDesign", target: "IndustrialDesign", why: "form" }] }));
    await evolveScout({ complete, dir, now: () => at("2026-10-24T07:00:00Z") });
    expect(readSources(dir).find((source) => source.target === "IndustrialDesign")?.name).toBe("r/IndustrialDesign");
  });
});
