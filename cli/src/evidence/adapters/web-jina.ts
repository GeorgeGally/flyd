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
  probeHttp,
  type FetchLike,
} from "./common.js";

const READER_ENDPOINT = "https://r.jina.ai/";
const SEARCH_ENDPOINT = "https://s.jina.ai/";

interface JinaReaderPayload {
  data?: {
    title?: string;
    description?: string;
    url?: string;
    content?: string;
    publishedTime?: string;
    date?: string;
  };
}

interface JinaSearchResult {
  title?: string;
  description?: string;
  url?: string;
  content?: string;
  publishedTime?: string;
  date?: string;
}

interface JinaSearchPayload {
  data?: JinaSearchResult[];
}

interface JinaAdapterOptions {
  fetchFn?: FetchLike;
  apiKey?: string;
  now?: () => Date;
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export class JinaReaderAdapter implements CapabilityAdapter {
  readonly id = "web:jina-reader";
  readonly capability = "web" as const;
  readonly priority = 10;
  readonly operations = ["read"] as const;
  readonly signals = ["reference", "first_party", "news"] as const;

  private readonly fetchFn: FetchLike;
  private readonly apiKey?: string;
  private readonly now: () => Date;

  constructor(options: JinaAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.apiKey = options.apiKey;
    this.now = options.now ?? (() => new Date());
  }

  async probe(): Promise<CapabilityProbe> {
    // Jina Reader serves reads as POST requests. Its root HEAD endpoint can be
    // rejected by an edge node even when the actual reader is healthy, so probe
    // the same operation Flyd uses rather than reporting a false outage.
    try {
      const response = await fetchWithTimeout(this.fetchFn, READER_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...authHeaders(this.apiKey),
        },
        body: JSON.stringify({ url: "https://example.com" }),
      }, 4_000);
      if (response.status === 401 || response.status === 403) {
        return this.apiKey
          ? { status: "auth_required", reason: `HTTP ${response.status}` }
          : { status: "degraded", reason: "reader endpoint reachable; anonymous read rejected" };
      }
      if (response.status === 429) return { status: "degraded", reason: "remote rate limit reached" };
      if (response.status >= 500) return { status: "unavailable", reason: `remote service returned HTTP ${response.status}` };
      return { status: "ready" };
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : "remote health probe failed",
      };
    }
  }

  async read(request: EvidenceReadRequest): Promise<EvidenceItem[]> {
    const payload = await fetchJson<JinaReaderPayload>(this.fetchFn, READER_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...authHeaders(this.apiKey),
      },
      body: JSON.stringify({ url: request.locator }),
    });

    const data = payload.data;
    if (!data?.content?.trim()) return [];
    const locator = data.url || request.locator;
    const publishedAt = data.publishedTime || data.date;

    return [makeEvidenceItem({
      capability: this.capability,
      backend: this.id,
      kind: "reference",
      title: data.title,
      content: data.content || data.description || "",
      locator,
      sourceItemId: locator,
      publishedAt,
      queryLabel: "direct_read",
      nativeRank: 1,
      sourceQuality: 0.84,
      now: this.now(),
      metadata: data.description ? { description: data.description } : undefined,
    })];
  }
}

export class JinaSearchAdapter implements CapabilityAdapter {
  readonly id = "web:jina-search";
  readonly capability = "web" as const;
  readonly priority = 10;
  readonly operations = ["search"] as const;
  readonly signals = ["reference", "first_party", "news"] as const;

  private readonly fetchFn: FetchLike;
  private readonly apiKey?: string;
  private readonly now: () => Date;

  constructor(options: JinaAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.apiKey = options.apiKey;
    this.now = options.now ?? (() => new Date());
  }

  async probe(): Promise<CapabilityProbe> {
    if (!this.apiKey) {
      return {
        status: "auth_required",
        reason: "JINA_API_KEY is required for web search",
        fix: "Set JINA_API_KEY in Flyd's environment",
      };
    }
    return await probeHttp(this.fetchFn, SEARCH_ENDPOINT, authHeaders(this.apiKey));
  }

  async search(request: EvidenceSearchRequest): Promise<EvidenceItem[]> {
    if (!this.apiKey) {
      throw new Error("JINA_API_KEY is required for web search");
    }

    const payload = await fetchJson<JinaSearchPayload>(this.fetchFn, SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "X-No-Cache": "true",
      },
      body: JSON.stringify({
        q: request.query,
        count: Math.min(Math.max(request.limit, 1), 20),
        options: "Markdown",
      }),
    });

    return (payload.data ?? [])
      .slice(0, request.limit)
      .map((result, index) => {
        const rank = index + 1;
        const locator = result.url;
        const sourceItemId = locator || `${request.query}:${rank}`;
        return makeEvidenceItem({
          capability: this.capability,
          backend: this.id,
          kind: "reference",
          title: result.title,
          content: result.content || result.description || result.title || "",
          locator,
          sourceItemId,
          publishedAt: result.publishedTime || result.date,
          queryLabel: request.queryLabel,
          nativeRank: rank,
          sourceQuality: 0.84,
          now: this.now(),
          metadata: result.description ? { description: result.description } : undefined,
        });
      })
      .filter((item) => item.content.length > 0);
  }
}
