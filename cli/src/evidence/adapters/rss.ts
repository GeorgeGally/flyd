import type {
  CapabilityAdapter,
  CapabilityProbe,
  EvidenceItem,
  EvidenceReadRequest,
} from "../types.js";
import { fetchText, makeEvidenceItem, type FetchLike } from "./common.js";

interface RssAdapterOptions {
  fetchFn?: FetchLike;
  now?: () => Date;
}

const MAX_FEED_BYTES = 2 * 1024 * 1024;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripMarkup(value: string): string {
  return decodeXml(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    if (match?.[1]) return stripMarkup(match[1]);
  }
  return undefined;
}

function entryLink(block: string): string | undefined {
  const textLink = tagValue(block, ["link"]);
  if (textLink?.startsWith("http")) return textLink;
  const attrMatch = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return attrMatch?.[1] ? decodeXml(attrMatch[1].trim()) : undefined;
}

function parseFeedBlocks(xml: string): string[] {
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  if (items.length > 0) return items;
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
}

export class RssAdapter implements CapabilityAdapter {
  readonly id = "rss:native";
  readonly capability = "rss" as const;
  readonly priority = 10;
  readonly operations = ["read"] as const;
  readonly signals = ["news", "reference", "first_party"] as const;

  private readonly fetchFn: FetchLike;
  private readonly now: () => Date;

  constructor(options: RssAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async probe(): Promise<CapabilityProbe> {
    return typeof this.fetchFn === "function"
      ? { status: "ready" }
      : { status: "unavailable", reason: "HTTP fetch is unavailable" };
  }

  async read(request: EvidenceReadRequest): Promise<EvidenceItem[]> {
    const xml = await fetchText(this.fetchFn, request.locator, {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
        "User-Agent": "flyd-evidence-engine",
      },
    });
    if (Buffer.byteLength(xml, "utf8") > MAX_FEED_BYTES) {
      throw new Error("RSS feed exceeds 2MB safety limit");
    }

    const feedTitle = tagValue(xml, ["title"]);
    const blocks = parseFeedBlocks(xml).slice(0, 50);

    return blocks.map((block, index) => {
      const rank = index + 1;
      const title = tagValue(block, ["title"]);
      const link = entryLink(block);
      const guid = tagValue(block, ["guid", "id"]);
      const publishedAt = tagValue(block, ["pubDate", "published", "updated", "dc:date"]);
      const author = tagValue(block, ["author", "dc:creator", "name"]);
      const summary = tagValue(block, ["content:encoded", "content", "description", "summary"]);
      const sourceItemId = guid || link || `${request.locator}#${rank}`;

      return makeEvidenceItem({
        capability: this.capability,
        backend: this.id,
        kind: "news",
        title,
        content: summary || title || "",
        locator: link || request.locator,
        sourceItemId,
        publishedAt,
        author,
        queryLabel: "direct_read",
        nativeRank: rank,
        sourceQuality: 0.78,
        now: this.now(),
        metadata: feedTitle ? { feedTitle, feedUrl: request.locator } : { feedUrl: request.locator },
      });
    }).filter((item) => item.content.length > 0);
  }
}
