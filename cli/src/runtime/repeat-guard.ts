// Retrying the exact call that just failed, unchanged, pays to reproduce the
// same failure. One retry covers a flaky network or a slow process; after the
// same call fails the same way twice, the harness stops running it and tells
// the model to change the approach or conclude. The model never has to
// remember this rule: the loop enforces it. Anything that changes the world
// (an edit, a write, a command that mutates) resets the count: after a fix,
// rerunning the same test is the right move.

export const MAX_IDENTICAL_FAILURES = 2;

/** A session launch that fails the same way this many times is broken, not flaky: a fourth try buys nothing. */
export const MAX_IDENTICAL_LAUNCH_FAILURES = 3;

/** The loop was stopped by the guard: a repeated identical failure no caller may retry. */
export class RepeatedLoopError extends Error {
  readonly attempts: number;
  readonly retryable = false;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "RepeatedLoopError";
    this.attempts = attempts;
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Failures differ by wording that matters, not by timestamps, pids, session ids or durations. */
function errorShape(error: string): string {
  return error.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "#").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 240);
}

export interface RepeatGuard {
  /** A reason to skip the call, or null to run it. */
  blocked(name: string, input: Record<string, unknown>): string | null;
  record(name: string, input: Record<string, unknown>, failure: string | null): void;
  /** Identical failures on record for this call. */
  attempts(name: string, input: Record<string, unknown>): number;
  /** Something changed since those failures; they no longer predict the next run. */
  changed(): void;
}

export function createRepeatGuard(limit = MAX_IDENTICAL_FAILURES): RepeatGuard {
  const failures = new Map<string, { shape: string; count: number; error: string }>();
  return {
    blocked(name, input) {
      const seen = failures.get(`${name}:${stable(input)}`);
      if (!seen || seen.count < limit) return null;
      return `Skipped: this exact ${name} call already failed ${seen.count} times the same way (${seen.error.slice(0, 200)}). Running it again won't change that. Try a different approach, or stop and tell George what's blocking.`;
    },
    record(name, input, failure) {
      const key = `${name}:${stable(input)}`;
      if (failure === null) { failures.delete(key); return; }
      const shape = errorShape(failure);
      const seen = failures.get(key);
      failures.set(key, { shape, error: failure, count: seen?.shape === shape ? seen.count + 1 : 1 });
    },
    attempts(name, input) {
      return failures.get(`${name}:${stable(input)}`)?.count ?? 0;
    },
    changed() {
      failures.clear();
    },
  };
}

/** How long a runtime's repeated launch failure stays cached before one launch may probe it again. */
export const LAUNCH_FAILURE_WINDOW_MS = 60 * 60_000;

/**
 * Session launches keyed by runtime rather than by request: when a runtime
 * keeps failing to start the same way, every request asking it to start will
 * fail that way too. Once one error signature has failed `limit` times within
 * the window, the runtime is refused from the cache, without spawning anything,
 * until a launch on it succeeds or the window lapses. A different error is new
 * information and counts on its own.
 */
export interface LaunchFailureCache {
  /** The cached reason this runtime may not launch now, or null to let it launch. */
  blocked(runtime: string, nowMs?: number): string | null;
  /** A launch outcome on this runtime: its failure output, or null when it started cleanly. */
  record(runtime: string, failure: string | null, nowMs?: number): void;
  clear(): void;
}

export function createLaunchFailureCache(limit = MAX_IDENTICAL_LAUNCH_FAILURES, windowMs = LAUNCH_FAILURE_WINDOW_MS): LaunchFailureCache {
  const failures = new Map<string, Map<string, { count: number; lastAt: number; error: string }>>();
  const blocking = (runtime: string, nowMs: number) => {
    for (const seen of failures.get(runtime)?.values() ?? []) {
      if (seen.count >= limit && nowMs - seen.lastAt < windowMs) return seen;
    }
    return undefined;
  };
  return {
    blocked(runtime, nowMs = Date.now()) {
      const seen = blocking(runtime, nowMs);
      if (!seen) return null;
      return `Starting the work on ${runtime} failed ${seen.count} times the same way (${seen.error.trim().slice(0, 200)}), so I'm not starting it there again until that clears.`;
    },
    record(runtime, failure, nowMs = Date.now()) {
      if (failure === null) { failures.delete(runtime); return; }
      const shape = errorShape(failure);
      const signatures = failures.get(runtime) ?? new Map<string, { count: number; lastAt: number; error: string }>();
      const seen = signatures.get(shape);
      // A probe after the window that fails the same way again goes straight back to the cache.
      const count = seen && (nowMs - seen.lastAt < windowMs || seen.count >= limit) ? seen.count + 1 : 1;
      signatures.set(shape, { count, lastAt: nowMs, error: failure });
      failures.set(runtime, signatures);
    },
    clear() {
      failures.clear();
    },
  };
}
