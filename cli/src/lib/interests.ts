import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { FLYD_DIR, RAW_DIR, INTERESTS_PATH, INTERESTS_STATE_PATH } from "./config.js";
import { parse } from "./frontmatter.js";
import { isPollutedCapture } from "./brain-state.js";

export interface Interest {
  topic: string;
  keywords: string[];
  priority: "low" | "medium" | "high";
  auto_extracted: boolean;
  first_seen: string;
  last_active: string;
  capture_count: number;
  staleness_days: number;
}

interface InterestStore {
  version: number;
  updated: string;
  global: Interest[];
  projects: Record<string, string[]>;
}

interface ExtractionState {
  lastExtractedAt: string;
  capturesProcessed: number;
  lastLLMClusterAt: string;
}

const MIN_CAPTURES_FOR_INTEREST = 3;

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
  "is","are","was","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","may","might","shall","can","need","dare","ought",
  "used","this","that","these","those","i","you","he","she","it","we","they","me",
  "him","her","us","them","my","your","his","its","our","their","not","no","nor",
  "none","if","then","else","when","where","why","how","which","who","whom","what",
  "about","into","over","after","before","between","under","above","below","up",
  "down","out","off","just","because","than","so","very","too","really","get","got",
  "gotten","make","made","doing","going","say","said","see","know","think","take",
  "come","like","want","use","work","need","feel","try","leave","call","keep","let",
  "begin","show","hear","play","run","move","live","believe","hold","bring","happen",
  "write","give","set","tell","put","ask","find","look","help","also","back","still",
  "even","well","here","there","first","last","much","many","some","any","each",
  "every","all","both","few","more","most","other","such","only","own","same","so",
  "than","too","very","just","about","over","again","further","then","once",
  "project","projects","file","files","code","thing","things","way","part","stuff",
  "lot","bit","kind","sort","type","make","made","makes","making","use","used",
  "uses","using","take","takes","took","taking","go","goes","going","went","gone",
  "come","comes","came","coming","know","knows","knew","known","think","thinks",
  "thought","thinking","see","sees","saw","seen","seeing","want","wants","wanted",
  "wanting","way","ways","something","nothing","everything","anything","someone",
  "everyone","anyone","maybe","perhaps","probably","basically","actually","really",
  "pretty","quite","rather","little","big","small","large","long","short","high",
  "low","good","bad","new","old","great","nice","cool","awesome","amazing","best",
  "worst","better","worse","different","same","other","another","many","much",
  "more","most","few","less","least","some","any","such",
]);

function loadInterests(): InterestStore {
  if (!existsSync(INTERESTS_PATH)) return { version: 1, updated: "", global: [], projects: {} };
  try {
    return JSON.parse(readFileSync(INTERESTS_PATH, "utf8"));
  } catch {
    return { version: 1, updated: "", global: [], projects: {} };
  }
}

function saveInterests(store: InterestStore): void {
  mkdirSync(FLYD_DIR, { recursive: true });
  store.updated = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  writeFileSync(INTERESTS_PATH, JSON.stringify(store, null, 2), "utf8");
}

function loadState(): ExtractionState {
  if (!existsSync(INTERESTS_STATE_PATH)) return { lastExtractedAt: "", capturesProcessed: 0, lastLLMClusterAt: "" };
  try {
    return JSON.parse(readFileSync(INTERESTS_STATE_PATH, "utf8"));
  } catch {
    return { lastExtractedAt: "", capturesProcessed: 0, lastLLMClusterAt: "" };
  }
}

function saveState(state: ExtractionState): void {
  mkdirSync(FLYD_DIR, { recursive: true });
  writeFileSync(INTERESTS_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-zA-Z0-9+#_-]+/).filter(w => {
    if (w.length < 3 || w.length > 30) return false;
    if (STOP_WORDS.has(w)) return false;
    if (/^\d+$/.test(w)) return false;
    return true;
  });
  return words;
}

