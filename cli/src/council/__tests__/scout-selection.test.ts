import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBareRelease } from "../scout-selection.js";
import { readPool, readSources, runScout, seedSources, watchScout, writeSources, type ScoutSource } from "../scout.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-scout-selection-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const at = (iso: string) => new Date(iso);
const recent = "Thu, 12 Nov 2026 10:00:00 GMT";
const rss = (items: Array<{ title: string; link: string }>) =>
  `<?xml version="1.0"?><rss><channel><title>Feed</title>${items.map((item) => `<item><title>${item.title}</title><link>${item.link}</link><pubDate>${recent}</pubDate><description>about ${item.title}</description></item>`).join("")}</channel></rss>`;

/** Only Simon Willison's feed is active; every seed is present but paused. */
function onlySimon(): void {
  const own: ScoutSource = { id: "rss:simonwillison.test/feed", kind: "rss", name: "Simon Willison", target: "https://simonwillison.test/feed", status: "active", shown: 0, likes: 0, dislikes: 0, failures: 0, addedBy: "seed", addedAt: "2026-09-01T00:00:00Z" };
  writeSources([own, ...seedSources(at("2026-09-01T00:00:00Z")).map((source) => ({ ...source, status: "paused" as const }))], dir);
}

const feed = rss([
  { title: "PostgreSQL 19 Released", link: "https://simonwillison.test/pg" },
  { title: "datasette-charts 0.3a0", link: "https://simonwillison.test/charts" },
  { title: "llm-gemini 0.38.1", link: "https://simonwillison.test/gemini" },
  { title: "Notes on running a local model for a pen plotter", link: "https://simonwillison.test/plotter" },
  { title: "p5.js 2.0 released", link: "https://simonwillison.test/p5" },
]);
const fetchFn = (async (input: string | URL | Request) => String(input).includes("simonwillison.test")
  ? new Response(feed, { status: 200 })
  : new Response("nope", { status: 404 })) as typeof fetch;

describe("bare release lines", () => {
  it("are told apart from stories that mention a version and from releases of tools George follows", () => {
    for (const title of ["PostgreSQL 19 Released", "Django 6.0 released."]) {
      expect(isBareRelease(title), title).toBe(true);
    }
    for (const title of ["sqlite3_rsync: Database Remote-Copy Tool For SQLite", "Notes on running a local model for a pen plotter", "What's new in p5.js 2.0 for generative typography", "A clamp meter runs DOOM",
      "p5.js 2.0 released", "Blender 5.0 released", "Processing 4 released", "Claude Opus 5 released", "TouchDesigner 2025.1", "llm-gemini 0.38.1"]) {
      expect(isBareRelease(title), title).toBe(false);
    }
  });

  it("never reach the edition ranker", async () => {
    onlySimon();
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.startsWith("Plan ")) return '{"topics": []}';
      prompts.push(prompt);
      return '{"picks": []}';
    });
    await runScout({ complete, fetchFn, dir, redditSpacingMs: 0, now: () => at("2026-11-14T07:00:00Z") });
    expect(prompts[0]).toContain("local model for a pen plotter");
    expect(prompts[0]).toContain("p5.js 2.0 released");
    expect(prompts[0]).not.toContain("PostgreSQL 19 Released");
  });

  it("are neither pooled nor ranked for a must-know by the watch", async () => {
    onlySimon();
    const now = at("2026-11-14T09:00:00Z");
    const prompts: string[] = [];
    const complete = vi.fn(async (prompt: string) => { prompts.push(prompt); return '{"picks": []}'; });
    await watchScout({ complete, fetchFn, notify: vi.fn(async () => {}), verifyMustKnow: async (picks) => picks, dir, redditSpacingMs: 0, now: () => now });
    const pooled = readPool(dir, now).map((candidate) => candidate.title);
    expect(pooled).toContain("p5.js 2.0 released");
    expect(pooled).not.toContain("PostgreSQL 19 Released");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("p5.js 2.0 released");
    expect(prompts[0]).not.toContain("PostgreSQL 19 Released");
  });
});

describe("niche feeds", () => {
  it("are seeded active beside the long list for media art, creative coding and odd hardware", () => {
    const sources = readSources(dir, at("2026-11-27T08:00:00Z"));
    for (const name of ["We Make Money Not Art", "Neural", "CLOT Magazine", "Processing Foundation", "Adafruit", "Evil Mad Scientist", "Right Click Save", "Hackaday", "Ars Technica"]) {
      expect(sources.find((source) => source.name === name), name).toMatchObject({ kind: "rss", status: "active" });
    }
  });
});
