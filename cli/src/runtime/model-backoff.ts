import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

// When every configured model is out of quota (a 429 / usage limit that got
// past the failover chain), background jobs stop calling models until the
// limit resets, instead of hitting the wall again every five minutes.

const DEFAULT_BACKOFF_MS = 60 * 60 * 1000;
const MIN_BACKOFF_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 7 * 24 * 60 * 60 * 1000;

export interface ModelBackoff { until: string; reason: string; at: string }

export function modelBackoffPath(): string {
  return process.env.FLYD_MODEL_BACKOFF_PATH?.trim() || join(FLYD_DIR, "runtime", "model-backoff.json");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A provider quota/usage-limit refusal, as opposed to a network or server fault. */
export function isUsageLimitError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (status === 429) return true;
  return /\b429\b|usage limit|rate[ _]limit|weekly limit|quota exceeded|insufficient_quota/i.test(errorText(error));
}

function header(error: unknown, name: string): string | undefined {
  const headers = (error as { headers?: unknown })?.headers;
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/** When the limit lifts: the provider's reset time if the error carries one, else an hour. */
export function backoffUntil(error: unknown, now = new Date()): Date {
  const candidates: number[] = [];
  const retryAfter = header(error, "retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    candidates.push(Number.isFinite(seconds) ? now.getTime() + seconds * 1000 : Date.parse(retryAfter));
  }
  const unifiedReset = header(error, "anthropic-ratelimit-unified-reset");
  if (unifiedReset && Number.isFinite(Number(unifiedReset))) candidates.push(Number(unifiedReset) * 1000);
  const resetMatch = errorText(error).match(/resets?\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)/i);
  if (resetMatch) candidates.push(Date.parse(resetMatch[1]!));
  const reset = candidates.find((value) => Number.isFinite(value) && value > now.getTime());
  const ms = reset !== undefined ? reset - now.getTime() : DEFAULT_BACKOFF_MS;
  return new Date(now.getTime() + Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, ms)));
}

/** The active backoff, or null once it has expired. */
export function readModelBackoff(now = new Date(), path = modelBackoffPath()): ModelBackoff | null {
  try {
    const backoff = JSON.parse(readFileSync(path, "utf8")) as ModelBackoff;
    return Date.parse(backoff.until) > now.getTime() ? backoff : null;
  } catch {
    return null;
  }
}

export function recordModelBackoff(error: unknown, now = new Date(), path = modelBackoffPath()): ModelBackoff {
  const backoff: ModelBackoff = { until: backoffUntil(error, now).toISOString(), reason: errorText(error).slice(0, 200), at: now.toISOString() };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(backoff), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return backoff;
}

export class ModelBackoffActive extends Error {
  constructor(readonly backoff: ModelBackoff) {
    super(`models backed off until ${backoff.until}`);
    this.name = "ModelBackoffActive";
  }
}

/**
 * Wrap a model call: refuse at once while backed off, and start the backoff
 * when the call hits a usage limit — even if the job calling it swallows errors.
 */
export function guardModelCall<A extends unknown[], R>(call: (...args: A) => Promise<R>, options: { now?: () => Date; path?: string } = {}): (...args: A) => Promise<R> {
  const now = options.now ?? (() => new Date());
  return async (...args: A) => {
    const active = readModelBackoff(now(), options.path);
    if (active) throw new ModelBackoffActive(active);
    try {
      return await call(...args);
    } catch (error) {
      if (isUsageLimitError(error)) recordModelBackoff(error, now(), options.path);
      throw error;
    }
  };
}
