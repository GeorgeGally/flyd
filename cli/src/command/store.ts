import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { withWorkState } from "../lib/work-state.js";
import { canMove } from "./run-state.js";
import type { DomainMessage, DomainRun } from "./types.js";

export { canMove, cameBack, isAtWork, isFinal, isOpen, isSettled } from "./run-state.js";

// The command store: one JSON file per domain run, written by Core's scheduler
// and by `flyd view` at once. Every write goes through `mutateDomainRun`: under
// the run's own lock file it reads the run as it is now, applies the change,
// bumps `revision` and replaces the file (temp + rename), so no process's
// update is lost to another's. `commitDomainRun` turns a run edited from an
// earlier read into such a change: only the fields it changed are applied.

export function commandDir(): string {
  return process.env.FLYD_COMMAND_DIR?.trim() || join(FLYD_DIR, "command");
}

/** Whether an id can name a run on disk. */
export function isDomainRunId(id: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,160}$/.test(id);
}

function runPath(id: string, dir = commandDir()): string {
  if (!isDomainRunId(id)) throw new Error("Invalid domain run id");
  return join(dir, "runs", `${id}.json`);
}

/** A lock older than this was left by a process that died mid-write and is taken over. Writes hold it for milliseconds. */
export const LOCK_STALE_MS = 10_000;
/** How long a write waits for another's lock: longer than a stale lock lives, so a dead holder never blocks it. */
const LOCK_WAIT_MS = 15_000;
const pauseCell = new Int32Array(new SharedArrayBuffer(4));

/** Runs `work` holding the exclusive lock for one JSON file in the command store (runs, objectives). */
export function withFileLock<T>(path: string, work: () => T): T {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock);
      } catch {
        // Released (or taken over) meanwhile: try again.
      }
      if (Date.now() > deadline) throw new Error(`Domain run ${path} stayed locked`);
      Atomics.wait(pauseCell, 0, 0, 5);
    }
  }
  try {
    return work();
  } finally {
    try { unlinkSync(lock); } catch { /* Already taken over as stale. */ }
  }
}

/** Replaces a JSON file whole (temp + rename); call it holding the file's lock. */
export function writeJsonFile(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

/**
 * The one way a run is written: under its lock, reads it as it is now (null when there is none), applies the
 * change, bumps its revision and replaces the file. A change returning null writes nothing. Returns the run as
 * saved (or as it is, when nothing was written).
 */
export function mutateDomainRun(id: string, change: (current: DomainRun | null) => DomainRun | null, dir = commandDir()): DomainRun | null {
  const path = runPath(id, dir);
  return withFileLock(path, () => {
    const current = readDomainRun(id, dir);
    const next = change(current);
    if (!next) return current;
    if (next.id !== id) throw new Error("A change cannot move a domain run to another id");
    const from = current?.status ?? null;
    // First release: an illegal move is recorded, not refused (command/run-state.ts).
    if (from !== next.status && !canMove(from, next.status)) {
      try {
        recordDomainRunRefusal({ at: new Date().toISOString(), origin: "run-state", reason: "illegal_move", runId: id, from: from ?? "none", to: next.status }, dir);
      } catch {
        // The log is evidence, never a reason to lose the write.
      }
    }
    const sameReply = current?.result?.brief === next.result?.brief && current?.result?.detailedReport === next.result?.detailedReport;
    const kept = sameReply && from === next.status ? current?.result?.workState : undefined;
    const stated = kept && next.result ? { ...next, result: { ...next.result, workState: kept } } : withWorkState(next, !sameReply || from === next.status);
    const saved: DomainRun = { ...stated, revision: (current?.revision ?? 0) + 1 };
    writeJsonFile(path, saved);
    return saved;
  });
}

/** Records a new run; one already on record under its id is kept and returned instead (a replayed dispatch). */
export function createDomainRun(run: DomainRun, dir = commandDir()): { run: DomainRun; created: boolean } {
  let created = false;
  const saved = mutateDomainRun(run.id, (current) => {
    if (current) return null;
    created = true;
    return run;
  }, dir);
  return { run: saved ?? run, created };
}

/** Changes a run on record; null (and nothing written) when there is none. */
export function updateDomainRun(id: string, change: (current: DomainRun) => DomainRun, dir = commandDir()): DomainRun | null {
  let found = false;
  const saved = mutateDomainRun(id, (current) => {
    if (!current) return null;
    found = true;
    return change(current);
  }, dir);
  return found ? saved : null;
}

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** His messages as `after` has them, plus any another process added since `before` was read. */
function mergedMessages(before: DomainRun, after: DomainRun, current: DomainRun): DomainMessage[] | undefined {
  const known = new Set([...(before.messages ?? []), ...(after.messages ?? [])].map((message) => message.id));
  const added = (current.messages ?? []).filter((message) => !known.has(message.id));
  const messages = [...(after.messages ?? []), ...added];
  return messages.length || after.messages ? messages : undefined;
}

/**
 * Saves a run edited from an earlier read (`before` → `after`): only the fields it changed are applied to the
 * run as it is now, so another process's update since that read survives. Messages merge by id.
 */
export function commitDomainRun(before: DomainRun, after: DomainRun, dir = commandDir()): DomainRun {
  const saved = mutateDomainRun(after.id, (current) => {
    if (!current) return after;
    const next: Record<string, unknown> = { ...current };
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (key === "revision") continue;
      const was = (before as unknown as Record<string, unknown>)[key];
      const now = (after as unknown as Record<string, unknown>)[key];
      if (same(was, now)) continue;
      if (key === "messages") {
        const messages = mergedMessages(before, after, current);
        if (messages) next.messages = messages;
        else delete next.messages;
      } else if (now === undefined) delete next[key];
      else next[key] = now;
    }
    return next as unknown as DomainRun;
  }, dir);
  return saved ?? after;
}

/** Replaces a run whole (fixtures and tests); live code changes runs with update/commit so concurrent writes survive. */
export function saveDomainRun(run: DomainRun, dir = commandDir()): void {
  mutateDomainRun(run.id, () => run, dir);
}

export function recordDomainRunRefusal(refusal: { at: string; origin: string; reason: string; projectRoot?: string; runId?: string; from?: string; to?: string }, dir = commandDir()): void {
  const path = join(dir, "refusals.jsonl");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `${JSON.stringify(refusal)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function readDomainRun(id: string, dir = commandDir()): DomainRun | null {
  try {
    return JSON.parse(readFileSync(runPath(id, dir), "utf8")) as DomainRun;
  } catch {
    return null;
  }
}

export function listDomainRuns(dir = commandDir()): DomainRun[] {
  const path = join(dir, "runs");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try {
        return [JSON.parse(readFileSync(join(path, name), "utf8")) as DomainRun];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
