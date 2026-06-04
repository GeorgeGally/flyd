import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { WIKI_DIR, CONTEXT_DIR } from "../lib/config.js";
import { serialize } from "../lib/frontmatter.js";
import { walkWikiFiles, readWikiFile, type MemoryMatch } from "../lib/wiki.js";

const BUNDLE_NAMES = [
  "current_identity",
  "active_projects",
  "current_constraints",
  "recent_history",
  "dormant_context",
] as const;

type BundleName = typeof BUNDLE_NAMES[number];

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
    const status = String(parsed.metadata.status ?? "").toLowerCase();
    if (!parsed.metadata.type) continue;
    if (!ALLOWED_STATUSES.has(status) || EXCLUDED_STATUSES.has(status)) continue;
    matches.push({
      path: file,
      metadata: parsed.metadata,
      body: parsed.body,
      score: scoreMatch(parsed.metadata),
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
    const bucket = bucketFor(match);
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

export function bucketFor(match: MemoryMatch): BundleName | null {
  const { metadata } = match;
  const status = String(metadata.status ?? "").toLowerCase();
  const lifePhase = String(metadata.life_phase ?? "").toLowerCase();
  const timeShape = String(metadata.time_shape ?? "").toLowerCase();
  const memType = String(metadata.type ?? "").toLowerCase();

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
  if (["episodic", "phase-specific"].includes(timeShape)) {
    return "recent_history";
  }
  return "current_identity";
}

export function scoreMatch(metadata: Record<string, unknown>): number {
  const status = String(metadata.status ?? "").toLowerCase();
  const timeShape = String(metadata.time_shape ?? "").toLowerCase();
  const confidence = Number(metadata.confidence ?? 0);
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
