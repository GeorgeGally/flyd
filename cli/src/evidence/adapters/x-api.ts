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

const API_ROOT = "https://api.x.com/2";

interface XAdapterOptions {
  fetchFn?: FetchLike;
  bearerToken?: string;
  now?: () => Date;
  minimumIntervalMs?: number;
}

interface XTweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
    bookmark_count?: number;
    impression_count?: number;
  };
}

interface XUser {
  id: string;
  username?: string;
  name?: string;
  verified?: boolean;
}

interface XResponse {
  data?: XTweet[] | XTweet;
  includes?: { users?: XUser[] };
  errors?: Array<{ title?: string; detail?: string }>;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "flyd-evidence-engine",
  };
}

function tweetIdFromLocator(locator: string): string | null {
  try {
    const url = new URL(locator);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const statusIndex = parts.indexOf("status");
    return statusIndex >= 0 ? parts[statusIndex + 1] || null : null;
  } catch {
    return null;
  }
}

function userMap(response: XResponse): Map<string, XUser> {
  return new Map((response.includes?.users ?? []).map((user) => [user.id, user]));
}

function engagement(metrics: XTweet["public_metrics"]): number | undefined {
  if (!metrics) return undefined;
  const total = (metrics.like_count ?? 0) + (metrics.retweet_count ?? 0) +
    (metrics.reply_count ?? 0) + (metrics.quote_count ?? 0) + (metrics.bookmark_count ?? 0);
  return total > 0 ? Math.min(1, Math.log10(total + 1) / 6) : undefined;
}

function locator(tweet: XTweet, user?: XUser): string {
  return `https://x.com/${encodeURIComponent(user?.username || "i")}/status/${encodeURIComponent(tweet.id)}`;
}

function normalizeTweets(
  response: XResponse,
  backend: string,
  queryLabel: string,
  now: () => Date,
): EvidenceItem[] {
  const tweets = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
  const users = userMap(response);
  return tweets.map((tweet, index) => {
    const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
    return makeEvidenceItem({
      capability: "x",
      backend,
      kind: "social",
      content: tweet.text,
      locator: locator(tweet, user),
      sourceItemId: tweet.id,
      publishedAt: tweet.created_at,
      author: user?.username || user?.name || tweet.author_id,
      queryLabel,
      nativeRank: index + 1,
      sourceQuality: user?.verified ? 0.78 : 0.68,
      engagement: engagement(tweet.public_metrics),
      now: now(),
      metadata: {
        authorId: tweet.author_id,
        username: user?.username,
        displayName: user?.name,
        verified: user?.verified,
        language: tweet.lang,
        metrics: tweet.public_metrics,
      },
    });
  });
}

export class XApiAdapter implements CapabilityAdapter {
  readonly id = "x:api-v2";
  readonly capability = "x" as const;
  readonly priority = 10;
  readonly operations = ["read", "search"] as const;
  readonly signals = ["social", "first_party", "news"] as const;

  private readonly fetchFn: FetchLike;
  private readonly bearerToken?: string;
  private readonly now: () => Date;
  private readonly gate: MinimumIntervalGate;

  constructor(options: XAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.bearerToken = options.bearerToken;
    this.now = options.now ?? (() => new Date());
    this.gate = new MinimumIntervalGate({ minimumIntervalMs: options.minimumIntervalMs ?? 1_100 });
  }

  async probe(): Promise<CapabilityProbe> {
    if (!this.bearerToken) {
      return {
        status: "auth_required",
        reason: "X recent search requires an API bearer token",
        fix: "Set X_BEARER_TOKEN or TWITTER_BEARER_TOKEN",
      };
    }
    try {
      await this.gate.wait();
      const response = await fetchWithTimeout(
        this.fetchFn,
        `${API_ROOT}/tweets/search/recent?query=flyd&max_results=10`,
        { headers: authHeaders(this.bearerToken) },
        5_000,
      );
      if (response.status === 401) return { status: "auth_required", reason: "X bearer token was rejected", fix: "Refresh X_BEARER_TOKEN" };
      if (response.status === 429) return { status: "degraded", reason: "X API rate limit reached" };
      if (response.status === 402 || response.status === 403) {
        return { status: "unavailable", reason: `X API access is not permitted for this account (HTTP ${response.status})` };
      }
      if (!response.ok) return { status: "unavailable", reason: `X API returned HTTP ${response.status}` };
      return { status: "ready" };
    } catch (error) {
      return { status: "unavailable", reason: error instanceof Error ? error.message : "X API probe failed" };
    }
  }

  async search(request: EvidenceSearchRequest): Promise<EvidenceItem[]> {
    if (!this.bearerToken) throw new Error("X_BEARER_TOKEN is required for X search");
    await this.gate.wait();
    const maxResults = Math.min(100, Math.max(10, request.limit));
    const fields = "created_at,author_id,public_metrics,lang";
    const endpoint = `${API_ROOT}/tweets/search/recent?query=${encodeURIComponent(request.query)}&max_results=${maxResults}` +
      `&tweet.fields=${encodeURIComponent(fields)}&expansions=author_id&user.fields=username,name,verified`;
    const response = await fetchJson<XResponse>(this.fetchFn, endpoint, { headers: authHeaders(this.bearerToken) });
    return normalizeTweets(response, this.id, request.queryLabel, this.now).slice(0, request.limit);
  }

  async read(request: EvidenceReadRequest): Promise<EvidenceItem[]> {
    if (!this.bearerToken) throw new Error("X_BEARER_TOKEN is required to read X posts");
    const id = tweetIdFromLocator(request.locator);
    if (!id) throw new Error("X adapter only reads x.com or twitter.com status URLs");
    await this.gate.wait();
    const fields = "created_at,author_id,public_metrics,lang";
    const endpoint = `${API_ROOT}/tweets/${encodeURIComponent(id)}?tweet.fields=${encodeURIComponent(fields)}` +
      `&expansions=author_id&user.fields=username,name,verified`;
    const response = await fetchJson<XResponse>(this.fetchFn, endpoint, { headers: authHeaders(this.bearerToken) });
    return normalizeTweets(response, this.id, "direct_read", this.now);
  }
}
