import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { RAW_DIR, WIKI_DIR, CACHE_DIR } from "../lib/config.js";
import { wikiExists, walkWikiFiles, WIKI_FOLDERS } from "../lib/wiki.js";
import { getQueueSize, getQueuedTopics } from "../lib/ingest.js";
import { parse } from "../lib/frontmatter.js";

interface Suggestion {
  id: string;
  type: "new_topic" | "stale" | "interest" | "consolidate" | "retroactive";
  message: string;
  action: string;
  created: string;
  dismissed: boolean;
}

const SUGGESTIONS_PATH = join(CACHE_DIR, "suggestions.json");

function loadSuggestions(): Suggestion[] {
  try {
    if (!existsSync(SUGGESTIONS_PATH)) return [];
    return JSON.parse(readFileSync(SUGGESTIONS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveSuggestions(suggestions: Suggestion[]): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SUGGESTIONS_PATH, JSON.stringify(suggestions, null, 2), "utf8");
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function addSuggestion(type: Suggestion["type"], message: string, action: string): string {
  const suggestions = loadSuggestions();
  const id = generateId();
  suggestions.push({ id, type, message, action, created: new Date().toISOString(), dismissed: false });
  saveSuggestions(suggestions);
  return id;
}

export function getActiveSuggestions(): Suggestion[] {
  return loadSuggestions().filter((s) => !s.dismissed);
}

export function acceptSuggestion(id: string): Suggestion | null {
  const suggestions = loadSuggestions();
  const s = suggestions.find((x) => x.id === id);
  if (s) {
    s.dismissed = true;
    saveSuggestions(suggestions);
  }
  return s ?? null;
}

export function dismissSuggestion(id: string): Suggestion | null {
  const suggestions = loadSuggestions();
  const s = suggestions.find((x) => x.id === id);
  if (s) {
    s.dismissed = true;
    saveSuggestions(suggestions);
  }
  return s ?? null;
}

function countWikiByFolder(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const folder of Object.values(WIKI_FOLDERS)) {
    counts[folder] = 0;
  }
  if (!wikiExists()) return counts;
  for (const file of walkWikiFiles()) {
    const rel = file.replace(WIKI_DIR + "/", "");
    const folder = rel.split("/")[0] || "unknown";
    counts[folder] = (counts[folder] ?? 0) + 1;
  }
  return counts;
}

export function generateSuggestions(): void {
  if (!wikiExists()) return;

  const existing = loadSuggestions().filter((s) => !s.dismissed);
  const existingMsgs = new Set(existing.map((s) => s.message));

  const rawCount = existsSync(RAW_DIR)
    ? readdirSync(RAW_DIR).filter((f) => f.endsWith(".md")).length
    : 0;
  const wikiCount = walkWikiFiles().length;
  const queueSize = getQueueSize();

  if (rawCount > 100 && wikiCount < 5 && queueSize === 0) {
    const msg = `${rawCount} captures, ${wikiCount} wiki pages — run retroactive ingest`;
    if (!existingMsgs.has(msg)) {
      addSuggestion("retroactive", msg, "flyd ingest --all --write");
    }
  }

  for (const { topic, count } of getQueuedTopics()) {
    const msg = `"${topic}" mentioned ${count} times — no wiki page`;
    if (!existingMsgs.has(msg)) {
      addSuggestion("new_topic", msg, `flyd ingest --topic "${topic}" --write`);
    }
  }

  const files = walkWikiFiles();
  const now = Date.now();
  const staleMs = 30 * 24 * 60 * 60 * 1000;

  for (const f of files) {
    try {
      const fPath = f.startsWith(WIKI_DIR) ? f : join(WIKI_DIR, f.replace(WIKI_DIR + "/", ""));
      const st = statSync(fPath);
      if (now - st.mtimeMs > staleMs) {
        const rel = f.replace(WIKI_DIR + "/", "");
        const msg = `${rel} not updated in 30+ days`;
        if (!existingMsgs.has(msg)) {
          addSuggestion("stale", msg, `Review wiki entry: ${rel}`);
        }
      }
    } catch {}
  }
}

export async function runDashboard(): Promise<void> {
  console.log("flyd memory dashboard\n");

  const queueSize = getQueueSize();
  const rawCount = existsSync(RAW_DIR)
    ? readdirSync(RAW_DIR).filter((f) => f.endsWith(".md")).length
    : 0;
  const wikiExistsFlag = wikiExists();
  const wikiCount = wikiExistsFlag ? walkWikiFiles().length : 0;

  console.log("stats:");
  console.log(`  ${rawCount} raw captures (${queueSize} queued for ingest)`);
  console.log(`  ${wikiCount} wiki pages`);
  console.log();

  if (wikiExistsFlag && wikiCount < 5 && rawCount > 100) {
    console.log(`  ★ ${rawCount} captures unprocessed — run 'flyd ingest --all --write'`);
    console.log();
  }

  if (wikiExistsFlag) {
    const byFolder = countWikiByFolder();
    const nonEmpty = Object.entries(byFolder).filter(([, c]) => c > 0);
    if (nonEmpty.length > 0) {
      console.log("wiki pages by folder:");
      for (const [folder, count] of Object.entries(byFolder)) {
        console.log(`  ${folder}: ${count}`);
      }
      console.log();
    }
  }

  const suggestions = getActiveSuggestions();
  if (suggestions.length) {
    console.log("suggestions:");
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      console.log(`  [${i + 1}] ${s.message}`);
      console.log(`      → ${s.action}`);
    }
    console.log(`\n  accept: flyd accept <number> | dismiss: flyd dismiss <number>`);
  } else {
    console.log("no pending suggestions");
  }
}
