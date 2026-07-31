import type {
  CapabilityAdapter,
  CapabilityProbe,
  EvidenceItem,
  EvidenceReadRequest,
  EvidenceSearchRequest,
} from "../types.js";
import {
  fetchJson,
  fetchWithTimeout,
  makeEvidenceItem,
  type FetchLike,
} from "./common.js";
import { MinimumIntervalGate } from "./rate-gate.js";

const PUBLIC_ROOT = "https://www.reddit.com";
const OAUTH_ROOT = "https://oauth.reddit.com";
const USER_AGENT = "flyd-evidence-engine/0.1 (local personal assistant)";

interface RedditAdapterOptions {
  fetchFn?: FetchLike;
  accessToken?: string;
  now?: () => Date;
  minimumIntervalMs?: number;
}

interface RedditPost {
  id: string;
  name?: string;
  title?: string;
  selftext?: string;
  permalink?: string;
  url?: string;
  author?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
  subreddit?: string;
  is_self?: boolean;
  over_18?: boolean;
}

interface RedditComment {
  id: string;
  body?: string;
  permalink?: string;
  author?: string;
  created_utc?: number;
  score?: number;
  subreddit?: string;
}

interface RedditListing<T> {
  data?: {
    children?: Array<{ kind?: string; data?: T }>;
  };
}

function headers(token?: string): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function redditUrl(permalink: string | undefined, fallback?: string): string | undefined {
  if (permalink) return `${PUBLIC_ROOT}${permalink}`;
  return fallback;
}

function publishedAt(unix: number | undefined): string | undefined {
  return typeof unix === "number" && Number.isFinite(unix)
    ? new Date(unix * 1000).toISOString()
    : undefined;
}

function engagement(score?: number, comments?: number): number | undefined {
  const total = Math.max(0, score ?? 0) + Math.max(0, comments ?? 0);
  return total > 0 ? Math.min(1, Math.log10(total + 1) / 5) : undefined;
}

function postContent(post: RedditPost): string {
  return [
    post.selftext?.trim() || "",
    !post.is_self && post.url ? `Linked source: ${post.url}` : "",
  ].filter(Boolean).join("\n") || post.title || "Reddit post";
}

function listingPosts(payload: RedditListing<RedditPost>): RedditPost[] {
  return (payload.data?.children ?? [])
    .map((child) => child.data)
    .filter((post): post is RedditPost => Boolean(post?.id));
}

function parseRedditLocator(locator: string): { jsonUrl: string; canonical: string } | null {
  try {
    const url = new URL(locator);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "reddit.com" && host !== "old.reddit.com" && host !== "redd.it") return null;
    if (host === "redd.it") return { jsonUrl: `${PUBLIC_ROOT}/comments/${url.pathname.split("/").filter(Boolean)[0]}.json?raw_json=1`, canonical: locator };
    const path = url.pathname.replace(/\/$/, "");
    return { jsonUrl: `${PUBLIC_ROOT}${path}.json?raw_json=1`, canonical: `${PUBLIC_ROOT}${path}` };
  } catch {
    return null;
  }
}

export class RedditAdapter implements CapabilityAdapter {
  readonly id = "reddit:json";
  readonly capability = "reddit" as const;
  readonly priority = 10;
  readonly operations = ["read", "search"] as const;
  readonly signals = ["discussion", "social", "reference"] as const;

  private readonly fetchFn: FetchLike;
  private readonly accessToken?: string;
  private readonly now: () => Date;
  private readonly gate: MinimumIntervalGate;

  constructor(options: RedditAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.accessToken = options.accessToken;
    this.now = options.now ?? (() => new Date());
    this.gate = new MinimumIntervalGate({ minimumIntervalMs: options.minimumIntervalMs ?? 1_100 });
  }

