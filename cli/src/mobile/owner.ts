import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

function ownerPath(stateDir: string): string { return join(stateDir, "mobile", "owner.sqlite"); }
/** A real OS-backed SQLite writer lock, automatically released after a crash.
 * PID-file stale cleanup would race with a simultaneous second startup. */
export function assertNoMobileOwner(stateDir: string): void {
  const path = ownerPath(stateDir);
  if (!existsSync(path)) return;
  const db = new Database(path);
  try {
    db.pragma("busy_timeout = 0");
    db.exec("BEGIN EXCLUSIVE; ROLLBACK");
  } catch (error) {
    if ((error as { code?: string }).code === "SQLITE_BUSY") throw new Error("Mobile service owns this state directory; stop it before starting desktop Core/view");
    throw error;
  } finally { db.close(); }
}
export function acquireMobileOwner(stateDir: string): () => void {
  mkdirSync(join(stateDir, "mobile"), { recursive: true, mode: 0o700 });
  const db = new Database(ownerPath(stateDir));
  try {
    db.pragma("busy_timeout = 0");
    db.exec("CREATE TABLE IF NOT EXISTS runtime_owner (id INTEGER PRIMARY KEY)");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY") throw new Error("Mobile service already owns this state directory");
    throw error;
  }
  return () => { db.exec("ROLLBACK"); db.close(); };
}

/** Core and the desktop view can coexist as readers, but exclude a mobile
 * canonical owner for their whole lifetime, including asynchronous startup. */
export function acquireDesktopOwner(stateDir: string): () => void {
  mkdirSync(join(stateDir, "mobile"), { recursive: true, mode: 0o700 });
  const db = new Database(ownerPath(stateDir));
  try {
    db.pragma("busy_timeout = 0");
    db.exec("CREATE TABLE IF NOT EXISTS runtime_owner (id INTEGER PRIMARY KEY)");
    db.exec("BEGIN; SELECT * FROM runtime_owner");
  } catch (error) {
    db.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY") throw new Error("Mobile service owns this state directory; stop it before starting desktop Core/view");
    throw error;
  }
  return () => { db.exec("ROLLBACK"); db.close(); };
}
