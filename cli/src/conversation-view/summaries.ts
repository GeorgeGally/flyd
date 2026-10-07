import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Plain-English summaries of the assistant's replies, so the captain can read
// the outcome first and open the full reply only when he wants it.
//
// A summary keeps every outcome, decision and ask in the reply, shorter; it
// never keeps just the opening line. Routine chatter (an acknowledgement, a
// status ping, "nothing changed") is marked routine so the view can mute it
// and the island can stay quiet.
//
// A reply can carry its own summary: its leading lines that start with "» "
// (up to about three sentences). Any other long reply gets a short summary
// from a cheap model (xAI Grok, then Claude Haiku), cached on disk and asked
// for at most once per reply; until then, and without a provider,
// digestReply() builds one locally from the reply's lead sentence and every
// point or paragraph it reports. FLYD_SUMMARY_ALWAYS=1 also asks the model for
// replies that carry their own summary, to compare the two.
// PRIVACY: this sends the reply text to that provider. FLYD_VIEW_SUMMARIES=0
// turns model summaries off; "» " summaries never leave the machine.

/** What a model answers for a reply with no outcome, decision or ask. */
export const ROUTINE = "ROUTINE";

/** Whether a model's answer is ROUTINE, however it dressed it ("ROUTINE.", "**Routine**"). */
export function isRoutineAnswer(text: string): boolean {
  return text.replace(/[^a-z]/gi, "").toUpperCase() === ROUTINE;
}

export const SUMMARY_PROMPT =
  "You condense an engineering assistant's report for its boss, who reads it at a glance. " +
  "Keep every outcome (what changed, what was found), every decision taken and every question or ask for the boss: none may be dropped. " +
  "Lead with the overall result in a few words, then one short plain-English line per item as a Markdown list when there is more than one. " +
  "No jargon, file names, code or tool names; drop process narration, greetings and sign-offs. " +
  `If the message has no outcome, decision or ask (an acknowledgement, a status ping, "nothing changed", "still waiting"), reply exactly ${ROUTINE}. ` +
  "Reply with the summary only.";
/** Bumped when SUMMARY_PROMPT changes, so cached summaries from an older prompt are asked again. */
const PROMPT_VERSION = "2";

/** Replies shorter than this are already a summary; they show in full. */
export const SUMMARY_MIN_CHARS = 240;
const MAX_INPUT_CHARS = 8_000;
const TIMEOUT_MS = 15_000;
const MAX_IN_FLIGHT = 2;

export type SummarySource = "author" | "model" | "digest";

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

const SALUTATION = /^(?:captain|george|boss)\s*[,!:—-]\s*/i;
/** Opening words that only acknowledge; the reply's substance is in the next sentence. */
const ACK_LEAD = /^(?:agreed|aye(?: aye)?|yes|done|right|ok(?:ay)?|sure|well spotted|good (?:call|catch|spot)|understood|noted|got it|shipshape)[.!]?$/i;
/** A whole reply that carries no outcome, decision or ask. */
const ROUTINE_REPLY = /^(?:shipshape|aye(?: aye)?|agreed|noted|understood|got it|on it|will do|ok(?:ay)?|thanks?(?: you)?|standing by|all (?:quiet|good|clear|calm)|no change|nothing (?:new|changed|has changed|to report|needs you)|still (?:working|running|waiting|on it)|waiting (?:on|for)|no news)\b/i;
const ROUTINE_MAX_CHARS = 160;