function getUnprocessedCaptures(state: ExtractionState): Array<{ file: string; timestamp: string; body: string; project: string }> {
  if (!existsSync(RAW_DIR)) return [];

  const files = readdirSync(RAW_DIR).filter(f => f.endsWith(".md")).sort();
  const lastExtractedAt = state.lastExtractedAt ? new Date(state.lastExtractedAt.replace(" ", "T") + "Z").getTime() : 0;

  const results: Array<{ file: string; timestamp: string; body: string; project: string }> = [];

  for (const file of files) {
    try {
      const fullPath = join(RAW_DIR, file);
      const content = readFileSync(fullPath, "utf8");
      const { metadata, body } = parse(content);
      if (isPollutedCapture({ body, metadata })) continue;
      const ts = String(metadata.timestamp ?? "");
      if (!ts) continue;

      const tsMs = new Date(ts.replace(" ", "T") + "Z").getTime();
      if (tsMs <= lastExtractedAt) continue;

      const project = String(metadata.project ?? "unknown");
      const type = String(metadata.type ?? "");
      const source = String(metadata.source ?? "");
      if (type === "synthesis" || source === "synthesis") continue;

      results.push({ file, timestamp: ts, body, project });
    } catch {
      // skip unreadable
    }
  }

  return results;
}

export function extractInterests(): { extracted: number; updated: number } {
  const state = loadState();
  const captures = getUnprocessedCaptures(state);

  if (captures.length === 0) {
    return { extracted: 0, updated: 0 };
  }

  const termDocCount = new Map<string, { count: number; lastFile: string; lastTs: string }>();
  const termProjects = new Map<string, Set<string>>();

  for (const capture of captures) {
    const words = tokenize(capture.body);
    const unique = new Set(words);

    for (const word of unique) {
      const prev = termDocCount.get(word) ?? { count: 0, lastFile: "", lastTs: "" };
      prev.count++;
      if (capture.timestamp > prev.lastTs) {
        prev.lastTs = capture.timestamp;
        prev.lastFile = capture.file;
      }
      termDocCount.set(word, prev);

      if (!termProjects.has(word)) termProjects.set(word, new Set());
      termProjects.get(word)!.add(capture.project);
    }
  }

  const store = loadInterests();
  const existingTopics = new Set(store.global.map(i => i.topic.toLowerCase()));

  let extracted = 0;
  let updated = 0;

  const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  // Update existing interests
  for (const interest of store.global) {
    const topicLower = interest.topic.toLowerCase();
    let matched = false;

    for (const capture of captures) {
      const bodyLower = capture.body.toLowerCase();
      if (bodyLower.includes(topicLower)) {
        if (capture.timestamp > interest.last_active) {
          interest.last_active = capture.timestamp;
        }
        interest.capture_count++;
        matched = true;
      } else {
        for (const kw of interest.keywords) {
          if (bodyLower.includes(kw.toLowerCase())) {
            if (capture.timestamp > interest.last_active) {
              interest.last_active = capture.timestamp;
            }
            interest.capture_count++;
            matched = true;
            break;
          }
        }
      }
    }

    if (matched) updated++;
  }

  // Extract new candidate interests
  const candidates: Array<{ topic: string; count: number; lastTs: string; projects: string[] }> = [];

  for (const [term, info] of termDocCount) {
    if (existingTopics.has(term)) continue;
    // Skip if any existing interest topic is a substring of this term or vice versa
    let isDuplicate = false;
    for (const existing of existingTopics) {
      const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        new RegExp("\\b" + escape(existing) + "\\b", "i").test(term) ||
        new RegExp("\\b" + escape(term) + "\\b", "i").test(existing)
      ) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) continue;

    if (info.count >= MIN_CAPTURES_FOR_INTEREST) {
      candidates.push({
        topic: term,
        count: info.count,
        lastTs: info.lastTs,
        projects: [...(termProjects.get(term) ?? [])],
      });
    }
  }

  // Sort by frequency descending, take top 20
  candidates.sort((a, b) => b.count - a.count);
  const topCandidates = candidates.slice(0, 20);

  for (const c of topCandidates) {
    const interest: Interest = {
      topic: c.topic,
      keywords: [],
      priority: "low",
      auto_extracted: true,
      first_seen: c.lastTs,
      last_active: c.lastTs,
      capture_count: c.count,
      staleness_days: 30,
    };

    // Generate keywords: other frequent terms that co-occur in the same captures
    const coTerms = new Map<string, number>();
    for (const capture of captures) {
      const bodyLower = capture.body.toLowerCase();
      if (!bodyLower.includes(c.topic)) continue;
      const words = new Set(tokenize(capture.body));
      for (const w of words) {
        if (w === c.topic) continue;
        coTerms.set(w, (coTerms.get(w) ?? 0) + 1);
      }
    }
    const sortedCo = [...coTerms.entries()].sort((a, b) => b[1] - a[1]);
    interest.keywords = sortedCo.slice(0, 5).map(([w]) => w);

    store.global.push(interest);
    extracted++;
  }

  // Auto-promote based on capture count
  for (const interest of store.global) {
    if (interest.capture_count >= 25 && interest.priority !== "high") {
      interest.priority = "high";
    } else if (interest.capture_count >= 10 && interest.priority === "low") {
      interest.priority = "medium";
    }
  }

  // Build per-project interest references
  store.projects = {};
  for (const interest of store.global) {
    for (const capture of captures) {
      const bodyLower = capture.body.toLowerCase();
      if (bodyLower.includes(interest.topic.toLowerCase()) ||
          interest.keywords.some(k => bodyLower.includes(k.toLowerCase()))) {
        if (!store.projects[capture.project]) store.projects[capture.project] = [];
        if (!store.projects[capture.project].includes(interest.topic)) {
          store.projects[capture.project].push(interest.topic);
        }
      }
    }
  }

  saveInterests(store);

  // Update extraction state
  const lastTs = captures[captures.length - 1].timestamp;
  state.lastExtractedAt = lastTs;
  state.capturesProcessed += captures.length;
  saveState(state);

  return { extracted, updated };
}

