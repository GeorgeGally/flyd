import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActivityReader } from "../activity.js";
import { applyStoryMedia, collectStoryMedia, collectStorySource, extractStoryMedia, imageKind, storyAsset, storyKey, storySources, toggleSavedStory } from "../story-media.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PAGE = "https://magazine.example/course";
const lookup = async () => ["8.8.8.8"];

function html(meta: string): string {
  return `<!doctype html><html><head>${meta}</head><body><p>Hello</p></body></html>`;
}

function fetcher(routes: Record<string, { body: Buffer | string; type: string; status?: number }>): typeof fetch {
  return (async (input: string) => {
    const hit = routes[input];
    if (!hit) return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
    const body = typeof hit.body === "string" ? hit.body : new Uint8Array(hit.body);
    return new Response(body, { status: hit.status ?? 200, headers: { "content-type": hit.type } });
  }) as typeof fetch;
}

describe("extractStoryMedia", () => {
  it("drops a missing, empty, or non-http og:image", () => {
    expect(extractStoryMedia(html(""), PAGE).image).toBeUndefined();
    expect(extractStoryMedia(html(`<meta property="og:image" content="">`), PAGE).image).toBeUndefined();
    expect(extractStoryMedia(html(`<meta property="og:image" content="javascript:alert(1)">`), PAGE).image).toBeUndefined();
    expect(extractStoryMedia(html(`<meta property="og:image" content="data:image/png;base64,aaaa">`), PAGE).image).toBeUndefined();
  });

  it("keeps an http og:image, a twitter image, and a relative one resolved against the page", () => {
    expect(extractStoryMedia(html(`<meta property="og:image" content="https://cdn.example/a.jpg">`), PAGE).image).toBe("https://cdn.example/a.jpg");
    expect(extractStoryMedia(html(`<meta name="twitter:image" content="https://cdn.example/t.jpg">`), PAGE).image).toBe("https://cdn.example/t.jpg");
    expect(extractStoryMedia(html(`<meta property="og:image" content="/cover.png">`), PAGE).image).toBe("https://magazine.example/cover.png");
  });

  it("keeps a date and a reading time only when the page states them", () => {
    const found = extractStoryMedia(html(`<meta property="article:published_time" content="2026-10-12T08:00:00.000Z"><meta name="reading-time" content="18 minutes">`), PAGE);
    expect(found.published).toBe("2026-10-12T08:00:00.000Z");
    expect(found.minutes).toBe(18);
    expect(extractStoryMedia(html("<title>No dates</title>"), PAGE).minutes).toBeUndefined();
  });
});

