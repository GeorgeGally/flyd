import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CapabilityAdapter,
  CapabilityProbe,
  EvidenceItem,
  EvidenceReadRequest,
  EvidenceSearchRequest,
} from "../types.js";
import {
  makeEvidenceItem,
  runCommand,
  type CommandRunner,
} from "./common.js";

interface YoutubeAdapterOptions {
  commandRunner?: CommandRunner;
  now?: () => Date;
}

interface YtEntry {
  id?: string;
  title?: string;
  description?: string;
  channel?: string;
  uploader?: string;
  webpage_url?: string;
  original_url?: string;
  url?: string;
  timestamp?: number;
  release_timestamp?: number;
  upload_date?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  entries?: YtEntry[];
}

function youtubeUrl(entry: YtEntry): string | undefined {
  if (entry.webpage_url) return entry.webpage_url;
  if (entry.original_url?.startsWith("http")) return entry.original_url;
  if (entry.url?.startsWith("http")) return entry.url;
  if (entry.id) return `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`;
  return undefined;
}

function publishedAt(entry: YtEntry): string | undefined {
  const unix = entry.timestamp ?? entry.release_timestamp;
  if (typeof unix === "number" && Number.isFinite(unix)) return new Date(unix * 1000).toISOString();
  if (entry.upload_date && /^\d{8}$/.test(entry.upload_date)) {
    const value = `${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}T00:00:00.000Z`;
    return value;
  }
  return undefined;
}

function metadataSummary(entry: YtEntry): string {
  return [
    entry.description || "",
    entry.channel || entry.uploader ? `Channel: ${entry.channel || entry.uploader}` : "",
    typeof entry.duration === "number" ? `Duration: ${Math.round(entry.duration)} seconds` : "",
    typeof entry.view_count === "number" ? `Views: ${entry.view_count}` : "",
  ].filter(Boolean).join("\n");
}

export function vttToText(vtt: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const rawLine of vtt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || line.includes("-->")) continue;
    if (/^\d+$/.test(line)) continue;
    const clean = line
      .replace(/<\/?c(?:\.[^>]*)?>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    lines.push(clean);
  }

  return lines.join(" ").trim();
}

export class YoutubeYtDlpAdapter implements CapabilityAdapter {
  readonly id = "youtube:yt-dlp";
  readonly capability = "youtube" as const;
  readonly priority = 10;
  readonly operations = ["read", "search"] as const;
  readonly signals = ["video", "discussion", "reference"] as const;

  private readonly commandRunner: CommandRunner;
  private readonly now: () => Date;

  constructor(options: YoutubeAdapterOptions = {}) {
    this.commandRunner = options.commandRunner ?? runCommand;
    this.now = options.now ?? (() => new Date());
  }

  async probe(): Promise<CapabilityProbe> {
    try {
      await this.commandRunner("yt-dlp", ["--version"], { timeoutMs: 4_000 });
      return { status: "ready" };
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : "yt-dlp is unavailable",
        fix: "Install yt-dlp (for example: brew install yt-dlp)",
      };
    }
  }

  async search(request: EvidenceSearchRequest): Promise<EvidenceItem[]> {
    const limit = Math.min(Math.max(request.limit, 1), 20);
    const { stdout } = await this.commandRunner(
      "yt-dlp",
      ["--dump-single-json", "--flat-playlist", "--skip-download", `ytsearch${limit}:${request.query}`],
      { timeoutMs: 20_000 },
    );
    const payload = JSON.parse(stdout) as YtEntry;

    return (payload.entries ?? []).slice(0, limit).map((entry, index) => {
      const rank = index + 1;
      const locator = youtubeUrl(entry);
      return makeEvidenceItem({
        capability: this.capability,
        backend: this.id,
        kind: "video",
        title: entry.title,
        content: metadataSummary(entry) || entry.title || "",
        locator,
        sourceItemId: entry.id || locator || `${request.query}:${rank}`,
        publishedAt: publishedAt(entry),
        author: entry.channel || entry.uploader,
        queryLabel: request.queryLabel,
        nativeRank: rank,
        sourceQuality: 0.82,
        engagement: typeof entry.view_count === "number" ? Math.log10(Math.max(1, entry.view_count)) / 10 : undefined,
        now: this.now(),
        metadata: {
          duration: entry.duration,
          views: entry.view_count,
          likes: entry.like_count,
        },
      });
    }).filter((item) => item.content.length > 0);
  }

  async read(request: EvidenceReadRequest): Promise<EvidenceItem[]> {
    const { stdout } = await this.commandRunner(
      "yt-dlp",
      ["--dump-single-json", "--skip-download", request.locator],
      { timeoutMs: 20_000 },
    );
    const entry = JSON.parse(stdout) as YtEntry;
    const transcript = await this.tryTranscript(request.locator);
    const locator = youtubeUrl(entry) || request.locator;

    return [makeEvidenceItem({
      capability: this.capability,
      backend: this.id,
      kind: "video",
      title: entry.title,
      content: transcript || metadataSummary(entry) || entry.title || "",
      locator,
      sourceItemId: entry.id || locator,
      publishedAt: publishedAt(entry),
      author: entry.channel || entry.uploader,
      queryLabel: "direct_read",
      nativeRank: 1,
      sourceQuality: transcript ? 0.9 : 0.8,
      engagement: typeof entry.view_count === "number" ? Math.log10(Math.max(1, entry.view_count)) / 10 : undefined,
      now: this.now(),
      metadata: {
        transcriptAvailable: Boolean(transcript),
        duration: entry.duration,
        views: entry.view_count,
        likes: entry.like_count,
      },
    })];
  }

  private async tryTranscript(locator: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "flyd-ytdlp-"));
    try {
      await this.commandRunner(
        "yt-dlp",
        [
          "--skip-download",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs",
          "en.*,en",
          "--sub-format",
          "vtt",
          "-o",
          join(directory, "%(id)s.%(ext)s"),
          locator,
        ],
        { timeoutMs: 30_000 },
      );
      const files = (await readdir(directory)).filter((name) => name.endsWith(".vtt")).sort();
      if (files.length === 0) return "";
      const text = await readFile(join(directory, files[0]), "utf8");
      return vttToText(text);
    } catch {
      return "";
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
