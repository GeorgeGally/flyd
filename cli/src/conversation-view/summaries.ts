import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Plain-English summaries of the assistant's replies, so the captain can read
// the outcome first and open the full reply only when he wants it.
//
// A reply can carry its own summary: its leading lines that start with "» "
// (up to about three sentences). Any other long reply gets one to three
// sentences from a cheap model (xAI Grok, then Claude Haiku), cached on disk
// and asked for at most once per reply. FLYD_SUMMARY_ALWAYS=1 also asks the
// model for replies that carry their own summary, to compare the two.
// PRIVACY: this sends the reply text to that provider. FLYD_VIEW_SUMMARIES=0
// turns model summaries off; "» " summaries never leave the machine.

export const SUMMARY_PROMPT =
  "You translate an engineering assistant's message for a non-technical boss. " +
  "Summarise it in one to three short plain-English sentences: outcome first, no jargon, no file names, code or tool names. " +
  "Reply with the summary only.";

/** Replies shorter than this are already a summary; they show in full. */
export const SUMMARY_MIN_CHARS = 240;
const MAX_INPUT_CHARS = 8_000;
const TIMEOUT_MS = 15_000;
const MAX_IN_FLIGHT = 2;

export type SummarySource = "author" | "model" | "first-sentence";

/** The reply's own summary (its leading "» " lines, joined) and the rest of the reply. */
export function authorSummary(text: string): { summary: string; rest: string } | null {
  const lines = text.trimStart().split("\n");
  let count = 0;
  while (count < lines.length && /^»\s+\S/.test(lines[count]!)) count += 1;
  if (count === 0) return null;
  return {
    summary: lines.slice(0, count).map((line) => line.replace(/^»\s+/, "").trim()).join(" "),
    rest: lines.slice(count).join("\n").trim(),
  };
}

/** First sentence of a reply's prose, stripped of Markdown, as a last resort. */
export function firstSentence(text: string): string {
  const prose = text
    .split("\n")
    .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)/, ""))
    .filter((line) => line.trim() && !line.trim().startsWith("|") && !line.trim().startsWith("```"))
    .join(" ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(prose)?.[1] ?? prose;
  return sentence.length > 220 ? `${sentence.slice(0, 217).trimEnd()}…` : sentence;
}

export interface SummaryProvider {
  name: string;
  summarize(text: string, signal: AbortSignal): Promise<string>;
}

type FetchFn = typeof fetch;

function oneSentence(raw: unknown): string {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text) throw new Error("empty summary");
  return text;
}

