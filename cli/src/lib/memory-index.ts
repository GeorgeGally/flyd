import Database from "better-sqlite3";
import { createStore } from "@tobilu/qmd";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FLYD_DIR, RAW_DIR } from "./config.js";
import { qmdDbPath } from "./qmd.js";

/** QMD performs its own scan against a temporary SQLite backup, preserving its glob and ignore rules. */
export async function inspectMemoryIndex(options: { dbPath?: string; rawDir?: string } = {}) {
  const dbPath = options.dbPath ?? qmdDbPath();
  const rawDir = options.rawDir ?? RAW_DIR;
  const temp = mkdtempSync(join(tmpdir(), "flyd-index-status-"));
  const copy = join(temp, "index.sqlite");
  try {
    const source = new Database(dbPath, { readonly: true, fileMustExist: true });
    try { await source.backup(copy); } finally { source.close(); }
    const snapshot = new Database(copy);
    try { snapshot.prepare("DELETE FROM documents WHERE collection != ?").run("flyd-raw"); } finally { snapshot.close(); }
    const store = await createStore({ dbPath: copy });
    try {
      const collection = (await store.listCollections()).find((item) => item.name === "flyd-raw");
      if (!collection || resolve(collection.pwd) !== resolve(rawDir)) throw new Error("flyd-raw collection is missing or points to a different directory");
      const status = await store.getStatus();
      const scan = await store.update({ collections: ["flyd-raw"] });
      const failedStages = (["update", "embed"] as const).filter((stage) => existsSync(join(FLYD_DIR, "index-status", `${stage}-failed`)));
      const stale = scan.indexed + scan.updated + scan.removed > 0 || status.needsEmbedding > 0 || (collection.active_count > 0 && !status.hasVectorIndex);
      return { state: failedStages.length ? "failed" as const : stale ? "stale" as const : "ready" as const, failedStages, indexed: collection.active_count, added: scan.indexed, changed: scan.updated, removed: scan.removed, pendingRawEmbeddings: status.needsEmbedding, hasVectorIndex: status.hasVectorIndex };
    } finally { await store.close(); }
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
