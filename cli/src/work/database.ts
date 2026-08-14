import Database from "better-sqlite3";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdirSync, existsSync } from "fs";

const DB_DIR = join(homedir(), ".flyd");
const DEFAULT_DB_PATH = join(DB_DIR, "work-index.sqlite");

let _db: Database.Database | null = null;
let _dbPath = DEFAULT_DB_PATH;

/** Test-only: point work-index at a temp path and reset the singleton. */
export function useWorkIndexPath(path: string): void {
  closeDb();
  _dbPath = path;
}

export function resetWorkIndexPath(): void {
  closeDb();
  _dbPath = DEFAULT_DB_PATH;
}

export function getDb(): Database.Database {
  if (_db) return _db;

  // ponytail: lazy init is race-safe — better-sqlite3 opens synchronously,
  // so no event-loop turn occurs between the check and the assignment.

  const dir = dirname(_dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  _db = new Database(_dbPath);
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

    CREATE TABLE IF NOT EXISTS work_hypotheses (
      id TEXT PRIMARY KEY,
      hypothesis_text TEXT NOT NULL,
      primary_threads TEXT NOT NULL DEFAULT '[]',
      secondary_threads TEXT NOT NULL DEFAULT '[]',
      objective TEXT,
      confidence TEXT NOT NULL DEFAULT 'low',
      uncertainty TEXT NOT NULL DEFAULT '[]',
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      demotions TEXT NOT NULL DEFAULT '[]',
      revised_at TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      from_cache INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS work_hypothesis_corrections (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT REFERENCES work_hypotheses(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      project_name TEXT,
      project_root TEXT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS confirmed_todos (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_activities_repo ON activities(repository_id);
    CREATE INDEX IF NOT EXISTS idx_activities_occurred ON activities(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_sources_activity ON sources(activity_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_wh_corrections_created ON work_hypothesis_corrections(created_at);
    CREATE INDEX IF NOT EXISTS idx_confirmed_todos_status ON confirmed_todos(status);
  `);

  migrateSchema(_db);

  return _db;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function migrateSchema(db: Database.Database): void {
  if (!columnExists(db, "repositories", "observed_at")) {
    db.exec(`ALTER TABLE repositories ADD COLUMN observed_at TEXT`);
  }
  if (!columnExists(db, "work_hypotheses", "insights")) {
    db.exec(`ALTER TABLE work_hypotheses ADD COLUMN insights TEXT`);
  }
  if (!columnExists(db, "confirmed_todos", "due_at")) {
    db.exec(`ALTER TABLE confirmed_todos ADD COLUMN due_at TEXT`);
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
