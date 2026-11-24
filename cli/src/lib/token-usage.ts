import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "./config.js";

/**
 * Tokens per job, per day, on every provider Flyd calls itself: the Anthropic
 * API and the OpenAI-style client (OpenCode Go, OpenAI, OpenRouter,
 * CommandCode). The monthly Claude ledger (claude-spend.ts) holds dollars for
 * the cap; this holds what each source used, so a job that runs too often or
 * sends too much shows up whichever provider served it.
 *
 * Every call is also appended to a per-call trail, on by default at
 * ~/.flyd/claude-usage.jsonl (FLYD_CLAUDE_USAGE_LOG names another file;
 * "0" or "off" turns it off). Neither file holds prompt or reply text.
 */

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface SourceDay { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }

export interface TokenLedger {
  /** Local day (YYYY-MM-DD) → source → totals. */
  days: Record<string, Record<string, SourceDay>>;
}

/** Days of totals kept. */
const DAYS_KEPT = 62;
/** Past this the trail rolls over to `<file>.1`, so it never grows without bound. */
const TRAIL_MAX_BYTES = 50 * 1024 * 1024;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function tokenLedgerPath(): string {
  return env("FLYD_TOKEN_USAGE_FILE") ?? join(FLYD_DIR, "token-usage.json");
}

/** The per-call trail's file, or null when it is turned off. */
export function usageTrailPath(): string | null {
  const configured = env("FLYD_CLAUDE_USAGE_LOG");
  if (configured === "0" || configured?.toLowerCase() === "off") return null;
  return configured ?? join(FLYD_DIR, "claude-usage.jsonl");
}

export function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function readTokenLedger(path = tokenLedgerPath()): TokenLedger {
  try {
    const saved = JSON.parse(readFileSync(path, "utf8")) as Partial<TokenLedger>;
    return { days: saved.days && typeof saved.days === "object" ? saved.days : {} };
  } catch {
    return { days: {} };
  }
}

const count = (value: number | null | undefined): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** Anthropic's usage block as token counts. */
export function anthropicTokens(usage: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | null | undefined): TokenCounts | null {
  if (!usage) return null;
  return { input: count(usage.input_tokens), output: count(usage.output_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens) };
}

/** An OpenAI-style usage block (chat completions or responses) as token counts; cached prompt tokens are counted inside input there. */
export function openAITokens(usage: {
  prompt_tokens?: number | null; completion_tokens?: number | null; input_tokens?: number | null; output_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null; input_tokens_details?: { cached_tokens?: number | null } | null;
} | null | undefined): TokenCounts | null {
  if (!usage) return null;
  const input = count(usage.prompt_tokens ?? usage.input_tokens);
  const output = count(usage.completion_tokens ?? usage.output_tokens);
  const cacheRead = count(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens);
  return { input, output, ...(cacheRead ? { cacheRead } : {}) };
}

export interface TokenUsageRecord {
  /** Which job made the call: chat, quick, card-words, runtime/agenda-tick:taste… */
  source: string;
  /** Provider and model as configured, e.g. "opencode-go:gpt-6-luna". */
  model: string;
  tokens: TokenCounts | null;
  /** The call's price, when Flyd prices it (direct Anthropic calls). */
  usd?: number;
  /** The provider's own usage block, kept in the trail for cache measurements. */
  usage?: unknown;
  now?: Date;
}

/** Adds one call to its source's day and appends it to the per-call trail. Never throws. */
export function recordTokenUsage(record: TokenUsageRecord, path = tokenLedgerPath()): void {
  const { tokens } = record;
  if (!tokens || (!tokens.input && !tokens.output && !tokens.cacheRead && !tokens.cacheWrite)) return;
  const now = record.now ?? new Date();
  const day = localDay(now);
  try {
    const ledger = readTokenLedger(path);
    const sources = ledger.days[day] ?? {};
    const was = sources[record.source] ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    sources[record.source] = {
      calls: was.calls + 1,
      input: was.input + tokens.input,
      output: was.output + tokens.output,
      cacheRead: was.cacheRead + (tokens.cacheRead ?? 0),
      cacheWrite: was.cacheWrite + (tokens.cacheWrite ?? 0),
    };
    ledger.days[day] = sources;
    for (const old of Object.keys(ledger.days).sort().slice(0, -DAYS_KEPT)) delete ledger.days[old];
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    renameSync(temp, path);
  } catch { /* Bookkeeping never breaks a reply. */ }
  const trail = usageTrailPath();
  if (!trail) return;
  try {
    mkdirSync(dirname(trail), { recursive: true, mode: 0o700 });
    try { if (statSync(trail).size > TRAIL_MAX_BYTES) renameSync(trail, `${trail}.1`); } catch { /* not there yet */ }
    appendFileSync(trail, `${JSON.stringify({ at: now.toISOString(), model: record.model, source: record.source, tokens, ...(record.usage !== undefined ? { usage: record.usage } : {}), ...(record.usd !== undefined ? { usd: record.usd } : {}) })}\n`, { mode: 0o600 });
  } catch { /* The trail is diagnostics only. */ }
}
