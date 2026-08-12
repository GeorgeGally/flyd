import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const DB_DIR = join(homedir(), ".flyd");
const DB_PATH = join(DB_DIR, "work-index.sqlite");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root TEXT NOT NULL UNIQUE,
      remote_url TEXT,
      default_branch TEXT,
      last_seen_head TEXT,
      last_indexed_head TEXT,
      last_activity_at TEXT,
      project_file_exists INTEGER NOT NULL DEFAULT 0,
      agents_file_exists INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      occurred_at TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'unknown',
      summary TEXT NOT NULL,
      significance TEXT NOT NULL DEFAULT 'minor',
      commit_refs TEXT NOT NULL DEFAULT '[]',
      file_refs TEXT NOT NULL DEFAULT '[]',
      verified INTEGER NOT NULL DEFAULT 0,
      source_type TEXT NOT NULL DEFAULT 'git',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      ref TEXT NOT NULL,
      detail TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT DEFAULT 'medium',
      source_type TEXT NOT NULL DEFAULT 'project_md',
      source_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_activities_repo ON activities(repository_id);
    CREATE INDEX IF NOT EXISTS idx_activities_occurred ON activities(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_sources_activity ON sources(activity_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
