// Retrying the exact call that just failed, unchanged, pays to reproduce the
// same failure. One retry covers a flaky network or a slow process; after the
// same call fails the same way twice, the harness stops running it and tells
// the model to change the approach or conclude. The model never has to
// remember this rule: the loop enforces it. Anything that changes the world
// (an edit, a write, a command that mutates) resets the count: after a fix,
// rerunning the same test is the right move.

export const MAX_IDENTICAL_FAILURES = 2;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Failures differ by wording that matters, not by timestamps, pids or durations. */
function errorShape(error: string): string {
  return error.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 240);
}

export interface RepeatGuard {
  /** A reason to skip the call, or null to run it. */
  blocked(name: string, input: Record<string, unknown>): string | null;
  record(name: string, input: Record<string, unknown>, failure: string | null): void;
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
    changed() {
      failures.clear();
    },
  };
}