describe("imageKind", () => {
  it("accepts a bitmap and rejects html, svg, and an empty body", () => {
    expect(imageKind("image/png", PNG)).toBe("image/png");
    expect(imageKind("text/html", Buffer.from("<html>no picture</html>"))).toBeNull();
    expect(imageKind("image/jpeg", Buffer.from("<html>claimed to be a jpeg</html>"))).toBeNull();
    expect(imageKind("image/svg+xml", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageKind("image/png", Buffer.alloc(0))).toBeNull();
  });
});

describe("collectStoryMedia", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-story-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("stores nothing to show when the page has no og:image", async () => {
    const record = await collectStoryMedia(dir, PAGE, fetcher({ [PAGE]: { body: html("<title>Plain</title>"), type: "text/html" } }), lookup);
    expect(record.image).toBe("none");
    expect(storyAsset(dir, "image", storyKey(PAGE))).toBeNull();
  });

  it("stores nothing to show when og:image is empty or the response is not an image", async () => {
    const empty = await collectStoryMedia(dir, PAGE, fetcher({
      [PAGE]: { body: html(`<meta property="og:image" content="">`), type: "text/html" },
    }), lookup);
    expect(empty.image).toBe("none");

    const other = "https://magazine.example/other";
    const htmlPage = await collectStoryMedia(dir, other, fetcher({
      [other]: { body: html(`<meta property="og:image" content="https://cdn.example/not.png">`), type: "text/html" },
      "https://cdn.example/not.png": { body: "<html>not a picture</html>", type: "text/html" },
    }), lookup);
    expect(htmlPage.image).toBe("none");
    expect(storyAsset(dir, "image", storyKey(other))).toBeNull();
  });

  it("keeps a real og:image and serves it only as an image", async () => {
    const record = await collectStoryMedia(dir, PAGE, fetcher({
      [PAGE]: { body: html(`<meta property="og:image" content="https://cdn.example/a.png"><link rel="icon" href="https://cdn.example/icon.png">`), type: "text/html" },
      "https://cdn.example/a.png": { body: PNG, type: "image/png" },
      "https://cdn.example/icon.png": { body: PNG, type: "image/png" },
    }), lookup);
    expect(record.image).toBe("file");
    const asset = storyAsset(dir, "image", storyKey(PAGE));
    expect(asset?.type).toBe("image/png");
    expect(asset?.bytes.equals(PNG)).toBe(true);
    expect(storyAsset(dir, "image", "../etc/passwd")).toBeNull();
    expect(storyAsset(dir, "image", "not-a-key")).toBeNull();

    const story = { title: "A course", url: PAGE, source: "Magazine" };
    const panel = applyStoryMedia({ now: [], recent: [{ id: "news", kind: "news", title: "Today", stories: [story], at: "2026-10-17T11:00:00.000Z" }], week: [] }, dir);
    expect(panel.recent[0]?.stories?.[0]?.image).toBe(`/api/story-image?id=${storyKey(PAGE)}`);
    expect(panel.recent[0]?.stories?.[0]?.icon).toBe(`/api/story-icon?id=${storyKey(PAGE)}`);

    const index = JSON.parse(readFileSync(join(dir, "scout", "media", "index.json"), "utf8")) as Record<string, { image: string }>;
    index[storyKey(PAGE)]!.image = "none";
    writeFileSync(join(dir, "scout", "media", "index.json"), JSON.stringify(index));
    const hidden = applyStoryMedia({ now: [], recent: [{ id: "news", kind: "news", title: "Today", stories: [story], at: "2026-10-17T11:00:00.000Z" }], week: [] }, dir);
    expect(hidden.recent[0]?.stories?.[0]?.image).toBeUndefined();
  });

  it("puts the cached picture on the news the column already reads", () => {
    const key = storyKey(PAGE);
    mkdirSync(join(dir, "logs"), { recursive: true });
    mkdirSync(join(dir, "scout", "media"), { recursive: true });
    writeFileSync(join(dir, "logs", "agenda.log"), "2026-10-17T11:10:00.000Z scout: edition: 1 items\n");
    writeFileSync(join(dir, "scout", "edition-latest.json"), JSON.stringify({ date: "2026-10-17", items: [{ title: "A course", url: PAGE, why: "The machinery.", source: "Magazine" }] }));
    writeFileSync(join(dir, "scout", "media", `${key}.img`), PNG);
    writeFileSync(join(dir, "scout", "media", "index.json"), JSON.stringify({ [key]: { url: PAGE, at: "2026-10-17T11:00:00.000Z", image: "file", imageType: "image/png", icon: "none" } }));
    const stories = new ActivityReader({ dir, now: () => Date.parse("2026-10-17T12:00:00.000Z") }).current().recent.find((item) => item.title === "Put together today's news")?.stories;
    expect(stories?.[0]?.image).toBe(`/api/story-image?id=${key}`);
    expect(stories?.[0]?.title).toBe("A course");
  });

  it("keeps the picture a photo came with, and the preview a video came with", async () => {
    const photo = "https://www.pexels.com/photo/man-3811807/";
    const video = "https://www.pexels.com/video/landing-10393579/";
    const talk = "https://www.youtube.com/watch?v=8R0FGJCERtg";
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "ascii"), Buffer.alloc(24)]);
    const sources = storySources({ items: [
      { url: photo, media: "image", mediaUrl: "https://images.pexels.com/photos/1/photo.jpeg" },
      { url: video, media: "video", mediaUrl: "https://videos.pexels.com/video-files/1/clip.mp4" },
      { url: talk, media: "video" },
      { url: "https://example.com/plain", media: "article" },
    ] });
    expect(sources).toEqual([
      { url: photo, image: "https://images.pexels.com/photos/1/photo.jpeg" },
      { url: video, clip: "https://videos.pexels.com/video-files/1/clip.mp4" },
      { url: talk, image: "https://i.ytimg.com/vi/8R0FGJCERtg/hqdefault.jpg" },
    ]);

    await collectStorySource(dir, sources[0]!, fetcher({ "https://images.pexels.com/photos/1/photo.jpeg": { body: PNG, type: "image/png" } }), lookup);
    await collectStorySource(dir, sources[1]!, fetcher({ "https://videos.pexels.com/video-files/1/clip.mp4": { body: mp4, type: "video/mp4" } }), lookup);
    expect(storyAsset(dir, "image", storyKey(photo))?.type).toBe("image/png");
    expect(storyAsset(dir, "clip", storyKey(video))?.type).toBe("video/mp4");

    const stories = [
      { title: "A surprised man", url: photo, media: "image" as const },
      { title: "A landing", url: video, media: "video" as const },
      { title: "No picture at all", url: "https://www.pexels.com/photo/missing-2/", media: "image" as const },
      { title: "A plain story", url: "https://magazine.example/plain" },
    ];
    const panel = applyStoryMedia({ now: [], recent: [{ id: "news", kind: "news", title: "Today", stories, at: "2026-10-17T11:00:00.000Z" }], week: [] }, dir);
    const shown = panel.recent[0]!.stories!;
    // A photo with no picture is not a story with a headline: it leaves the edition instead.
    expect(shown.map((story) => story.title)).toEqual(["A surprised man", "A landing", "A plain story"]);
    expect(shown[0]?.image).toBe(`/api/story-image?id=${storyKey(photo)}`);
    expect(shown[1]?.clip).toBe(`/api/story-clip?id=${storyKey(video)}`);
    expect(shown[2]).toEqual({ title: "A plain story", url: "https://magazine.example/plain" });
  });

  it("toggles a saved story without inventing a picture", () => {
    expect(toggleSavedStory(dir, PAGE)).toBe(true);
    expect(toggleSavedStory(dir, PAGE)).toBe(false);
    const story = { title: "A course", url: PAGE };
    toggleSavedStory(dir, PAGE);
    const panel = applyStoryMedia({ now: [], recent: [{ id: "news", kind: "news", title: "Today", stories: [story], at: "2026-10-17T11:00:00.000Z" }], week: [] }, dir);
    expect(panel.recent[0]?.stories?.[0]).toEqual({ ...story, saved: true });
    expect(panel.recent[0]?.stories?.[0]?.image).toBeUndefined();
  });
});