  async probe(): Promise<CapabilityProbe> {
    try {
      await this.gate.wait();
      const endpoint = this.accessToken
        ? `${OAUTH_ROOT}/api/v1/me`
        : `${PUBLIC_ROOT}/r/all/new.json?limit=1&raw_json=1`;
      const response = await fetchWithTimeout(this.fetchFn, endpoint, { headers: headers(this.accessToken) }, 5_000);
      if (response.status === 401) {
        return {
          status: "auth_required",
          reason: "configured Reddit access token was rejected",
          fix: "Refresh REDDIT_ACCESS_TOKEN or remove it to use public degraded access",
        };
      }
      if (response.status === 429) return { status: "degraded", reason: "Reddit rate limit reached" };
      if (!response.ok) return { status: "unavailable", reason: `Reddit returned HTTP ${response.status}` };
      return this.accessToken
        ? { status: "ready" }
        : {
            status: "degraded",
            reason: "public Reddit JSON access; conservative rate and availability limits",
            fix: "Set REDDIT_ACCESS_TOKEN for authenticated API access",
          };
    } catch (error) {
      return { status: "unavailable", reason: error instanceof Error ? error.message : "Reddit probe failed" };
    }
  }

  async search(request: EvidenceSearchRequest): Promise<EvidenceItem[]> {
    await this.gate.wait();
    const limit = Math.min(Math.max(request.limit, 1), 50);
    const root = this.accessToken ? OAUTH_ROOT : PUBLIC_ROOT;
    const endpoint = `${root}/search.json?q=${encodeURIComponent(request.query)}&sort=relevance&t=month&limit=${limit}&raw_json=1`;
    const payload = await fetchJson<RedditListing<RedditPost>>(
      this.fetchFn,
      endpoint,
      { headers: headers(this.accessToken) },
    );

    return listingPosts(payload).slice(0, limit).map((post, index) => makeEvidenceItem({
      capability: this.capability,
      backend: this.id,
      kind: "discussion",
      title: post.title,
      content: postContent(post),
      locator: redditUrl(post.permalink, post.url),
      sourceItemId: post.name || post.id,
      publishedAt: publishedAt(post.created_utc),
      author: post.author,
      queryLabel: request.queryLabel,
      nativeRank: index + 1,
      sourceQuality: 0.74,
      engagement: engagement(post.score, post.num_comments),
      now: this.now(),
      metadata: {
        subreddit: post.subreddit,
        score: post.score,
        comments: post.num_comments,
        externalUrl: post.is_self ? undefined : post.url,
        nsfw: post.over_18,
      },
    }));
  }

  async read(request: EvidenceReadRequest): Promise<EvidenceItem[]> {
    const parsed = parseRedditLocator(request.locator);
    if (!parsed) throw new Error("Reddit adapter only reads reddit.com or redd.it URLs");
    await this.gate.wait();
    const payload = await fetchJson<Array<RedditListing<RedditPost | RedditComment>>>(
      this.fetchFn,
      parsed.jsonUrl,
      { headers: headers() },
    );

    const post = payload[0]?.data?.children?.[0]?.data as RedditPost | undefined;
    if (!post?.id) return [];
    const topComments = (payload[1]?.data?.children ?? [])
      .map((child) => child.data as RedditComment | undefined)
      .filter((comment): comment is RedditComment => Boolean(comment?.id && comment.body))
      .slice(0, 8);

    const items: EvidenceItem[] = [makeEvidenceItem({
      capability: this.capability,
      backend: this.id,
      kind: "discussion",
      title: post.title,
      content: postContent(post),
      locator: redditUrl(post.permalink, parsed.canonical),
      sourceItemId: post.name || post.id,
      publishedAt: publishedAt(post.created_utc),
      author: post.author,
      queryLabel: "direct_read",
      nativeRank: 1,
      sourceQuality: 0.76,
      engagement: engagement(post.score, post.num_comments),
      now: this.now(),
      metadata: { subreddit: post.subreddit, score: post.score, comments: post.num_comments, itemType: "post" },
    })];

    topComments.forEach((comment, index) => {
      items.push(makeEvidenceItem({
        capability: this.capability,
        backend: this.id,
        kind: "discussion",
        content: comment.body || "",
        locator: redditUrl(comment.permalink, parsed.canonical),
        sourceItemId: comment.id,
        publishedAt: publishedAt(comment.created_utc),
        author: comment.author,
        queryLabel: "direct_read",
        nativeRank: index + 2,
        sourceQuality: 0.68,
        engagement: engagement(comment.score),
        now: this.now(),
        metadata: { subreddit: comment.subreddit, score: comment.score, itemType: "comment" },
      }));
    });

    return items;
  }
}
