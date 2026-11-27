import Database from "better-sqlite3";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryPaths } from "./memory-store.js";

interface Write { path: string; before: string | null; after: string }
interface Journal { version: 1; writes: Write[] }

/** Missing differs from an empty file: recovery must not erase someone else's work. */
export function memoryFile(path: string): string | null {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Memory transaction refuses a symlink: ${path}`);
    return readFileSync(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function durableReplace(path: string, value: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.flyd-memory-${randomUUID()}.tmp`);
  const fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, value, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temp, path); } catch (error) { try { unlinkSync(temp); } catch { /* keep the original error */ } throw error; }
  syncDirectory(dir);
}

function syncDirectory(dir: string): void {
  const fd = openSync(dir, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function validTarget(path: string, paths: MemoryPaths): boolean {
  const target = resolve(path);
  if ([paths.memory, paths.archive, paths.sources].some((known) => resolve(known) === target)) return true;
  return dirname(target) === resolve(paths.dailyDir) && /^\d{4}-\d{2}-\d{2}\.md$/.test(basename(target));
}

function parseJournal(raw: string, paths: MemoryPaths): Journal {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("writes" in value) || !Array.isArray(value.writes)) throw new Error("Invalid memory transaction journal");
  const writes: Write[] = [];
  const seen = new Set<string>();
  for (const entry of value.writes) {
    if (!entry || typeof entry !== "object" || !("path" in entry) || typeof entry.path !== "string" || !("before" in entry) || (entry.before !== null && typeof entry.before !== "string") || !("after" in entry) || typeof entry.after !== "string" || !validTarget(entry.path, paths) || seen.has(resolve(entry.path))) throw new Error("Invalid memory transaction target");
    seen.add(resolve(entry.path));
    writes.push({ path: entry.path, before: entry.before, after: entry.after });
  }
  return { version: 1, writes };
}

function recover(journalPath: string, paths: MemoryPaths): void {
  if (!existsSync(journalPath)) return;
  const journal = parseJournal(readFileSync(journalPath, "utf8"), paths);
  // Check the whole transaction before writing anything: an outside edit requires human reconciliation.
  for (const write of journal.writes) {
    const current = memoryFile(write.path);
    if (current !== write.before && current !== write.after) throw new Error(`Memory transaction conflicts with an outside edit: ${write.path}`);
  }
  for (const write of journal.writes) {
    const current = memoryFile(write.path);
    if (current !== write.before && current !== write.after) throw new Error(`Memory transaction conflicts with an outside edit: ${write.path}`);
    if (current !== write.after) durableReplace(write.path, write.after);
  }
  unlinkSync(journalPath);
  syncDirectory(dirname(journalPath));
}

/**
 * Serializes upgraded writers and rolls an interrupted write forward. A running older Core,
 * third-party writer, or manual editor does not take this lock: exclude them before migration
 * or correction. Readers can observe an in-progress multi-file write until recovery completes.
 */
export function withMemoryTransaction<T>(paths: MemoryPaths, run: (commit: (writes: Write[]) => void) => T): T {
  const dir = dirname(paths.memory);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const database = new Database(join(dir, ".memory-writer-lock.sqlite3"), { timeout: 5000 });
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const journalPath = join(dir, ".memory-transaction.json");
      recover(journalPath, paths);
      let committed = false;
      const value = run((writes) => {
        if (committed) throw new Error("Memory transaction has already committed");
        committed = true;
        const changed = writes.filter((write) => write.before !== write.after);
        const journal: Journal = { version: 1, writes: changed };
        parseJournal(JSON.stringify(journal), paths);
        for (const write of changed) if (memoryFile(write.path) !== write.before) throw new Error(`Memory file changed during transaction: ${write.path}`);
        if (changed.length) {
          durableReplace(journalPath, JSON.stringify(journal));
          recover(journalPath, paths);
        }
      });
      database.exec("COMMIT");
      return value;
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* preserve the write failure */ }
      throw error;
    }
  } finally { database.close(); }
}
