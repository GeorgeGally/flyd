import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, relative } from "path";
import { WIKI_DIR, CONTEXT_DIR } from "../lib/config.js";
import { BUNDLE_NAMES, type BundleName } from "../lib/context-bundles.js";
import { serialize } from "../lib/frontmatter.js";
import { walkWikiFiles, readWikiFile, type MemoryMatch } from "../lib/wiki.js";

const EXCLUDED_STATUSES = new Set(["rejected"]);
const DORMANT_STATUSES = new Set(["dormant"]);
const DORMANT_PHASES = new Set(["past", "closed", "previous"]);
// These types represent permanent identity facts; life_phase "past" does not make them dormant.
const PERMANENT_IDENTITY_TYPES = new Set(["education", "skill", "award", "testimonial"]);
const ALLOWED_STATUSES = new Set([
  "canon", "working", "speculative", "episodic", "questioned",
  "dormant", "unresolved", "contradictory",
]);

const STATUS_SCORE: Record<string, number> = {
  canon: 8, working: 5, questioned: 2, speculative: 1,
  episodic: -2, unresolved: -3, contradictory: -4, dormant: -5,
};
const TIME_SHAPE_SCORE: Record<string, number> = {
  stable: 4, current: 4, "phase-specific": 0, episodic: -3,
};

const CONFIDENCE_WORDS: Record<string, number> = { high: 0.9, medium: 0.6, low: 0.3 };

export function normalizeStatus(raw: unknown): string {
  const status = String(raw ?? "").toLowerCase().trim();
  if (ALLOWED_STATUSES.has(status)) return status;
  return "working";
}

export function normalizeConfidence(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.min(1, Math.max(0, raw));
  const text = String(raw ?? "").toLowerCase().trim();
  if (text in CONFIDENCE_WORDS) return CONFIDENCE_WORDS[text];
  const parsed = Number(text);
  if (text && Number.isFinite(parsed)) return Math.min(1, Math.max(0, parsed));
  return 0.5;
}

export async function runCompileContext(): Promise<void> {
  if (!existsSync(WIKI_DIR)) {
    console.log("no wiki directory found — run 'flyd consolidate' to initialize");
    return;
  }

  const files = walkWikiFiles();
  if (!files.length) {
    console.log("wiki is empty — add markdown files to ~/.flyd/wiki/ with frontmatter and run 'flyd consolidate'");
    return;
  }

  const matches: MemoryMatch[] = [];
  for (const file of files) {
    const parsed = readWikiFile(file);
    const rawStatus = String(parsed.metadata.status ?? "").toLowerCase();
    if (!parsed.metadata.type) continue;
    if (EXCLUDED_STATUSES.has(rawStatus)) continue;
    const metadata = {
      ...parsed.metadata,
      status: normalizeStatus(rawStatus),
      confidence: normalizeConfidence(parsed.metadata.confidence),
    };
    matches.push({
      path: relative(WIKI_DIR, file),
      metadata,
      body: parsed.body,
      score: scoreMatch(metadata),
    });
  }

  const buckets: Record<BundleName, MemoryMatch[]> = {
    current_identity: [],
    active_projects: [],
    current_constraints: [],
    recent_history: [],
    dormant_context: [],
  };

  for (const match of matches) {
    const bucket = bucketFor(match, match.path);
    if (bucket) buckets[bucket].push(match);
  }

  mkdirSync(CONTEXT_DIR, { recursive: true });
  const generated = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  for (const name of BUNDLE_NAMES) {
    const selected = buckets[name]
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    const metadata: Record<string, unknown> = {
      generated,
      generator: "flyd.compile-context v1",
      sources: selected.map((m) => m.path),
      read_gated: true,
    };
    const body = bundleBody(name, selected);
    const dest = join(CONTEXT_DIR, `${name}.md`);
    writeFileSync(dest, serialize(metadata, body), "utf8");
    console.log(`  wrote context/${name}.md (${selected.length} items)`);
  }

  console.log("done");
}

// Topical knowledge, not identity — stays reachable via search, never bundled.
const EXCLUDED_FOLDERS = new Set(["topics", "conversations"]);
const FOLDER_BUCKETS: Record<string, BundleName> = {
  projects: "active_projects",
  goals: "active_projects",
  constraints: "current_constraints",
  career: "current_identity",
  education: "current_identity",
  skills: "current_identity",
  awards: "current_identity",
  testimonials: "current_identity",
  people: "current_identity",
  entries: "current_identity",
};

export function bucketFor(match: MemoryMatch, relPath?: string): BundleName | null {
  const { metadata } = match;
  const status = String(metadata.status ?? "").toLowerCase();
  const lifePhase = String(metadata.life_phase ?? "").toLowerCase();
  const timeShape = String(metadata.time_shape ?? "").toLowerCase();
  const memType = String(metadata.type ?? "").toLowerCase();
  const folder = (relPath ?? "").split("/")[0] ?? "";

  if (EXCLUDED_FOLDERS.has(folder)) {
    return null;
  }
  // Root-level wiki files are link indexes (flyd.md, projects.md), not identity facts.
  if (relPath && !relPath.includes("/")) {
    return null;
  }
  if (DORMANT_STATUSES.has(status)) {
    return "dormant_context";
  }
  if (DORMANT_PHASES.has(lifePhase) && !PERMANENT_IDENTITY_TYPES.has(memType)) {
    return "dormant_context";
  }
  if (memType === "project" && ["current", "stable", "phase-specific"].includes(timeShape)) {
    return "active_projects";
  }
  if (memType === "constraint") {
    return "current_constraints";
  }
  if (FOLDER_BUCKETS[folder]) {
    return FOLDER_BUCKETS[folder];
  }
  if (memType === "topic" || memType === "conversation-index") {
    return null;
  }
  if (["episodic", "phase-specific"].includes(timeShape)) {
    return "recent_history";
  }
  return "current_identity";
}

export function scoreMatch(metadata: Record<string, unknown>): number {
  const status = String(metadata.status ?? "").toLowerCase();
  const timeShape = String(metadata.time_shape ?? "").toLowerCase();
  const confidence = normalizeConfidence(metadata.confidence);
  let score = confidence * 10;
  score += STATUS_SCORE[status] ?? 0;
  score += TIME_SHAPE_SCORE[timeShape] ?? 0;
  if (metadata.last_confirmed) score += 1;
  return score;
}

export function bundleBody(name: BundleName, matches: MemoryMatch[]): string {
  const title = name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const lines = [`# ${title}`, "", "Machine-generated context bundle. Do not edit by hand."];

  if (name === "dormant_context") {
    lines.push("", "Dormant / past context is real and vetted, but must not be treated as current.");
  }

  if (!matches.length) {
    lines.push("", "No compiled context.");
    return lines.join("\n") + "\n";
  }

  for (const match of matches) {
    lines.push("", `## ${match.path}`);
    const status = String(match.metadata.status ?? "").toLowerCase();
    const memType = String(match.metadata.type ?? "").toLowerCase();
    if (status === "questioned") {
      const reason = String(match.metadata.questioned_reason ?? "principal review required");
      lines.push(`Caution: questioned — ${reason}`);
    } else if (DORMANT_STATUSES.has(status) || (DORMANT_PHASES.has(String(match.metadata.life_phase ?? "").toLowerCase()) && !PERMANENT_IDENTITY_TYPES.has(memType))) {
      lines.push("Caution: dormant — past context, not current");
    }
    const excerpt = match.body.trim();
    if (excerpt) lines.push(excerpt);
  }

  return lines.join("\n") + "\n";
}