function inline(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentences end at . ! or ? followed by a capital, a digit or an opening quote; "network." instead… does not. */
function sentences(prose: string): string[] {
  return prose.split(/(?<=[.!?]["”')\]]*)\s+(?=[A-Z0-9"“])/).map((part) => part.trim()).filter(Boolean);
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), limit - 20)).trimEnd()}…`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Text without code blocks or the opening salutation ("Captain, …"). */
function bodyOf(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").trim().replace(SALUTATION, "");
}

export interface ReplyPoint {
  /** The item's bold lead-in ("Why CapFive cards"), when it has one. */
  label?: string;
  /** The item's first sentence. */
  text: string;
}

export interface ReplyDigest {
  /** No outcome, decision or ask: an acknowledgement, a status ping, "nothing changed". */
  routine: boolean;
  /** The overall result, one sentence, salutation and bare acknowledgements dropped. */
  lead: string;
  /** Every top-level numbered or bulleted item of the reply, else the lead of every later paragraph, shortened. */
  points: ReplyPoint[];
}

/**
 * An imperative addressed to the captain, at the start of a sentence, line or
 * numbered step: "Add these…", "Set each to 301", "2. Paste it into…".
 */
const ACT_ON = /(?:^\s*(?:\d+[.)]\s+|[-*+]\s+)?|[.!?:]\s+)(?:(?:captain|george|boss),\s+)?(?:(?:please|now|then|next),?\s+)?(?:add|paste|run|set|enter|copy|put|type|replace|clear)\s+(?:these|this|that|each|them|the following|it|rule|all)\b/im;

/**
 * Whether the reply hands the captain something to act on: a code block, a
 * table, or an instruction to him to paste, add, run or set what it contains.
 * Such a reply opens with its body shown under the summary; the deliverable
 * is the point.
 */
export function isActionable(text: string): boolean {
  if (/^\s*```/m.test(text)) return true;
  if (/^\s*\|.*\|\s*\n\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/m.test(text)) return true;
  return ACT_ON.test(text.replace(/`[^`]*`/g, ""));
}

/** Whether a reply is routine chatter: short, with no question or numbered report. */
export function isRoutine(text: string): boolean {
  const body = bodyOf(text);
  if (body.length > ROUTINE_MAX_CHARS || /\?/.test(body) || /^\s*(?:\d+[.)]|[-*+])\s/m.test(body)) return false;
  return ROUTINE_REPLY.test(body);
}

/** The top-level list items of a reply, each as its bold label and first sentence. */
function pointsOf(body: string): ReplyPoint[] {
  const lines = body.split("\n");
  const points: ReplyPoint[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const item = /^(?:\d+[.)]|[-*+])\s+(.*)$/.exec(lines[index]!);
    if (!item) continue;
    let rest = item[1]!;
    let label: string | undefined;
    const bold = /^\*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(rest);
    if (bold) {
      label = inline(bold[1]!).replace(/[:.]+$/, "").trim();
      rest = bold[2]!;
    }
    // An item whose own line is only a label speaks through its first sub-item.
    if (!inline(rest)) {
      const sub = lines.slice(index + 1).find((line) => line.trim());
      const nested = sub && /^\s+(?:\d+[.)]|[-*+])\s+(.*)$/.exec(sub);
      if (nested) rest = nested[1]!;
    }
    const first = sentences(inline(rest))[0] ?? "";
    if (!label && !first) continue;
    points.push({ ...(label ? { label } : {}), text: clip(first, 140) });
  }
  return points.length >= 2 ? points : [];
}

/** The first sentence of every prose paragraph after the first. */
function paragraphPoints(paragraphs: string[]): ReplyPoint[] {
  return paragraphs.slice(1).flatMap((paragraph) => {
    const first = sentences(inline(paragraph))[0];
    return first ? [{ text: clip(first, 140) }] : [];
  });
}

/**
 * A local summary of a reply, without a model: whether it is routine, its
 * lead sentence, and every numbered or bulleted point it reports.
 */
export function digestReply(text: string): ReplyDigest {
  const body = bodyOf(text);
  const paragraphs = body.split(/\n\s*\n/).filter((block) => block.trim() && !/^\s*(?:\d+[.)]|[-*+]|#|\|)/.test(block));
  const opening = sentences(inline(paragraphs[0] ?? ""));
  while (opening.length > 1 && ACK_LEAD.test(opening[0]!)) opening.shift();
  const lead = capitalise(clip(opening[0] ?? firstSentence(body), 220));
  const points = pointsOf(body);
  return { routine: isRoutine(text), lead, points: points.length ? points : paragraphPoints(paragraphs) };
}

/** The digest as Markdown: the lead, then one line per point. */
export function digestMarkdown(digest: ReplyDigest): string {
  if (digest.points.length === 0) return digest.lead;
  const escape = (text: string) => text.replace(/([*_`[\]])/g, "\\$1");
  return [
    digest.lead,
    "",
    ...digest.points.map((point) => `- ${point.label ? `**${escape(point.label)}${/[?!]$/.test(point.label) ? "" : ":"}** ` : ""}${escape(point.text)}`),
  ].join("\n");
}

export interface SummaryProvider {
  name: string;
  summarize(text: string, signal: AbortSignal): Promise<string>;
}

type FetchFn = typeof fetch;

/** The model's summary, tidied: lists keep their lines, everything else collapses. */
function tidySummary(raw: unknown): string {
  const text = typeof raw === "string"
    ? raw.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim()
    : "";
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
          max_tokens: 320,
          temperature: 0.2,
          messages: [{ role: "system", content: SUMMARY_PROMPT }, { role: "user", content: text }],
        }),
      });
      if (!response.ok) throw new Error(`xAI ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      return tidySummary(body.choices?.[0]?.message?.content);
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
        body: JSON.stringify({ model, max_tokens: 320, system: SUMMARY_PROMPT, messages: [{ role: "user", content: text }] }),
      });
      if (!response.ok) throw new Error(`Anthropic ${response.status}`);
      const body = (await response.json()) as { content?: Array<{ type?: string; text?: unknown }> };
      return tidySummary(body.content?.find((block) => block.type === "text")?.text);
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
    return createHash("sha256").update(`${PROMPT_VERSION}\0${text}`).digest("hex").slice(0, 32);
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