export function getMatchingInterests(text: string, project?: string): Interest[] {
  const store = loadInterests();
  const all: Interest[] = [...store.global];

  if (project && store.projects[project]) {
    const projectTopics = new Set(store.projects[project]);
    const projectInterests = store.global.filter(i => projectTopics.has(i.topic));
    for (const pi of projectInterests) {
      if (!all.some(a => a.topic === pi.topic)) all.push(pi);
    }
  }

  const lower = text.toLowerCase();
  return all.filter(i =>
    lower.includes(i.topic.toLowerCase()) ||
    i.keywords.some(k => lower.includes(k.toLowerCase()))
  );
}

export function getActiveInterests(project?: string): Interest[] {
  const store = loadInterests();
  const topics = project && store.projects[project]
    ? new Set(store.projects[project])
    : null;

  const now = Date.now();
  return store.global.filter(i => {
    if (topics && !topics.has(i.topic)) return false;
    const lastActive = new Date(i.last_active.replace(" ", "T") + "Z").getTime();
    const daysSince = (now - lastActive) / (1000 * 60 * 60 * 24);
    return daysSince <= i.staleness_days;
  });
}

export function getInterestStaleness(): { stale: Interest[]; dormant: Interest[] } {
  const store = loadInterests();
  const now = Date.now();
  const stale: Interest[] = [];
  const dormant: Interest[] = [];

  for (const i of store.global) {
    if (i.capture_count < MIN_CAPTURES_FOR_INTEREST && i.auto_extracted) {
      dormant.push(i);
      continue;
    }
    const lastActive = new Date(i.last_active.replace(" ", "T") + "Z").getTime();
    const daysSince = (now - lastActive) / (1000 * 60 * 60 * 24);
    if (daysSince > i.staleness_days) {
      stale.push(i);
    }
  }

  return { stale, dormant };
}