export function xaiProvider(apiKey: string, model: string, fetchFn: FetchFn = fetch): SummaryProvider {
  return {
    name: `xai:${model}`,
    async summarize(text, signal) {
      const response = await fetchFn("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          max_tokens: 160,
          temperature: 0.2,
          messages: [{ role: "system", content: SUMMARY_PROMPT }, { role: "user", content: text }],
        }),
      });
      if (!response.ok) throw new Error(`xAI ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      return oneSentence(body.choices?.[0]?.message?.content);
    },
  };
}

export function anthropicProvider(apiKey: string, model: string, fetchFn: FetchFn = fetch): SummaryProvider {
  return {
    name: `anthropic:${model}`,
    async summarize(text, signal) {
      const response = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 160, system: SUMMARY_PROMPT, messages: [{ role: "user", content: text }] }),
      });
      if (!response.ok) throw new Error(`Anthropic ${response.status}`);
      const body = (await response.json()) as { content?: Array<{ type?: string; text?: unknown }> };
      return oneSentence(body.content?.find((block) => block.type === "text")?.text);
    },
  };
}

/** xAI key: XAI_API_KEY, else the grok CLI's stored key (~/.grok/user-settings.json). */
export function findXaiKey(env: NodeJS.ProcessEnv = process.env, home = homedir()): string | undefined {
  if (env.XAI_API_KEY?.trim()) return env.XAI_API_KEY.trim();
  const settings = join(home, ".grok", "user-settings.json");
  if (!existsSync(settings)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(settings, "utf8")) as { apiKey?: unknown };
    return typeof parsed.apiKey === "string" && parsed.apiKey.trim() ? parsed.apiKey.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The providers to try, in order, from whatever keys this machine has. */
export function defaultProviders(options: { env?: NodeJS.ProcessEnv; home?: string; anthropicKey?: string; fetchFn?: FetchFn } = {}): SummaryProvider[] {
  const env = options.env ?? process.env;
  if (env.FLYD_VIEW_SUMMARIES === "0") return [];
  const providers: SummaryProvider[] = [];
  const xai = findXaiKey(env, options.home);
  if (xai) providers.push(xaiProvider(xai, env.FLYD_VIEW_XAI_MODEL?.trim() || "grok-4-fast-non-reasoning", options.fetchFn));
  const anthropic = env.ANTHROPIC_API_KEY?.trim() || options.anthropicKey?.trim();
  if (anthropic) providers.push(anthropicProvider(anthropic, env.FLYD_VIEW_ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001", options.fetchFn));
  return providers;
}

export function defaultSummaryCache(): string {
  return join(homedir(), ".flyd", "view", "summaries.json");
}

interface CacheEntry {
  summary: string;
  provider: string;
  at: string;
}

/**
 * Model summaries keyed by a hash of the reply text: asked for at most once
 * per reply (failures are not retried within a process), a couple at a
 * time, and kept on disk across restarts.
 */
export class ReplySummarizer {
  private readonly cache: Record<string, CacheEntry>;
  private readonly inFlight = new Map<string, Promise<string | undefined>>();
  private readonly failed = new Set<string>();
  private readonly queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly options: { providers: SummaryProvider[]; cacheFile: string }) {
    this.cache = this.load();
  }

  get enabled(): boolean {
    return this.options.providers.length > 0;
  }

  private load(): Record<string, CacheEntry> {
    try {
      return JSON.parse(readFileSync(this.options.cacheFile, "utf8")) as Record<string, CacheEntry>;
    } catch {
      return {};
    }
  }

  private save(): void {
    mkdirSync(dirname(this.options.cacheFile), { recursive: true });
    const tmp = `${this.options.cacheFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cache), { mode: 0o600 });
    renameSync(tmp, this.options.cacheFile);
  }

  static key(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 32);
  }

  cached(text: string): string | undefined {
    return this.cache[ReplySummarizer.key(text)]?.summary;
  }

  /** Whether a call for this reply is still worth making. */
  wants(text: string): boolean {
    const key = ReplySummarizer.key(text);
    return this.enabled && !this.cache[key] && !this.failed.has(key) && !this.inFlight.has(key);
  }

  /** A call for this reply is under way. */
  pending(text: string): boolean {
    return this.inFlight.has(ReplySummarizer.key(text));
  }

  /** Resolves with the summary, or undefined when every provider failed. Never rejects. */
  request(text: string): Promise<string | undefined> {
    const key = ReplySummarizer.key(text);
    if (this.cache[key]) return Promise.resolve(this.cache[key].summary);
    if (!this.enabled || this.failed.has(key)) return Promise.resolve(undefined);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const job = this.slot().then(async (release) => {
      try {
        const input = text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}\n…` : text;
        for (const provider of this.options.providers) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          try {
            const summary = await provider.summarize(input, controller.signal);
            this.cache[key] = { summary, provider: provider.name, at: new Date().toISOString() };
            this.save();
            return summary;
          } catch {
            // Try the next provider.
          } finally {
            clearTimeout(timer);
          }
        }
        this.failed.add(key);
        return undefined;
      } finally {
        this.inFlight.delete(key);
        release();
      }
    });
    this.inFlight.set(key, job);
    return job;
  }

  private slot(): Promise<() => void> {
    return new Promise((resolve) => {
      const start = () => {
        this.running += 1;
        resolve(() => {
          this.running -= 1;
          this.queue.shift()?.();
        });
      };
      if (this.running < MAX_IN_FLIGHT) start();
      else this.queue.push(start);
    });
  }
}
