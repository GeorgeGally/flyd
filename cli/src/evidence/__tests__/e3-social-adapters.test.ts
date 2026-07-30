import { describe, expect, it } from "vitest";
import { HackerNewsAdapter } from "../adapters/hackernews.js";
import { RedditAdapter } from "../adapters/reddit.js";
import { XApiAdapter } from "../adapters/x-api.js";
import type { FetchLike } from "../adapters/common.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("E3 social and community adapters", () => {
  it("normalizes Hacker News search results without authentication", async () => {
    const fetchFn: FetchLike = async () => jsonResponse({
      hits: [{
        objectID: "42",
        title: "Flyd evidence engine",
        url: "https://example.com/flyd",
        author: "alice",
        created_at: "2026-07-30T00:00:00.000Z",
        points: 120,
        num_comments: 30,
      }],
    });
    const adapter = new HackerNewsAdapter({ fetchFn, minimumIntervalMs: 0 });
    const items = await adapter.search!({ query: "flyd", queryLabel: "community", limit: 5 });
    expect(items).toHaveLength(1);
    expect(items[0].capability).toBe("hackernews");
    expect(items[0].locator).toContain("item?id=42");
    expect(items[0].metadata?.linkedUrl).toBe("https://example.com/flyd");
  });

  it("reports public Reddit access as degraded but usable", async () => {
    const fetchFn: FetchLike = async () => jsonResponse({ data: { children: [] } });
    const adapter = new RedditAdapter({ fetchFn, minimumIntervalMs: 0 });
    const probe = await adapter.probe();
    expect(probe.status).toBe("degraded");
    const items = await adapter.search!({ query: "flyd", queryLabel: "community", limit: 5 });
    expect(items).toEqual([]);
  });

  it("normalizes Reddit posts and preserves subreddit provenance", async () => {
    const fetchFn: FetchLike = async () => jsonResponse({
      data: {
        children: [{ data: {
          id: "abc",
          name: "t3_abc",
          title: "Using Flyd",
          selftext: "It works well for research.",
          permalink: "/r/LocalLLaMA/comments/abc/using_flyd/",
          author: "bob",
          created_utc: 1785369600,
          score: 55,
          num_comments: 8,
          subreddit: "LocalLLaMA",
          is_self: true,
        } }],
      },
    });
    const adapter = new RedditAdapter({ fetchFn, accessToken: "token", minimumIntervalMs: 0 });
    const items = await adapter.search!({ query: "flyd", queryLabel: "community", limit: 5 });
    expect(items[0].capability).toBe("reddit");
    expect(items[0].metadata?.subreddit).toBe("LocalLLaMA");
    expect(items[0].locator).toContain("reddit.com/r/LocalLLaMA");
  });

  it("requires isolated X credentials and normalizes authenticated results", async () => {
    const missing = new XApiAdapter({ minimumIntervalMs: 0 });
    expect((await missing.probe()).status).toBe("auth_required");

    const fetchFn: FetchLike = async () => jsonResponse({
      data: [{
        id: "123",
        text: "Flyd shipped external evidence.",
        author_id: "u1",
        created_at: "2026-07-30T00:00:00.000Z",
        public_metrics: { like_count: 10, retweet_count: 2 },
      }],
      includes: { users: [{ id: "u1", username: "flyd", name: "Flyd", verified: true }] },
    });
    const adapter = new XApiAdapter({ fetchFn, bearerToken: "token", minimumIntervalMs: 0 });
    const items = await adapter.search!({ query: "flyd", queryLabel: "recent", limit: 10 });
    expect(items[0].author).toBe("flyd");
    expect(items[0].locator).toBe("https://x.com/flyd/status/123");
    expect(items[0].sourceQuality).toBeGreaterThan(0.7);
  });
});
