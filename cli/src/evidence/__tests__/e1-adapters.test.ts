import { describe, expect, it } from "vitest";
import { GitHubRestAdapter } from "../adapters/github-rest.js";
import { RssAdapter } from "../adapters/rss.js";
import { JinaReaderAdapter, JinaSearchAdapter } from "../adapters/web-jina.js";
import { YoutubeYtDlpAdapter, vttToText } from "../adapters/youtube-ytdlp.js";
import type { CommandRunner, FetchLike } from "../adapters/common.js";

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("Jina web adapters", () => {
  it("reads a web page into normalized evidence", async () => {
    const fetchFn: FetchLike = async (_input, init) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return jsonResponse({
        data: {
          title: "Example",
          url: "https://example.com/article",
          content: "Grounded article body",
          publishedTime: "2026-07-30T00:00:00.000Z",
        },
      });
    };
    const adapter = new JinaReaderAdapter({
      fetchFn,
      now: () => new Date("2026-07-30T01:00:00.000Z"),
    });

    expect((await adapter.probe()).status).toBe("ready");
    const items = await adapter.read!({ locator: "https://example.com/article" });
    expect(items).toHaveLength(1);
    expect(items[0].capability).toBe("web");
    expect(items[0].backend).toBe("web:jina-reader");
    expect(items[0].content).toContain("Grounded article body");
    expect(items[0].provenance[0].locator).toBe("https://example.com/article");
  });

  it("reports web search as auth-required without a Jina key", async () => {
    const adapter = new JinaSearchAdapter({ fetchFn: async () => new Response(null, { status: 200 }) });
    const health = await adapter.probe();
    expect(health.status).toBe("auth_required");
    expect(health.fix).toContain("JINA_API_KEY");
  });

  it("normalizes Jina search results with rank provenance", async () => {
    const fetchFn: FetchLike = async (_input, init) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return jsonResponse({
        data: [
          { title: "One", url: "https://one.test", content: "first" },
          { title: "Two", url: "https://two.test", content: "second" },
        ],
      });
    };
    const adapter = new JinaSearchAdapter({ fetchFn, apiKey: "jina_test" });
    const items = await adapter.search!({ query: "topic", queryLabel: "primary", limit: 2 });
    expect(items.map((item) => item.nativeRank)).toEqual([1, 2]);
    expect(items[0].provenance[0].queryLabel).toBe("primary");
  });
});

describe("GitHub REST adapter", () => {
  it("works in degraded public mode without a token and searches repos/issues", async () => {
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith("/rate_limit")) return jsonResponse({ resources: {} });
      if (url.includes("/search/repositories")) {
        return jsonResponse({ items: [{
          id: 1,
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
          description: "repo description",
          stargazers_count: 42,
          pushed_at: "2026-07-30T00:00:00Z",
          owner: { login: "owner" },
          score: 2,
        }] });
      }
      if (url.includes("/search/issues")) {
        return jsonResponse({ items: [{
          id: 2,
          number: 7,
          title: "Important issue",
          body: "issue body",
          html_url: "https://github.com/owner/repo/issues/7",
          updated_at: "2026-07-29T00:00:00Z",
          user: { login: "dev" },
          score: 1,
        }] });
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    const adapter = new GitHubRestAdapter({ fetchFn });

    expect((await adapter.probe()).status).toBe("degraded");
    const items = await adapter.search!({ query: "repo", queryLabel: "primary", limit: 2 });
    expect(items).toHaveLength(2);
    expect(items[0].locator).toBe("https://github.com/owner/repo");
    expect(items[1].kind).toBe("discussion");
  });

  it("reads a GitHub blob through the contents API", async () => {
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      expect(url).toContain("/repos/owner/repo/contents/src/file.ts?ref=main");
      return jsonResponse({
        content: Buffer.from("export const value = 1;", "utf8").toString("base64"),
        encoding: "base64",
        html_url: "https://github.com/owner/repo/blob/main/src/file.ts",
        path: "src/file.ts",
        sha: "abc",
      });
    };
    const adapter = new GitHubRestAdapter({ fetchFn, token: "token" });
    const items = await adapter.read!({ locator: "https://github.com/owner/repo/blob/main/src/file.ts" });
    expect(items[0].content).toContain("export const value");
    expect(items[0].sourceItemId).toBe("abc");
  });
});

describe("RSS adapter", () => {
  it("parses RSS entries without a third-party parser dependency", async () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Example Feed</title>
      <item><title>First post</title><link>https://example.com/1</link><guid>one</guid><pubDate>Thu, 30 Jul 2026 00:00:00 GMT</pubDate><description><![CDATA[<p>Hello &amp; world</p>]]></description></item>
      <item><title>Second post</title><link>https://example.com/2</link><guid>two</guid><description>Second</description></item>
    </channel></rss>`;
    const adapter = new RssAdapter({
      fetchFn: async () => new Response(xml, { status: 200, headers: { "Content-Type": "application/rss+xml" } }),
    });
    const items = await adapter.read!({ locator: "https://example.com/feed.xml" });
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("First post");
    expect(items[0].content).toBe("Hello & world");
    expect(items[0].metadata?.feedTitle).toBe("Example Feed");
  });
});

describe("YouTube yt-dlp adapter", () => {
  it("searches via ytsearch and normalizes video evidence", async () => {
    const runner: CommandRunner = async (_file, args) => {
      if (args.includes("--version")) return { stdout: "2026.07.01\n", stderr: "" };
      return {
        stdout: JSON.stringify({ entries: [{ id: "abc", title: "Video", channel: "Creator", view_count: 1000 }] }),
        stderr: "",
      };
    };
    const adapter = new YoutubeYtDlpAdapter({ commandRunner: runner });
    expect((await adapter.probe()).status).toBe("ready");
    const items = await adapter.search!({ query: "flyd", queryLabel: "primary", limit: 1 });
    expect(items[0].locator).toBe("https://www.youtube.com/watch?v=abc");
    expect(items[0].author).toBe("Creator");
  });

  it("cleans repeated VTT subtitle cues", () => {
    const text = vttToText(`WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello world\n\n00:00:01.000 --> 00:00:02.000\nHello world\nNext line`);
    expect(text).toBe("Hello world Next line");
  });
});
