import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIEF_MAX, EDITION_CANDIDATES, editionActivityRecord, editionTopics, evolveScout, reviveFailedSources, fitness, latestEdition, parseLast30days, parsePicks, poolCandidates, readSources, readTaste, recentFlashes, recordScoutFeedback,
  runScout, scoutTick, SEED_TASTE, seedSources, takeEvolutionNotes, TOPICS_PER_EDITION, watchScout, writeSources, type Edition, type ScoutCandidate, type ScoutSource,
} from "../scout.js";
import type { InspirationItem } from "../inspiration.js";
import { activityFromRecords } from "../../conversation-view/activity.js";
import { providerTrouble, readScoutRun } from "../scout-run.js";
import { readSourceHealth } from "../scout-metrics.js";

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
    expect(readTaste(dir)).toBe(SEED_TASTE);
    expect(SEED_TASTE).toContain("Avoid: generic world news, politics, crypto price speculation");
  });

  it("carries every feed and subreddit Hermes's briefing read", () => {
    const sources = readSources(dir, at("2026-11-14T08:00:00Z"));
    for (const feed of ["Daring Fireball", "Ars Technica", "Hackaday", "Simon Willison", "Waxy.org", "Import AI", "Interconnected", "Two Minute Papers"]) {
      expect(sources.find((source) => source.name === feed)).toMatchObject({ kind: "rss", status: "active" });
    }
    const hermes = [
      "ordinals", "CryptoArt", "GenerativeOrdinals", "Bitcoin", "NFT", "StableDiffusion", "comfyui", "Deforum", "aiArt", "aivideo",
      "creativecoding", "generative", "p5js", "vibecoding", "vjing", "touchdesigner", "creativecode", "hardwarehacking", "esp32", "cyberDeck",
      "synthdiy", "MachineLearning", "generativeAI", "artificial", "LocalLLaMA", "internetisbeautiful", "selfhosted", "DataHoarder",
      "SideProject", "indiehackers", "SaaS", "ReverseEngineering", "HobbyDrama", "AskHistorians", "electronics",
    ];
    expect(hermes).toHaveLength(35);
    const subreddits = new Set(sources.filter((source) => source.kind === "reddit" && source.status === "active").map((source) => source.target.toLowerCase()));
    expect(hermes.filter((sub) => !subreddits.has(sub.toLowerCase()))).toEqual([]);
  });

  it("adds live niche feeds beside Hermes's, and carries general outlets as plain active feeds with no reserve", () => {
    const sources = readSources(dir, at("2026-11-23T08:00:00Z"));
    const active = sources.filter((source) => source.status === "active");
    for (const feed of ["Right Click Save", "Bitcoin Optech", "AI Weirdness", "Red Blob Games", "Ken Shirriff", "Old VCR", "The Digital Antiquarian", "Tedium", "The Public Domain Review"]) {
      expect(active.find((source) => source.name === feed)).toMatchObject({ kind: "rss" });
    }
    for (const sub of ["r/plotterart", "r/lostmedia", "r/demoscene"]) expect(active.some((source) => source.name === sub)).toBe(true);
    for (const outlet of ["TechCrunch", "The Verge", "Slashdot", "Creative Applications", "Atlas Obscura"]) {
      expect(active.find((source) => source.name === outlet)).toMatchObject({ kind: "rss" });
    }
    expect(sources.every((source) => source.status === "active")).toBe(true);
  });

  it("brings stored reserve outlets and subreddits paused by Reddit's refusals back as active", () => {
    const base = { shown: 0, likes: 0, dislikes: 0, addedBy: "seed" as const, addedAt: "2026-09-01T00:00:00Z" };
    writeFileSync(join(dir, "sources.json"), JSON.stringify([
      { ...base, id: "rss:techcrunch.com/feed", kind: "rss", name: "TechCrunch", target: "https://techcrunch.com/feed/", status: "reserve", failures: 0 },
      { ...base, id: "reddit:generative", kind: "reddit", name: "r/generative", target: "generative", status: "paused", failures: 5, note: "paused after 5 consecutive fetch failures", pausedAt: "2026-11-21T10:32:12.997Z" },
      { ...base, id: "reddit:tezos", kind: "reddit", name: "r/tezos", target: "tezos", status: "paused", failures: 0, note: "paused by evolution 2026-11-01" },
      { ...base, id: "rss:dead.test/feed", kind: "rss", name: "Dead", target: "https://dead.test/feed", status: "paused", failures: 5, note: "paused after 5 consecutive fetch failures", pausedAt: "2026-11-21T10:32:12.997Z" },
    ]));
    const sources = readSources(dir, at("2026-11-24T08:00:00Z"));
    expect(sources.find((source) => source.name === "TechCrunch")?.status).toBe("active");
    expect(sources.find((source) => source.name === "r/generative")).toMatchObject({ status: "active", failures: 0 });
    expect(sources.find((source) => source.name === "r/generative")?.pausedAt).toBeUndefined();
    // A taste pause and a failing feed are left as they were.
    expect(sources.find((source) => source.name === "r/tezos")?.status).toBe("paused");
    expect(sources.find((source) => source.name === "Dead")).toMatchObject({ status: "paused", failures: 5 });
    expect(JSON.parse(readFileSync(join(dir, "sources.json"), "utf8")).every((source: ScoutSource) => (source.status as string) !== "reserve")).toBe(true);
  });

  it("unions defaults added later into the managed population without disturbing it", () => {
    writeSources([
      { id: "rss:waxy.org/feed", kind: "rss", name: "Waxy.org", target: "https://waxy.org/feed/", status: "active", shown: 9, likes: 4, dislikes: 0, failures: 0, addedBy: "george", addedAt: "2026-09-01T00:00:00Z" },
    ], dir);
    const sources = readSources(dir, at("2026-10-18T08:00:00Z"));
    expect(sources[0]).toMatchObject({ name: "Waxy.org", shown: 9, likes: 4, addedBy: "george" });
    expect(sources.some((source) => source.name === "r/Bitcoin" && source.status === "active")).toBe(true);
    expect(sources.some((source) => source.name === "FlowingData" && source.status === "active")).toBe(true);
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
    // Unrated exposure is not an explicit dislike.
    expect(fitness({ likes: 0, dislikes: 0, shown: 12 })).toBe(0.5);
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
      if (prompt.startsWith("Plan ")) return '{"topics": []}';
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

  it("reads each subreddit's own www.reddit.com RSS feed as a plain browser, with no API or key", async () => {
    onlySources([{ kind: "reddit", name: "r/generative", target: "generative" }]);
    const asked: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(input), headers: init?.headers as Record<string, string> });
      return new Response(rss([{ title: "Flow field from a modem log", link: "https://www.reddit.com/r/generative/comments/abc" }]), { status: 200 });
    }) as typeof fetch;
    await watchScout({ complete: vi.fn(async () => '{"picks": []}'), fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-09-27T07:00:00Z") });
    expect(asked.map((request) => request.url)).toEqual(["https://www.reddit.com/r/generative/.rss"]);
    const agent = asked[0]!.headers["User-Agent"]!;
    expect(agent).toMatch(/^Mozilla\/5\.0 \(Macintosh;/);
    expect(agent).not.toMatch(/bot|flyd|curl|node/i);
    expect(Object.keys(asked[0]!.headers).some((name) => /authorization/i.test(name))).toBe(false);
    expect(readSources(dir)[0]).toMatchObject({ status: "active", failures: 0, lastFetchedAt: "2026-09-27T07:00:00.000Z" });
  });

  it("never pauses a subreddit for fetch failures, whether Reddit refuses every one or only it", async () => {
    onlySources([
      { kind: "reddit", name: "r/one", target: "one" },
      { kind: "reddit", name: "r/two", target: "two" },
      { kind: "reddit", name: "r/three", target: "three" },
    ]);
    // What a refused machine gets back for every subreddit: a 404 "Not Found" Atom feed.
    const notFound = '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>https://rss.reddit.com/</id><title>Not Found</title></feed>';
    const refused = (async () => new Response(notFound, { status: 404 })) as typeof fetch;
    const complete = vi.fn(async () => '{"picks": []}');
    for (let hour = 4; hour <= 22; hour += 3) {
      await watchScout({ complete, fetchFn: refused, dir, redditSpacingMs: 0, now: () => at(`2026-09-27T${String(hour).padStart(2, "0")}:00:00Z`) });
    }
    expect(readSources(dir).slice(0, 2).map((source) => [source.status, source.failures])).toEqual([["active", 7], ["active", 7]]);
    // r/one answers while r/two is still refused: r/two stays active all the same.
    const partial = (async (input: string | URL | Request) => String(input).includes("/r/two/")
      ? new Response(notFound, { status: 404 })
      : new Response(rss([{ title: `Post from ${String(input)}`, link: `${String(input)}post` }]), { status: 200 })) as typeof fetch;
    await watchScout({ complete, fetchFn: partial, dir, redditSpacingMs: 0, now: () => at("2026-09-28T07:00:00Z") });
    const [one, two] = readSources(dir);
    expect(one).toMatchObject({ status: "active", failures: 0 });
    expect(two).toMatchObject({ status: "active", failures: 8 });
  });

  it("lets every source reach the ranker even when early feeds alone would fill the candidate cap", async () => {
    const feeds = Array.from({ length: 18 }, (_, index) => ({ kind: "rss" as const, name: `Feed ${index}`, target: `https://feed${index}.test/rss` }));
    onlySources([...feeds, { kind: "reddit", name: "r/ordinals", target: "ordinals" }]);
    const fetchFn = fakeFetch({
      ...Object.fromEntries(feeds.map((_, index) => [`feed${index}.test`, rss(Array.from({ length: 12 }, (_, item) => ({ title: `Feed ${index} story ${item}`, link: `https://feed${index}.test/${item}` })))])),
      "reddit.com/r/ordinals": rss([{ title: "A new recursive inscription technique", link: "https://reddit.com/r/ordinals/xyz" }]),
    });
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Plan ")) return '{"topics": []}';
      prompts.push(prompt);
      return '{"picks": []}';
    });
    await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-09-27T07:00:00Z") });
    const candidates = prompts[0]!.split("\n").filter((line) => /^\[\d+\]/.test(line));
    expect(candidates).toHaveLength(EDITION_CANDIDATES);
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

  it("does not charge or pause healthy feeds for runs where the network itself was down", async () => {
    // A Mac waking without network: every source fails at once. That says nothing about any one feed.
    onlySources([
      { kind: "rss", name: "Niche one", target: "https://one.test/feed" },
      { kind: "rss", name: "Niche two", target: "https://two.test/feed" },
      { kind: "rss", name: "Niche three", target: "https://three.test/feed", failures: 4, note: "retrying after pause 2026-09-20" },
    ]);
    const offline = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const complete = vi.fn(async () => '{"picks": []}');
    for (let hour = 7; hour <= 19; hour += 3) {
      await watchScout({ complete, fetchFn: offline, dir, redditSpacingMs: 0, now: () => at(`2026-09-27T${String(hour).padStart(2, "0")}:00:00Z`) });
    }
    const [one, two, three] = readSources(dir);
    expect([one, two].map((source) => [source?.status, source?.failures])).toEqual([["active", 0], ["active", 0]]);
    expect(three).toMatchObject({ status: "active", failures: 4 });
    // A feed that fails while the others answer is still charged.
    const partial = fakeFetch({ "one.test": rss([{ title: "Plotter drawing from a modem log", link: "https://one.test/a" }]), "two.test": rss([{ title: "A forgotten demoparty archive", link: "https://two.test/b" }]) });
    await watchScout({ complete, fetchFn: partial, dir, redditSpacingMs: 0, now: () => at("2026-09-27T22:00:00Z") });
    expect(readSources(dir)[2]).toMatchObject({ status: "paused", failures: 5 });
  });

  it("reads the newest entries of a feed larger than the reader's size cap instead of failing it", async () => {
    const long = "x".repeat(120_000);
    const entries = Array.from({ length: 24 }, (_, index) => `<entry><title>Restoring a terminal, part ${index}</title><link href="https://vcr.test/${index}"/><published>2026-09-26T10:00:00Z</published><content>${long}</content></entry>`);
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Old terminals</title>${entries.join("")}</feed>`;
    expect(Buffer.byteLength(atom)).toBeGreaterThan(2 * 1024 * 1024);
    onlySources([{ kind: "rss", name: "Old terminals", target: "https://vcr.test/feed" }]);
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => { prompts.push(prompt); return '{"picks": []}'; });
    await watchScout({ complete, fetchFn: fakeFetch({ "vcr.test": atom }), dir, redditSpacingMs: 0, now: () => at("2026-09-27T09:00:00Z") });
    expect(readSources(dir)[0]).toMatchObject({ status: "active", failures: 0 });
    expect(prompts[0]).toContain("Restoring a terminal, part 0");
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
    const musts = await watchScout({ complete, fetchFn, notify, verifyMustKnow: async (picks) => picks, dir, redditSpacingMs: 0, now: () => now });
    expect(musts.map((item) => item.title)).toEqual(["Ollie raises $7.5M for AI parenting assistant"]);
    expect(notify).toHaveBeenCalledWith("Flyd", "Ollie raises $7.5M for AI parenting assistant — A direct Koko competitor just raised.");
    expect(recentFlashes(dir, now)).toHaveLength(1);
    // Already examined: the next watch does not even call the model.
    expect(await watchScout({ complete, fetchFn, notify, verifyMustKnow: async (picks) => picks, dir, redditSpacingMs: 0, now: () => now })).toEqual([]);
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
    await runScout({ complete: vi.fn(async (prompt: string) => prompt.startsWith("Plan ") ? planning : '{"picks": []}'), fetchFn, dir, record: empty, now: () => at("2026-09-26T07:00:00Z") });
    expect(empty).not.toHaveBeenCalled();
    const record = vi.fn();
    await runScout({ complete: vi.fn(async (prompt: string) => prompt.startsWith("Plan ") ? planning : '{"picks": [{"index": 0, "kind": "relevant", "why": "worth his time"}]}'), fetchFn, dir, record, force: true, now: () => at("2026-09-27T07:00:00Z") });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-09-27" }));
  });
});

describe("evolution", () => {
  it("never switches outlets on or off: every feed stays active through evolution", async () => {
    const general = ["Fast Company", "TechCrunch", "The Verge"];
    writeSources(seedSources(at("2026-09-01T00:00:00Z")).filter((source) => general.includes(source.name)), dir);
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => { prompts.push(prompt); return prompt.startsWith("Plan") ? '{"topics": []}' : '{"add": []}'; });
    const changes = await evolveScout({ complete, dir, now: () => at("2026-11-23T07:00:00Z") });
    expect(changes.filter((change) => change.kind === "revived")).toEqual([]);
    expect(readSources(dir).filter((source) => general.includes(source.name)).map((source) => source.status)).toEqual(["active", "active", "active"]);
    expect(prompts.join("\n")).not.toMatch(/reserve/i);
  });

  it("pauses sources that keep missing, breeds new sources, revises taste, and tells George", async () => {
    writeSources([
      { id: "rss:dull.test/feed", kind: "rss", name: "Dull", target: "https://dull.test/feed", status: "active", shown: 10, likes: 0, dislikes: 2, failures: 0, addedBy: "seed", addedAt: "2026-09-01T00:00:00Z" },
      { id: "reddit:generative", kind: "reddit", name: "r/generative", target: "generative", status: "active", shown: 4, likes: 3, dislikes: 0, failures: 0, addedBy: "seed", addedAt: "2026-09-01T00:00:00Z" },
      { id: "rss:www.creativeapplications.net/feed", kind: "rss", name: "Creative Applications", target: "https://www.creativeapplications.net/feed/", status: "reserve" as ScoutSource["status"], shown: 0, likes: 0, dislikes: 0, failures: 0, addedBy: "seed", addedAt: "2026-09-01T00:00:00Z" },
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
    expect(changes.map((change) => change.kind)).toEqual(["paused", "added", "taste"]);
    const sources = readSources(dir);
    expect(sources.find((source) => source.name === "Dull")?.status).toBe("paused");
    expect(sources.find((source) => source.name === "Creative Applications")?.status).toBe("active");
    expect(sources.find((source) => source.target === "algorithmicmusic")).toMatchObject({ addedBy: "evolution", status: "active" });
    expect(sources.some((source) => source.target === "http://insecure.test/feed")).toBe(false);
    expect(readTaste(dir)).toContain("generative audio");
    expect(readFileSync(join(dir, "taste-history.jsonl"), "utf8")).toContain("crypto art");
    expect(takeEvolutionNotes(dir)).toEqual([
      "paused: Dull: you passed on most of the 10 stories it brought",
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
    expect(readScoutRun(dir)).toEqual({ at: morning.toISOString(), ok: true });
  });

  it("records a news writer that fails, as the kind of trouble and never the provider's own words", async () => {
    onlySources([{ kind: "rss", name: "Waxy.org", target: "https://waxy.org/feed/" }]);
    const fetchFn = fakeFetch({ "waxy.org": rss([{ title: "Story", link: "https://waxy.org/s" }]) });
    const complete = vi.fn(async () => { throw Object.assign(new Error("402 Insufficient balance. Top up at https://opencode.ai/console/wrk_secret/billing"), { status: 402 }); });
    const morning = new Date(2026, 8, 27, 7, 30);
    await expect(scoutTick({ complete, fetchFn, dir, now: () => morning })).rejects.toThrow(/402/);
    expect(readScoutRun(dir)).toEqual({ at: morning.toISOString(), ok: false, trouble: "out_of_credit" });
    expect(readFileSync(join(dir, "run-state.json"), "utf8")).not.toContain("opencode");
    expect(providerTrouble("429 rate limit")).toBe("usage_limit");
    expect(providerTrouble("models backed off until 2026-11-11T10:00:00Z")).toBe("usage_limit");
    expect(providerTrouble("401 Unauthorized")).toBe("refused");
    expect(providerTrouble("fetch failed")).toBe("unreachable");
    expect(providerTrouble("Unexpected token in JSON")).toBe("failed");
  });

  it("never pauses a source George has only been shown, not marked down", async () => {
    writeSources([
      { id: "rss:simonwillison.net/atom/everything", kind: "rss", name: "Simon Willison", target: "https://simonwillison.net/atom/everything/", status: "active", shown: 40, likes: 0, dislikes: 0, failures: 0, addedBy: "seed", addedAt: "2026-09-01T00:00:00Z" },
    ], dir);
    const complete = vi.fn(async () => JSON.stringify({ add: [], taste: SEED_TASTE, taste_change: "" }));
    await evolveScout({ complete, dir, now: () => at("2026-09-27T07:00:00Z") });
    expect(readSources(dir).find((source) => source.name === "Simon Willison")?.status).toBe("active");
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

  it("evolves with no feedback: replans topics from taste, and stored reserve feeds are simply active", async () => {
    const base = { shown: 0, likes: 0, dislikes: 0, failures: 0, addedBy: "seed" as const, addedAt: "2026-09-01T00:00:00Z" };
    writeSources([
      { ...base, id: "reddit:a", kind: "reddit", name: "r/a", target: "a", status: "paused", note: "paused by evolution 2026-09-01" },
      { ...base, id: "reddit:b", kind: "reddit", name: "r/b", target: "b", status: "paused", note: "paused by evolution 2026-09-01" },
      { ...base, id: "rss:one.test/feed", kind: "rss", name: "One", target: "https://one.test/feed", status: "reserve" as ScoutSource["status"] },
      { ...base, id: "rss:two.test/feed", kind: "rss", name: "Two", target: "https://two.test/feed", status: "reserve" as ScoutSource["status"] },
      { ...base, id: "rss:three.test/feed", kind: "rss", name: "Three", target: "https://three.test/feed", status: "reserve" as ScoutSource["status"] },
      { ...base, id: "topic:hybrid search query rewriting", kind: "topic", name: "hybrid search query rewriting", target: "hybrid search query rewriting", status: "active", addedBy: "evolution" },
      { ...base, id: "topic:ordinals recursion", kind: "topic", name: "ordinals recursion", target: "ordinals recursion", status: "active", addedBy: "george" },
    ], dir);
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return prompt.startsWith("Plan ") ? JSON.stringify({ topics: [
        { topic: "touchdesigner audio reactive", why: "creative coding" },
        { topic: "ordinals recursion", why: "duplicate of a kept one" },
        { topic: "esp32 cyberdeck builds", why: "hardware hacking" },
      ] }) : "{}";
    });
    const changes = await evolveScout({ complete, dir, now: () => at("2026-10-24T07:00:00Z") });
    const sources = readSources(dir);
    expect(sources.filter((source) => source.status === "active" && source.target.includes(".test/")).map((source) => source.name)).toEqual(["One", "Two", "Three"]);
    expect(prompts[0]).toContain("crypto art, generative art");
    expect(prompts[0]).toContain("Already searching (do not repeat): ordinals recursion");
    const topics = sources.filter((source) => source.kind === "topic" && source.status === "active").map((source) => source.target);
    expect(topics).toEqual(["ordinals recursion", "touchdesigner audio reactive", "esp32 cyberdeck builds"]);
    expect(sources.find((source) => source.target === "hybrid search query rewriting")?.status).toBe("paused");
    expect(changes.map((change) => change.kind)).toEqual(["topics"]);
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
      if (prompt.startsWith("Plan ")) return '{"topics": []}';
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
      if (prompt.startsWith("Plan ")) return '{"topics": []}';
      expect(prompt).toContain("at most 3 picks from any one source");
      const picks = [...Array.from({ length: 6 }, (_, n) => `Hack ${n}`), "Waxy link"].map((title) => ({ index: indexOf(prompt, title), kind: "relevant", why: "good" }));
      return JSON.stringify({ picks });
    });
    const result = await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-09-27T06:00:00Z") });
    expect(result.edition?.items.filter((item) => item.source === "Hackaday")).toHaveLength(3);
    expect(result.edition?.items.some((item) => item.source === "Waxy.org")).toBe(true);
  });

  const recent = "Thu, 12 Nov 2026 10:00:00 GMT";
  const rankerFor = (prompts: string[], pick: (prompt: string) => Array<{ index: number; kind: string; why: string }> = () => []) => vi.fn(async (prompt: string) => {
    if (prompt.startsWith("Plan ")) return '{"topics": []}';
    prompts.push(prompt);
    return JSON.stringify({ picks: pick(prompt) });
  });

  it("reads feeds back three days only, and dates each candidate by its day", async () => {
    onlySources([{ kind: "rss", name: "Import AI", target: "https://importai.test/feed" }]);
    const fetchFn = fakeFetch({ "importai.test": rss([
      { title: "This week in models", link: "https://importai.test/1", date: recent },
      { title: "Three weeks back", link: "https://importai.test/2", date: "Fri, 23 Oct 2026 10:00:00 GMT" },
      { title: "Last season", link: "https://importai.test/3", date: "Mon, 05 Oct 2026 10:00:00 GMT" },
    ]) });
    const prompts: string[] = [];
    await runScout({ complete: rankerFor(prompts), fetchFn, dir, now: () => at("2026-11-14T07:00:00Z") });
    expect(prompts[0]).toContain("This week in models");
    expect(prompts[0]).not.toContain("Three weeks back");
    expect(prompts[0]).not.toContain("Last season");
  });

  it("gives a feed that fails in the first burst one more try before counting it as failing", async () => {
    onlySources([{ kind: "rss", name: "Hackaday", target: "https://hackaday.test/feed" }]);
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response(rss([{ title: "A clamp meter runs DOOM", link: "https://hackaday.test/doom", date: recent }]), { status: 200 });
    }) as typeof fetch;
    const prompts: string[] = [];
    const result = await runScout({ complete: rankerFor(prompts), fetchFn, dir, now: () => at("2026-11-14T07:00:00Z") });
    expect(result.failedTopics).toEqual([]);
    expect(prompts[0]).toContain("A clamp meter runs DOOM");
    expect(readSources(dir)[0]).toMatchObject({ name: "Hackaday", failures: 0 });
  });

  it("never repeats a headline from an earlier briefing, even under a new link", async () => {
    onlySources([
      { kind: "rss", name: "Waxy.org", target: "https://waxy.test/feed" },
      { kind: "rss", name: "Kottke", target: "https://kottke.test/feed" },
    ]);
    // An edition from before headlines were logged.
    mkdirSync(join(dir, "editions"), { recursive: true });
    writeFileSync(join(dir, "editions", "2026-11-01.json"), JSON.stringify({ date: "2026-11-01", generatedAt: "2026-11-01T06:00:00Z", topics: [], items: [
      { n: 1, title: "A 1990s demo, rebuilt", url: "https://old.test/demo", source: "Waxy.org", topic: "Internet", why: "", kind: "relevant" },
    ] }));
    const first = fakeFetch({
      "waxy.test": rss([{ title: "The GeoCities art archive", link: "https://waxy.test/geo", date: recent }, { title: "Plotters, again", link: "https://waxy.test/plot", date: recent }]),
      "kottke.test": rss([{ title: "A 1990s Demo — Rebuilt!", link: "https://kottke.test/demo", date: recent }, { title: "plotters again", link: "https://kottke.test/plot", date: recent }]),
    });
    const prompts: string[] = [];
    const complete = rankerFor(prompts, (prompt) => {
      const geo = indexOf(prompt, "GeoCities");
      return Number.isFinite(geo) ? [{ index: geo, kind: "rabbit_hole", why: "Internet archaeology." }] : [];
    });
    await runScout({ complete, fetchFn: first, dir, now: () => at("2026-11-13T07:00:00Z") });
    expect(prompts[0]).not.toContain("1990s Demo");
    expect(prompts[0]!.split("\n").filter((line) => /plotters,? again/i.test(line))).toHaveLength(1);

    // The next day the same story is back under another link.
    const second = fakeFetch({ "waxy.test": rss([{ title: "The GeoCities Art Archive.", link: "https://waxy.test/geo?ref=rss", date: recent }, { title: "Plotters, again", link: "https://waxy.test/plot", date: recent }]) });
    await runScout({ complete, fetchFn: second, dir, force: true, now: () => at("2026-11-14T07:00:00Z") });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain("GeoCities");
  });

  it("runs a full set of last30days searches each edition, topping up from topics a replan rested", async () => {
    const topic = (target: string, extra: Partial<ScoutSource> = {}) => ({ kind: "topic" as const, name: target, target, addedBy: "evolution" as const, ...extra });
    onlySources([
      topic("p5.js generative sketches"),
      topic("on-chain audio ordinals"),
      topic("demoscene 64k intros", { status: "paused", note: "replanned 2026-11-10", pausedAt: "2026-11-10T00:00:00Z" }),
      topic("pen plotter generative art", { status: "paused", note: "replanned 2026-11-12", pausedAt: "2026-11-12T00:00:00Z" }),
      topic("tweet engagement prediction", { status: "paused", note: "paused 25 Oct: implementation phrase, not a news topic", pausedAt: "2026-10-25T00:00:00Z" }),
      topic("bitcoin stamps protocol", { status: "paused", note: "replanned 2026-11-11", pausedAt: "2026-11-11T00:00:00Z", dislikes: 1 }),
    ]);
    expect(editionTopics(readSources(dir)).map((source) => source.target)).toEqual([
      "p5.js generative sketches", "on-chain audio ordinals", "pen plotter generative art",
    ]);
    const many = Array.from({ length: 12 }, (_, index) => ({ ...topic(`topic ${index}`), id: `topic:topic ${index}`, status: "active" as const, shown: 0, likes: 0, dislikes: 0, failures: 0, addedAt: "2026-11-01T00:00:00Z" }));
    expect(editionTopics(many)).toHaveLength(TOPICS_PER_EDITION);

    const searched: string[] = [];
    const fetchTopicFn = vi.fn(async (target: string) => {
      searched.push(target);
      return [{ id: `https://hn.test/${searched.length}`, url: `https://hn.test/${searched.length}`, title: `Found for ${target}`, source: "Hacker News", sourceId: "", summary: "", topic: target }];
    });
    const prompts: string[] = [];
    await runScout({ complete: rankerFor(prompts), fetchFn: fakeFetch({}), fetchTopicFn, dir, now: () => at("2026-11-14T07:00:00Z") });
    expect([...searched].sort()).toEqual(["on-chain audio ordinals", "p5.js generative sketches", "pen plotter generative art"]);
    expect(prompts[0]).toContain("Found for pen plotter generative art");
  });

  it("judges the seats like stories: seats only the finds the curator picked, between the stories, never an extra article", async () => {
    const feeds = ["hackaday", "waxy", "cdm"];
    onlySources(feeds.map((name) => ({ kind: "rss" as const, name, target: `https://${name}.test/feed` })));
    const fetchFn = fakeFetch(Object.fromEntries(feeds.map((name) => [`${name}.test`, rss(Array.from({ length: 3 }, (_, n) => ({ title: `${name} story ${n}`, link: `https://${name}.test/${n}`, date: recent })))])));
    const inspiration: InspirationItem[] = [
      { url: "https://en.wikipedia.org/wiki/Plotter", title: "Plotters sold", source: "Wikipedia", sourceId: "wiki:stat", summary: "12% of plotters", media: "stat", figure: "12%" },
      { url: "https://commons.wikimedia.org/wiki/File:Loop.gif", title: "Loop", source: "Wikimedia Commons", sourceId: "commons:gif", summary: "Loop", media: "gif", mediaUrl: "https://upload.wikimedia.org/loop.gif" },
      { url: "https://giphy.test/pen", title: "Pen plotter drawing", source: "Giphy", sourceId: "giphy", summary: "A pen plotter drawing a city in one continuous line.", media: "gif", mediaUrl: "https://giphy.test/pen.gif" },
      { url: "https://news.example/celebrity", title: "A celebrity re-signs", source: "Google Trends", sourceId: "trends", summary: "Trending", media: "article" },
    ];
    const prompts: string[] = [];
    const complete = rankerFor(prompts, (prompt) => [
      ...feeds.flatMap((name) => [0, 1, 2].map((n) => ({ index: indexOf(prompt, `${name} story ${n}`), kind: "relevant", why: "worth it" }))),
      { index: indexOf(prompt, "Plotters sold"), kind: "relevant", why: "A number that frames his plotter work." },
      { index: indexOf(prompt, "Pen plotter drawing"), kind: "relevant", why: "One continuous line, like his own drawings." },
    ]);
    const result = await runScout({ complete, fetchFn, dir, now: () => at("2026-11-14T07:00:00Z"), focus: [], inspiration });
    // One call judges stories and seats alike; each find is offered marked as a seat.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.split("\n").find((line) => line.includes("Plotters sold"))).toMatch(/^\[\d+\] \(SEAT STAT · Wikipedia/);
    expect(prompts[0]!.split("\n").find((line) => line.includes("Loop"))).toContain("SEAT GIF");
    expect(prompts[0]).not.toContain("A celebrity re-signs");
    const items = result.edition!.items;
    expect(items.filter((item) => item.media === undefined)).toHaveLength(9);
    expect(items.map((item) => item.media ?? "story")).toEqual(["story", "story", "story", "stat", "story", "story", "story", "gif", "story", "story", "story"]);
    expect(items.filter((item) => item.media === "gif").map((item) => item.title)).toEqual(["Pen plotter drawing"]);
    expect(items.find((item) => item.media === "stat")?.why).toBe("A number that frames his plotter work.");
    expect(items.map((item) => item.n)).toEqual(items.map((_, index) => index + 1));
    expect(items.some((item) => item.source === "Google Trends")).toBe(false);
  });

  it("keeps the story rabbit hole when the curator also tags a seat as one", async () => {
    onlySources([{ kind: "rss", name: "hackaday", target: "https://hackaday.test/feed" }]);
    const fetchFn = fakeFetch({ "hackaday.test": rss([
      { title: "A plotter that draws with sand", link: "https://hackaday.test/sand", date: recent },
      { title: "The lost BBS of a lighthouse keeper", link: "https://hackaday.test/bbs", date: recent },
    ]) });
    const inspiration: InspirationItem[] = [
      { url: "https://news.ycombinator.test/item?id=1", title: "Thread on 64k demos", source: "Hacker News", sourceId: "hn", summary: "A long thread", media: "thread" },
    ];
    const prompts: string[] = [];
    const complete = rankerFor(prompts, (prompt) => [
      { index: indexOf(prompt, "Thread on 64k demos"), kind: "rabbit_hole", why: "A deep thread on tiny demos." },
      { index: indexOf(prompt, "draws with sand"), kind: "relevant", why: "Sand as a plotter medium." },
      { index: indexOf(prompt, "lighthouse keeper"), kind: "rabbit_hole", why: "A BBS run from a lighthouse." },
    ]);
    const result = await runScout({ complete, fetchFn, dir, now: () => at("2026-11-14T07:00:00Z"), focus: [], inspiration, workNow: null });
    const items = result.edition!.items;
    expect(items.find((item) => item.title === "The lost BBS of a lighthouse keeper")?.kind).toBe("rabbit_hole");
    expect(items.find((item) => item.title === "Thread on 64k demos")).toMatchObject({ kind: "relevant", media: "thread" });
  });

  it("drops every seat the curator passes on, with no filler, and gives it the work-now brief", async () => {
    onlySources([{ kind: "rss", name: "hackaday", target: "https://hackaday.test/feed" }]);
    const fetchFn = fakeFetch({ "hackaday.test": rss([{ title: "A plotter that draws with sand", link: "https://hackaday.test/sand", date: recent }]) });
    const inspiration: InspirationItem[] = [
      { url: "https://en.wikiquote.org/wiki/Someone", title: "Someone on work", source: "Wikiquote", sourceId: "wikiquote", summary: "A quote", media: "quote", quote: "Work hard, dream big.", attribution: "Someone" },
      { url: "https://giphy.test/cat", title: "Cat falls off sofa", source: "Giphy", sourceId: "giphy", summary: "A cat", media: "gif", mediaUrl: "https://giphy.test/cat.gif" },
      { url: "https://pexels.test/office", title: "Stock office", source: "Pexels", sourceId: "pexels", summary: "People at desks", media: "image", mediaUrl: "https://pexels.test/office.jpg" },
    ];
    const prompts: string[] = [];
    const complete = rankerFor(prompts, (prompt) => [{ index: indexOf(prompt, "draws with sand"), kind: "relevant", why: "Sand as a plotter medium." }]);
    const workNow = "Projects: SYNTHETIC_PROJECT (plotter toolpaths)\nCoding sessions: SYNTHETIC_SESSION_TITLE";
    const result = await runScout({ complete, fetchFn, dir, now: () => at("2026-11-14T07:00:00Z"), focus: [], inspiration, workNow });
    expect(prompts[0]).toContain("What he is working on right now");
    expect(prompts[0]).toContain("SYNTHETIC_SESSION_TITLE");
    expect(prompts[0]).toMatch(/SEAT QUOTE · Wikiquote[^\n]*"Work hard, dream big\." \(Someone\)/);
    expect(prompts[0]).toContain("Judge each exactly as you judge a story");
    expect(result.edition!.items.map((item) => item.title)).toEqual(["A plotter that draws with sand"]);
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

describe("what reaches an edition", () => {
  const recent = "Thu, 12 Nov 2026 10:00:00 GMT";

  it("rejects ranker picks that argue against themselves or repeat the headline", () => {
    const candidates: ScoutCandidate[] = [
      { id: "a", title: "A clamp meter runs DOOM", url: "https://a.test/1", source: "Feed", sourceId: "rss:a", summary: "", topic: "Tech" },
      { id: "b", title: "Whats next for Nvidia", url: "https://a.test/2", source: "Feed", sourceId: "rss:a", summary: "", topic: "Tech" },
      { id: "c", title: "The GeoCities art archive", url: "https://a.test/3", source: "Feed", sourceId: "rss:a", summary: "", topic: "Tech" },
    ];
    const stats = { picks: 0, junk: 0 };
    const picks = parsePicks(JSON.stringify({ picks: [
      { index: 0, kind: "relevant", why: "A whole computer in a multimeter." },
      { index: 1, kind: "relevant", why: "Pass — not worth his time." },
      { index: 2, kind: "relevant", why: "The GeoCities art archive" },
    ] }), candidates, 30, 3, stats);
    expect(picks.map((item) => item.title)).toEqual(["A clamp meter runs DOOM"]);
    expect(stats).toEqual({ picks: 3, junk: 2 });
  });

  it("keeps a ranker pick whose reason merely begins with a refusal-like word", () => {
    const candidates: ScoutCandidate[] = [
      { id: "a", title: "GPU prices fall", url: "https://a.test/1", source: "Feed", sourceId: "rss:a", summary: "", topic: "Tech" },
      { id: "b", title: "A new bill", url: "https://a.test/2", source: "Feed", sourceId: "rss:a", summary: "", topic: "Tech" },
    ];
    const stats = { picks: 0, junk: 0 };
    const picks = parsePicks(JSON.stringify({ picks: [
      { index: 0, kind: "relevant", why: "Drop in GPU prices changes what a home lab costs." },
      { index: 1, kind: "relevant", why: "Pass the bill and compute credits become taxable." },
    ] }), candidates, 30, 3, stats);
    expect(picks).toHaveLength(2);
    expect(stats).toEqual({ picks: 2, junk: 0 });
  });

  it("curates against obvious headlines story by story: his preferences reach the ranker, and no outlet is marked or ranked down", async () => {
    const indexOf = (prompt: string, title: string) => Number(prompt.split("\n").find((line) => line.includes(title))?.match(/^\[(\d+)\]/)?.[1]);
    onlySources([
      { kind: "rss", name: "Ars Technica", target: "https://feeds.arstechnica.com/arstechnica/index", category: "Technology" },
      { kind: "rss", name: "Old VCR", target: "https://oldvcr.blogspot.com/feeds/posts/default", category: "Internet Archaeology" },
    ]);
    writeFileSync(process.env.FLYD_USER_PROFILE!, "# George\n\n## Preferences\n- SYNTHETIC_PREF: wants weird demoscene and plotter finds, hates generic headlines\n\n## People\n- SYNTHETIC_PERSON\n");
    const fetchFn = fakeFetch({
      "arstechnica.com": rss([{ title: "Big phone maker unveils new flagship phone", link: "https://arstechnica.com/gadgets/flagship", date: recent }]),
      "oldvcr.blogspot.com": rss([{ title: "Reverse engineering a forgotten 1980s BBS terminal", link: "https://oldvcr.blogspot.com/bbs", date: recent }]),
    });
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Plan ")) return '{"topics": []}';
      prompts.push(prompt);
      return JSON.stringify({ picks: [{ index: indexOf(prompt, "forgotten 1980s BBS"), kind: "rabbit_hole", why: "A lost terminal brought back from the dead." }] });
    });
    try {
      await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-11-14T07:00:00Z") });
      const prompt = prompts[0]!;
      expect(prompt).toContain("SYNTHETIC_PREF");
      expect(prompt).not.toContain("SYNTHETIC_PERSON");
      expect(prompt).not.toContain("GENERAL OUTLET");
      expect(prompt).toContain("whatever outlet carried it");
      expect(prompt.split("\n").find((line) => line.includes("flagship phone"))).toMatch(/^\[\d+\] \(Ars Technica · /);
    } finally {
      rmSync(process.env.FLYD_USER_PROFILE!, { force: true });
    }
  });

  it("keeps a 30-story edition when enough stories clear the bar", async () => {
    const feeds = Array.from({ length: 12 }, (_, index) => ({ kind: "rss" as const, name: `Feed ${index}`, target: `https://feed${index}.test/rss` }));
    onlySources(feeds);
    const fetchFn = fakeFetch(Object.fromEntries(feeds.map((_, index) => [`feed${index}.test`, rss(Array.from({ length: 5 }, (_, n) => ({ title: `Dispatch ${index} number ${n}`, link: `https://feed${index}.test/${n}`, date: recent })))])));
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Plan ")) return '{"topics": []}';
      prompts.push(prompt);
      return JSON.stringify({ picks: [...prompt.matchAll(/^\[(\d+)\]/gm)].map((match) => ({ index: Number(match[1]), kind: "relevant", why: "Worth reading over coffee." })) });
    });
    const result = await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-11-14T07:00:00Z") });
    expect(BRIEF_MAX).toBe(30);
    expect(result.edition?.items).toHaveLength(BRIEF_MAX);
    expect(prompts[0]).toContain("Curate 24–30 STORIES");
  });

  it("preserves verified version updates even when the link is unchanged", async () => {
    const feed = { kind: "rss" as const, name: "Acme", target: "https://acme.test/feed" };
    onlySources([feed]);
    const previous: Edition = {
      date: "2026-11-18",
      generatedAt: "2026-11-18T07:00:00.000Z",
      topics: ["Software"],
      items: [{ n: 1, title: "The Acme visual engine v2 launches", url: "https://acme.test/releases", source: "Acme", sourceId: "rss:acme.test/feed", topic: "Software", why: "The earlier release.", kind: "relevant" }],
    };
    mkdirSync(join(dir, "editions"), { recursive: true });
    writeFileSync(join(dir, "editions", "2026-11-18.json"), JSON.stringify(previous));
    writeFileSync(join(dir, "edition-latest.json"), JSON.stringify(previous));
    writeFileSync(join(dir, "seen.jsonl"), JSON.stringify({ title: previous.items[0]!.title, url: previous.items[0]!.url }) + "\n");
    const candidate: ScoutCandidate = {
      id: "acme-v3",
      title: "The Acme visual engine v3 launches",
      url: "https://acme.test/releases",
      source: "Acme",
      sourceId: "rss:acme.test/feed",
      summary: "Release v3",
      topic: "Software",
      evidenceStatus: "corroborated",
      evidenceUrls: ["https://evidence.test/acme-v3"],
    };
    poolCandidates([candidate], dir, at("2026-11-19T06:00:00Z"));
    const complete = vi.fn(async (prompt: string) => prompt.startsWith("Plan ")
      ? '{"topics": []}'
      : JSON.stringify({ picks: [{ index: 0, kind: "relevant", why: "A verified new major release." }] }));
    const result = await runScout({ complete, fetchFn: fakeFetch({ "acme.test": rss([]) }), dir, now: () => at("2026-11-19T07:00:00Z") });
    expect(result.edition?.items).toMatchObject([{ title: candidate.title, updatedFrom: previous.items[0]!.title }]);
  });

  it("records source outcomes for the activity news status", async () => {
    onlySources([
      { kind: "reddit", name: "r/one", target: "one" },
      { kind: "reddit", name: "r/two", target: "two" },
      { kind: "rss", name: "Hackaday", target: "https://hackaday.test/feed" },
    ]);
    const fetchFn = (async (input: string | URL | Request) => String(input).includes("reddit.com")
      ? new Response("slow down", { status: 429 })
      : new Response(rss([{ title: "A clamp meter runs DOOM", link: "https://hackaday.test/doom", date: recent }]), { status: 200 })) as typeof fetch;
    await runScout({ complete: vi.fn(async (prompt: string) => prompt.startsWith("Plan ") ? '{"topics": []}' : '{"picks": []}'), fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-11-14T07:00:00Z") });
    expect(readSourceHealth(dir)).toMatchObject({ attempted: 3, answered: 1, rateLimited: 2, failed: 0, ingested: 1, active: 3 });
    const downFetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    await watchScout({ complete: vi.fn(async () => '{"picks": []}'), fetchFn: downFetch, dir, redditSpacingMs: 0, now: () => at("2026-11-14T09:00:00Z") });
    expect(readSourceHealth(dir)).toMatchObject({ attempted: 3, answered: 1, rateLimited: 2, failed: 0, ingested: 1, active: 3 });
    const watch = readSourceHealth(dir, "watch");
    expect(watch?.answered).toBe(0);
    expect(watch?.failed).toBeGreaterThan(0);
  });
});

describe("sourceLabel", () => {
  it("names where a searched story came from instead of a bare channel", async () => {
    const { sourceLabel } = await import("../scout.js");
    expect(sourceLabel("github", "https://github.com/acme/rotor/issues/3")).toBe("GitHub · acme/rotor");
    expect(sourceLabel("reddit", "https://old.reddit.com/r/vjing/comments/x")).toBe("r/vjing");
    expect(sourceLabel("web", "https://www.core77.com/posts/1")).toBe("core77.com");
    expect(sourceLabel("Hackaday", "https://hackaday.com/x")).toBe("Hackaday");
  });
});

describe("freshStories", () => {
  it("puts the newest dated stories first, from the pool and the edition, and leaves out old or undated ones", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { freshStories } = await import("../scout.js");
    const dir = mkdtempSync(join(tmpdir(), "fresh-stories-"));
    const now = new Date("2026-11-26T15:00:00");
    writeFileSync(join(dir, "edition-latest.json"), JSON.stringify({ date: "2026-11-26", generatedAt: "2026-11-26T07:00:00.000Z", topics: [], items: [
      { n: 1, title: "Edition story", url: "https://a.test/1", source: "A", topic: "t", why: "", kind: "relevant", published: "2026-11-25" },
      { n: 2, title: "Undated", url: "https://a.test/2", source: "A", topic: "t", why: "", kind: "relevant" },
    ] }));
    const pooled = (title: string, url: string, published: string) => JSON.stringify({ id: url, url, title, source: "B", sourceId: "rss:b", topic: "t", summary: "", published, pooledAt: "2026-11-26T10:00:00.000Z" });
    writeFileSync(join(dir, "pool.jsonl"), [pooled("Today", "https://b.test/1", "2026-11-26"), pooled("Old", "https://b.test/2", "2026-11-10")].join("\n") + "\n");
    expect(freshStories(dir, now).map((story) => story.title)).toEqual(["Today", "Edition story"]);
  });
});
