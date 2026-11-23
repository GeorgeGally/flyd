import { fetchPublicUrl, type HostLookup } from "../../runtime/url-guard.js";
import { makeEvidenceItem, type FetchLike } from "./common.js";
import type { CapabilityAdapter, CapabilityProbe, EvidenceItem, EvidenceReadRequest } from "../types.js";

const MAX_BYTES = 450_000;
const TIMEOUT_MS = 8_000;

export interface PublicPageReaderOptions {
  fetchFn?: FetchLike;
  lookup?: HostLookup;
  now?: () => Date;
}

function decode(value: string): string {
  return value.replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16))))
    .replace(/&#(\d+);/g, (_all, decimal: string) => String.fromCodePoint(Math.min(0x10ffff, Number(decimal))))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, (value) =>
      ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[value.toLowerCase()] ?? " ");
}
function meta(html: string, field: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:name|property)=["']([^"']+)["']/i.exec(tag)?.[1];
    if (key?.toLowerCase() !== field) continue;
    const content = /\bcontent=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decode(content);
  }
  return;
}

export function extractPublicPage(html: string): { title: string; content: string; publishedAt?: string } {
  const head = html.slice(0, 70_000);
  const title = decode(/<title\b[^>]*>([^<]+)<\/title>/i.exec(head)?.[1] ?? meta(head, "og:title") ?? "").replace(/\s+/g, " ").slice(0, 180);
  const description = meta(head, "description") ?? meta(head, "og:description") ?? "";
  const published = meta(head, "article:published_time") ?? meta(head, "date") ?? /"datePublished"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
  const publishedMs = published ? Date.parse(published) : NaN;
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|section|article|main|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const content = decode((description ? description + "\n" : "") + body)
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 18_000);
  return { title, content, ...(Number.isFinite(publishedMs) ? { publishedAt: new Date(publishedMs).toISOString() } : {}) };
}

async function readLimited(response: Response): Promise<string> {
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_BYTES) throw new Error("Public page exceeds 450KB");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BYTES) throw new Error("Public page exceeds 450KB");
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

/** Safe credential-free web.read fallback; never runs JS, logs in, or follows unchecked redirects. */
export class PublicPageReaderAdapter implements CapabilityAdapter {
  readonly id = "web:public-html";
  readonly capability = "web" as const;
  readonly priority = 20;
  readonly operations = ["read"] as const;
  readonly signals = ["reference", "first_party", "news"] as const;
  private readonly fetchFn: FetchLike;
  private readonly lookup?: HostLookup;
  private readonly now: () => Date;
  constructor(options: PublicPageReaderOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.lookup = options.lookup;
    this.now = options.now ?? (() => new Date());
  }
  async probe(): Promise<CapabilityProbe> {
    return typeof this.fetchFn === "function" ? { status: "ready" } : { status: "unavailable" };
  }
  async read(request: EvidenceReadRequest): Promise<EvidenceItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchPublicUrl((input, init) => this.fetchFn(input, init), request.locator, {
        signal: controller.signal,
        ...(this.lookup ? { lookup: this.lookup } : {}),
        headers: { "Accept": "text/html,text/plain;q=0.8", "User-Agent": "Flyd/1.0 (+personal evidence reader)" },
        maxRedirects: 3,
      });
      if (!response.ok) throw new Error("Public page HTTP " + response.status);
      const type = (response.headers.get("content-type") || "").toLowerCase();
      if (type && !/^(text\/html|text\/plain|application\/xhtml\+xml)/.test(type))
        throw new Error("Public page is not HTML/text");
      const raw = await readLimited(response);
      const page = extractPublicPage(raw);
      if (page.content.length < 80) return [];
      return [makeEvidenceItem({
        capability: "web", backend: this.id, kind: "reference",
        title: page.title || undefined, content: page.content,
        locator: response.url?.startsWith("http") ? response.url : request.locator,
        sourceItemId: request.locator,
        publishedAt: page.publishedAt, queryLabel: "direct_read",
        nativeRank: 1, sourceQuality: 0.7, now: this.now(),
      })];
    } finally { clearTimeout(timeout); }
  }
}
