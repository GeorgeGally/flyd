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

const ALGOLIA_ROOT = "https://hn.algolia.com/api/v1";
const FIREBASE_ROOT = "https://hacker-news.firebaseio.com/v0";

interface HackerNewsAdapterOptions {
  fetchFn?: FetchLike;
  now?: () => Date;
  minimumIntervalMs?: number;
}

interface AlgoliaHit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  author?: string;
  created_at?: string;
  points?: number | null;
  num_comments?: number | null;
  comment_text?: string | null;
  story_text?: string | null;
}

interface AlgoliaResponse {
  hits?: AlgoliaHit[];
}

interface FirebaseItem {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  text?: string;
  url?: string;
  score?: number;
  descendants?: number;
  deleted?: boolean;
  dead?: boolean;
}

function stripHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<p\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function itemUrl(id: string | number): string {
  return `https://news.ycombinator.com/item?id=${encodeURIComponent(String(id))}`;
}

function engagement(points?: number | null, comments?: number | null): number | undefined {
  const total = Math.max(0, points ?? 0) + Math.max(0, comments ?? 0);
  return total > 0 ? Math.min(1, Math.log10(total + 1) / 5) : undefined;
}

function hnIdFromLocator(locator: string): string | null {
  try {
    const url = new URL(locator);
    if (url.hostname !== "news.ycombinator.com") return null;
    return url.searchParams.get("id");
  } catch {
    return null;
  }
}

export class HackerNewsAdapter implements CapabilityAdapter {
  readonly id = "hackernews:algolia-firebase";
  readonly capability = "hackernews" as const;
  readonly priority = 10;
  readonly operations = ["read", "search"] as const;
  readonly signals = ["discussion", "news", "reference"] as const;

  private readonly fetchFn: FetchLike;
  private readonly now: () => Date;
  private readonly gate: MinimumIntervalGate;

  constructor(options: HackerNewsAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.gate = new MinimumIntervalGate({ minimumIntervalMs: options.minimumIntervalMs ?? 250 });
  }

  async probe(): Promise<CapabilityProbe> {
    try {
      await this.gate.wait();
      const response = await fetchWithTimeout(
        this.fetchFn,
        `${ALGOLIA_ROOT}/search?query=flyd&hitsPerPage=1`,
        { headers: { "User-Agent": "flyd-evidence-engine" } },
        4_000,
      );
      if (response.status === 429) return { status: "degraded", reason: "Hacker News search is rate limited" };
      if (!response.ok) return { status: "unavailable", reason: `Hacker News returned HTTP ${response.status}` };
      return { status: "ready" };
    } catch (error) {
      return { status: "unavailable", reason: error instanceof Error ? error.message : "Hacker News probe failed" };
    }
  }

  async search(request: EvidenceSearchRequest): Promise<EvidenceItem[]> {
    await this.gate.wait();
    const limit = Math.min(Math.max(request.limit, 1), 30);
    const payload = await fetchJson<AlgoliaResponse>(
      this.fetchFn,
      `${ALGOLIA_ROOT}/search_by_date?query=${encodeURIComponent(request.query)}&hitsPerPage=${limit}`,
      { headers: { "User-Agent": "flyd-evidence-engine" } },
    );

    return (payload.hits ?? []).slice(0, limit).map((hit, index) => {
      const rank = index + 1;
      const title = hit.title || hit.story_title || undefined;
      const body = stripHtml(hit.comment_text || hit.story_text);
      const linkedUrl = hit.url || hit.story_url || undefined;
      const content = [body, linkedUrl ? `Linked source: ${linkedUrl}` : ""].filter(Boolean).join("\n");
      return makeEvidenceItem({
        capability: this.capability,
        backend: this.id,
        kind: hit.comment_text ? "discussion" : "news",
        title,
        content: content || title || "Hacker News item",
        locator: itemUrl(hit.objectID),
        sourceItemId: hit.objectID,
        publishedAt: hit.created_at,
        author: hit.author,
        queryLabel: request.queryLabel,
        nativeRank: rank,
        sourceQuality: hit.comment_text ? 0.72 : 0.8,
        engagement: engagement(hit.points, hit.num_comments),
        now: this.now(),
        metadata: {
          linkedUrl,
          points: hit.points,
          comments: hit.num_comments,
          itemType: hit.comment_text ? "comment" : "story",
        },
      });
    });
  }

  async read(request: EvidenceReadRequest): Promise<EvidenceItem[]> {
    const id = hnIdFromLocator(request.locator);
    if (!id) throw new Error("Hacker News adapter only reads news.ycombinator.com item URLs");
    await this.gate.wait();
    const item = await fetchJson<FirebaseItem>(this.fetchFn, `${FIREBASE_ROOT}/item/${encodeURIComponent(id)}.json`);
    if (!item || item.deleted || item.dead) return [];

    const publishedAt = typeof item.time === "number" ? new Date(item.time * 1000).toISOString() : undefined;
    const body = stripHtml(item.text);
    return [makeEvidenceItem({
      capability: this.capability,
      backend: this.id,
      kind: item.type === "comment" ? "discussion" : "news",
      title: item.title,
      content: [body, item.url ? `Linked source: ${item.url}` : ""].filter(Boolean).join("\n") || item.title || "Hacker News item",
      locator: itemUrl(item.id),
      sourceItemId: String(item.id),
      publishedAt,
      author: item.by,
      queryLabel: "direct_read",
      nativeRank: 1,
      sourceQuality: item.type === "comment" ? 0.72 : 0.82,
      engagement: engagement(item.score, item.descendants),
      now: this.now(),
      metadata: { linkedUrl: item.url, points: item.score, comments: item.descendants, itemType: item.type },
    })];
  }
}
