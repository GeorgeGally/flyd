import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { FLYD_DIR, getKey } from "./config.js";

/**
 * Flyd's own Claude spend: every direct Anthropic API call is priced from its
 * reported usage and added to this calendar month's total. Past the cap Claude
 * drops out of every model chain until the month turns, so the fallbacks carry
 * on; at 80% George hears about it once.
 */

export const DEFAULT_MONTHLY_CAP_USD = 100;
const WARN_FRACTION = 0.8;

/** USD per million tokens. Cache writes are the 5-minute rate. */
interface Price { input: number; output: number; cacheWrite: number; cacheRead: number }
const PRICES: Array<[RegExp, Price]> = [
  [/^claude-haiku-5/, { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }],
  [/^claude-sonnet-5/, { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }],
  [/^claude-opus-5-5/, { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }],
  [/^claude-haiku-4/, { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
  [/^claude-sonnet-4/, { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
];
/** An unknown Claude model is priced like Opus, so the cap errs on the safe side. */
const UNKNOWN_PRICE: Price = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };

export interface ClaudeUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface SpendLedger {
  month: string;
  usd: number;
  calls: number;
  /** Per job kind (chat, quick, prediction, crew…), so George can see where it went. */
  bySource: Record<string, { usd: number; calls: number }>;
  warned: { near?: string; capped?: string };
}

export interface SpendStatus { month: string; usd: number; cap: number; fraction: number; capped: boolean; calls: number; bySource: SpendLedger["bySource"] }

type Notify = (title: string, message: string) => void;
let notifier: Notify | null = null;

/** Tests and the view swap how a threshold crossing reaches George. */
export function setSpendNotifier(notify: Notify | null): void {
  notifier = notify;
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** The Anthropic key Flyd's own Claude calls use: CLAUDE_API_KEY, else ANTHROPIC_API_KEY. */
export function claudeApiKey(): string | undefined {
  return getKey("CLAUDE_API_KEY")?.trim() || getKey("ANTHROPIC_API_KEY")?.trim() || undefined;
}

/**
 * A user-level key (not scoped to one workspace) must name the workspace on
 * every request; CLAUDE_WORKSPACE_ID (or ANTHROPIC_WORKSPACE_ID) supplies it.
 */
export function claudeHeaders(): Record<string, string> {
  const workspace = getKey("CLAUDE_WORKSPACE_ID")?.trim() || getKey("ANTHROPIC_WORKSPACE_ID")?.trim();
  return workspace ? { "anthropic-workspace-id": workspace } : {};
}

export function monthlyCapUsd(): number {
  const configured = Number(env("FLYD_CLAUDE_MONTHLY_CAP_USD"));
  return Number.isFinite(configured) && configured >= 0 && env("FLYD_CLAUDE_MONTHLY_CAP_USD") !== undefined ? configured : DEFAULT_MONTHLY_CAP_USD;
}

export function spendLedgerPath(): string {
  return env("FLYD_CLAUDE_SPEND_FILE") ?? join(FLYD_DIR, "claude-spend.json");
}

function monthOf(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function emptyLedger(month: string): SpendLedger {
  return { month, usd: 0, calls: 0, bySource: {}, warned: {} };
}

export function readSpendLedger(now = new Date(), path = spendLedgerPath()): SpendLedger {
  const month = monthOf(now);
  try {
    const saved = JSON.parse(readFileSync(path, "utf8")) as Partial<SpendLedger>;
    if (saved.month !== month || typeof saved.usd !== "number" || !Number.isFinite(saved.usd)) return emptyLedger(month);
    return {
      month,
      usd: saved.usd,
      calls: typeof saved.calls === "number" ? saved.calls : 0,
      bySource: saved.bySource && typeof saved.bySource === "object" ? saved.bySource : {},
      warned: saved.warned && typeof saved.warned === "object" ? saved.warned : {},
    };
  } catch {
    return emptyLedger(month);
  }
}

function writeSpendLedger(ledger: SpendLedger, path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    renameSync(temp, path);
  } catch { /* Bookkeeping never breaks a reply. */ }
}

export function priceFor(model: string): Price {
  const id = model.replace(/^anthropic:/i, "").trim();
  return PRICES.find(([pattern]) => pattern.test(id))?.[1] ?? UNKNOWN_PRICE;
}

export function usageCostUsd(model: string, usage: ClaudeUsage): number {
  const price = priceFor(model);
  const count = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
  return (
    count(usage.input_tokens) * price.input
    + count(usage.output_tokens) * price.output
    + count(usage.cache_creation_input_tokens) * price.cacheWrite
    + count(usage.cache_read_input_tokens) * price.cacheRead
  ) / 1_000_000;
}

export function spendStatus(now = new Date(), path = spendLedgerPath()): SpendStatus {
  const ledger = readSpendLedger(now, path);
  const cap = monthlyCapUsd();
  const fraction = cap > 0 ? ledger.usd / cap : 1;
  return { month: ledger.month, usd: ledger.usd, cap, fraction, capped: ledger.usd >= cap, calls: ledger.calls, bySource: ledger.bySource };
}

/** Flyd's Claude calls are on: a key is present, FLYD_CLAUDE isn't 0, and this month is under the cap. */
export function claudeAvailable(now = new Date()): boolean {
  if (env("FLYD_CLAUDE") === "0") return false;
  if (!claudeApiKey()) return false;
  return !spendStatus(now).capped;
}

function dollars(value: number): string {
  return value >= 1 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`;
}

/** The plain words George sees when the month's Claude spend nears or reaches the cap. */
export function spendWarning(status: SpendStatus): string | null {
  if (status.capped) {
    return `Claude spend this month reached the ${dollars(status.cap)} limit, so I've moved to the backup models until the 1st. I'm a little slower and less sharp until then.`;
  }
  if (status.fraction >= WARN_FRACTION) {
    return `Claude spend this month is at ${dollars(status.usd)} of ${dollars(status.cap)}. At ${dollars(status.cap)} I'll switch to the backup models until the 1st.`;
  }
  return null;
}

async function defaultNotify(title: string, message: string): Promise<void> {
  if (process.env.VITEST) return;
  const { notifyMac, recordInbox } = await import("../runtime/agenda.js");
  // The inbox carries it into the next conversation's opening briefing.
  recordInbox({ itemId: "claude-spend", task: "Claude spend", status: "ok", result: message });
  await notifyMac(title, message);
}

/** Price one response's usage and add it to this month's total. Returns its cost in USD. */
export function recordClaudeUsage(model: string, usage: ClaudeUsage | null | undefined, source = "chat", now = new Date(), path = spendLedgerPath()): number {
  if (!usage) return 0;
  const cost = usageCostUsd(model, usage);
  if (cost <= 0) return 0;
  const ledger = readSpendLedger(now, path);
  const cap = monthlyCapUsd();
  const before = ledger.usd;
  ledger.usd += cost;
  ledger.calls += 1;
  const bucket = ledger.bySource[source] ?? { usd: 0, calls: 0 };
  ledger.bySource[source] = { usd: bucket.usd + cost, calls: bucket.calls + 1 };
  // Each threshold is announced once a month, by whichever process crosses it.
  let crossed: "near" | "capped" | null = null;
  if (cap > 0 && before < cap && ledger.usd >= cap && ledger.warned.capped !== ledger.month) crossed = "capped";
  else if (cap > 0 && before < cap * WARN_FRACTION && ledger.usd >= cap * WARN_FRACTION && ledger.warned.near !== ledger.month) crossed = "near";
  if (crossed) ledger.warned[crossed] = ledger.month;
  writeSpendLedger(ledger, path);
  // Opt-in per-call trail (FLYD_CLAUDE_USAGE_LOG=<file>) for measuring cache hits and cost.
  const trail = env("FLYD_CLAUDE_USAGE_LOG");
  if (trail) {
    try { appendFileSync(trail, `${JSON.stringify({ at: now.toISOString(), model, source, usage, usd: cost })}\n`, { mode: 0o600 }); } catch { /* optional */ }
  }
  if (crossed) {
    const message = spendWarning({ month: ledger.month, usd: ledger.usd, cap, fraction: ledger.usd / cap, capped: crossed === "capped", calls: ledger.calls, bySource: ledger.bySource });
    if (message) {
      const notify = notifier ?? ((title: string, body: string) => { void defaultNotify(title, body).catch(() => undefined); });
      try { notify("Flyd", message); } catch { /* a failed notification never breaks a reply */ }
    }
  }
  return cost;
}