export function getInterestKeywords(text: string): string {
  const matches = getMatchingInterests(text);
  if (matches.length === 0) return "";

  const keywords = new Set<string>();
  for (const m of matches) {
    if (m.priority === "high" || m.priority === "medium") {
      keywords.add(m.topic);
      for (const kw of m.keywords) keywords.add(kw);
    }
  }

  return [...keywords].join(" ");
}

export function listInterests(project?: string, opts?: { priority?: string; remove?: string }): void {
  const store = loadInterests();

  if (opts?.remove) {
    const topic = opts.remove;
    const idx = store.global.findIndex(i => i.topic.toLowerCase() === topic.toLowerCase());
    if (idx === -1) {
      console.log(`interest "${topic}" not found`);
      return;
    }
    store.global.splice(idx, 1);
    // Rebuild project references
    store.projects = {};
    saveInterests(store);
    console.log(`removed interest "${topic}"`);
    return;
  }

  if (opts?.priority) {
    const match = opts.priority.match(/^(.+)[\s:](low|medium|high)$/);
    if (!match) {
      console.log("usage: flyd interests --priority <topic>:<level> (e.g. 'react:high')");
      return;
    }
    const topic = match[1];
    const level = match[2] as "low" | "medium" | "high";
    const interest = store.global.find(i => i.topic.toLowerCase() === topic.toLowerCase());
    if (!interest) {
      console.log(`interest "${topic}" not found`);
      return;
    }
    interest.priority = level;
    saveInterests(store);
    console.log(`set "${topic}" priority to ${level}`);
    return;
  }

  const now = Date.now();
  const active: Interest[] = [];
  const stale: Interest[] = [];
  const dormant: Interest[] = [];

  let interests = store.global;
  if (project && store.projects[project]) {
    const projectTopics = new Set(store.projects[project]);
    interests = store.global.filter(i => projectTopics.has(i.topic));
  }

  for (const i of interests) {
    if (i.capture_count < MIN_CAPTURES_FOR_INTEREST && i.auto_extracted && i.capture_count === 1) {
      dormant.push(i);
      continue;
    }
    const lastActive = new Date(i.last_active.replace(" ", "T") + "Z").getTime();
    const daysSince = (now - lastActive) / (1000 * 60 * 60 * 24);
    if (daysSince > i.staleness_days) {
      stale.push(i);
    } else {
      active.push(i);
    }
  }

  const title = project ? `interests for project: ${project}` : "interests";
  console.log(`\nflyd ${title}\n`);

  if (active.length > 0) {
    console.log("active:");
    for (const i of active) {
      const daysSince = Math.round((now - new Date(i.last_active.replace(" ", "T") + "Z").getTime()) / (1000 * 60 * 60 * 24));
      console.log(`  ${i.topic.padEnd(20)} ${i.priority.padEnd(6)} ${String(i.capture_count).padStart(3)} captures   last: ${i.last_active} (${daysSince}d ago)`);
    }
    console.log();
  }

  if (stale.length > 0) {
    console.log("stale:");
    for (const i of stale) {
      const daysSince = Math.round((now - new Date(i.last_active.replace(" ", "T") + "Z").getTime()) / (1000 * 60 * 60 * 24));
      const flag = daysSince > 90 ? "⚠️" : "⚡";
      console.log(`  ${i.topic.padEnd(20)} ${i.priority.padEnd(6)} ${String(i.capture_count).padStart(3)} captures   last: ${i.last_active} ${flag} ${daysSince}d ago`);
    }
    console.log();
  }

  if (dormant.length > 0) {
    console.log("dormant (auto-extracted, never confirmed):");
    for (const i of dormant) {
      console.log(`  ${i.topic.padEnd(20)} ${i.priority.padEnd(6)} ${String(i.capture_count).padStart(3)} capture    last: ${i.last_active}`);
    }
    console.log();
  }

  if (active.length === 0 && stale.length === 0 && dormant.length === 0) {
    console.log("  (none yet — run 'flyd consolidate' to extract interests from captures)\n");
  }
}
