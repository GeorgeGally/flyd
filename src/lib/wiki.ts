import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "fs";
import { join, dirname } from "path";
import { createHash, randomUUID } from "crypto";
import { WIKI_DIR, defaultModel } from "./config.js";
import { parse, serialize, type ParsedMarkdown } from "./frontmatter.js";
import { query } from "./llm.js";

export const WIKI_FOLDERS: Record<string, string> = {
  skill: "skills",
  education: "education",
  career: "career",
  award: "awards",
  testimonial: "testimonials",
  project: "projects",
  person: "people",
  constraint: "constraints",
  topic: "topics",
  flyd: "flyd",
};

export interface MemoryMatch {
  path: string;
  metadata: Record<string, unknown>;
  body: string;
  score: number;
}

export function readWikiFile(path: string): ParsedMarkdown {
  return parse(readFileSync(path, "utf8"));
}

export function walkWikiFiles(): string[] {
  if (!existsSync(WIKI_DIR)) return [];
  const results: string[] = [];
  const stack = [WIKI_DIR];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "meta") stack.push(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name !== "rejected.md" &&
        entry.name !== "index.md" &&
        entry.name !== "log.md" &&
        entry.name !== "schema.md"
      ) {
        results.push(full);
      }
    }
  }
  return results.sort();
}

export function wikiExists(): boolean {
  return existsSync(join(WIKI_DIR, "index.md"));
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function writeWikiPage(path: string, content: string): void {
  const fullPath = join(WIKI_DIR, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  const tmpPath = fullPath + ".tmp." + randomUUID().slice(0, 8);
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, fullPath);
}

export function appendLog(entry: { type: string; title: string; body?: string; affected?: string[] }): void {
  if (!wikiExists()) return;
  const logPath = join(WIKI_DIR, "log.md");
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const lines = [`## [${ts}] ${entry.type} | ${entry.title}`];
  if (entry.body) lines.push(entry.body);
  if (entry.affected?.length) lines.push(`affected: ${entry.affected.join(", ")}`);
  lines.push("");
  const existing = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  writeFileSync(logPath, existing + lines.join("\n"), "utf8");
}

export function createTopicPage(opts: {
  slug: string;
  title: string;
  body: string;
  tags: string[];
  source: string;
  confidence: string;
}): string {
  const ts = new Date().toISOString().split("T")[0];
  return serialize(
    {
      type: "topic",
      source: opts.source,
      confidence: opts.confidence,
      tags: opts.tags,
      aliases: [opts.title.toLowerCase()],
      created: ts,
      updated: ts,
    },
    `# ${opts.title}\n\n${opts.body}`
  );
}

interface IndexCache {
  [path: string]: { hash: string; summary: string };
}

export async function generateIndex(): Promise<string> {
  if (!wikiExists()) {
    return "wiki is empty — run `flyd wiki init` or `flyd consolidate` to initialize.";
  }

  const files = walkWikiFiles();
  if (!files.length) {
    return "wiki has no pages yet — use `flyd ingest <source>` to add knowledge.";
  }

  const cachePath = join(WIKI_DIR, "meta", "index-cache.json");
  let cache: IndexCache = {};
  try {
    if (existsSync(cachePath)) cache = JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {}

  const byType: Record<string, Array<{ rel: string; summary: string; updated: string }>> = {};

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const h = hashContent(content);
    const rel = file.replace(WIKI_DIR + "/", "");
    const parsed = parse(content);
    const folder = rel.split("/")[0] || "unknown";
    const updated = String(parsed.metadata.updated ?? parsed.metadata.created ?? "");

    if (cache[rel]?.hash === h) {
      if (!byType[folder]) byType[folder] = [];
      byType[folder].push({ rel, summary: cache[rel].summary, updated });
      continue;
    }

    const bodyExcerpt = parsed.body.slice(0, 500);
    let summary = "";
    try {
      const prompt = `Summarize this wiki page in one sentence (under 120 chars):\n\n${bodyExcerpt}`;
      summary = await query(prompt, defaultModel());
      summary = summary.replace(/^["']|["']$/g, "").trim();
      if (summary.length > 150) summary = summary.slice(0, 147) + "...";
    } catch {
      summary = bodyExcerpt.replace(/\n/g, " ").slice(0, 120);
    }

    cache[rel] = { hash: h, summary };

    if (!byType[folder]) byType[folder] = [];
    byType[folder].push({ rel, summary, updated });
  }

  mkdirSync(join(WIKI_DIR, "meta"), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");

  const lines = ["# Wiki Index", `Generated: ${new Date().toISOString().split("T")[0]}`, ""];
  for (const [folder, pages] of Object.entries(byType).sort()) {
    if (!pages.length) continue;
    lines.push(`## ${folder} (${pages.length})`);
    for (const p of pages) {
      const date = p.updated ? ` (${p.updated})` : "";
      lines.push(`- ${p.summary}${date} — \`${p.rel}\``);
    }
    lines.push("");
  }

  const indexContent = lines.join("\n");
  writeFileSync(join(WIKI_DIR, "index.md"), indexContent, "utf8");
  return indexContent;
}

export interface IngestPlan {
  newPages: Array<{ path: string; title: string; body: string; tags: string[] }>;
  updatedPages: Array<{ path: string; body: string }>;
  contradictions: Array<{ a: string; b: string; claim: string }>;
  crossLinks: Array<{ from: string; to: string; type: string }>;
  skippedCaptures: number;
}

interface IngestState {
  created: string[];
  modified: Array<{ path: string; backup: string }>;
  timestamp: string;
}

const INGEST_STATE_PATH = join(WIKI_DIR, "meta", "last-ingest.json");

export function saveIngestState(plan: IngestPlan): void {
  const created = plan.newPages.map((p) => p.path);
  const modified: Array<{ path: string; backup: string }> = [];
  for (const u of plan.updatedPages) {
    const fullPath = join(WIKI_DIR, u.path);
    if (existsSync(fullPath)) {
      modified.push({ path: u.path, backup: readFileSync(fullPath, "utf8") });
    }
  }
  const state: IngestState = { created, modified, timestamp: new Date().toISOString() };
  mkdirSync(dirname(INGEST_STATE_PATH), { recursive: true });
  writeFileSync(INGEST_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export function revertLastIngest(): boolean {
  if (!existsSync(INGEST_STATE_PATH)) return false;
  const state: IngestState = JSON.parse(readFileSync(INGEST_STATE_PATH, "utf8"));
  for (const p of state.created) {
    const fullPath = join(WIKI_DIR, p);
    try { rmSync(fullPath, { force: true }); } catch {}
  }
  for (const m of state.modified) {
    const fullPath = join(WIKI_DIR, m.path);
    try { writeFileSync(fullPath, m.backup, "utf8"); } catch {}
  }
  return true;
}

function getFolderPages(): Record<string, string[]> {
  const files = walkWikiFiles();
  const groups: Record<string, string[]> = {};
  for (const f of files) {
    const rel = f.replace(WIKI_DIR + "/", "");
    const folder = rel.includes("/") ? rel.substring(0, rel.lastIndexOf("/")) : rel.replace(/\.md$/, "");
    const key = rel.includes("/") ? folder : "_root";
    if (!groups[key]) groups[key] = [];
    groups[key].push(rel);
  }
  return groups;
}

export function linkSiblingPages(): { linked: number; indexed: number } {
  const groups = getFolderPages();
  let linked = 0;
  let indexed = 0;

  for (const [folder, pages] of Object.entries(groups)) {
    if (folder === "_root" || pages.length < 2) continue;

    for (const page of pages) {
      const fullPath = join(WIKI_DIR, page);
      let content = readFileSync(fullPath, "utf8");

      if (/^## Related\s*$/m.test(content)) continue;

      const siblings = pages
        .filter((p) => p !== page)
        .sort((a, b) => {
          const pageName = page.split("/").pop()!.replace(/\.md$/, "");
          const aName = a.split("/").pop()!.replace(/\.md$/, "");
          const bName = b.split("/").pop()!.replace(/\.md$/, "");
          const commonA = pageName.split("-").filter((w) => aName.includes(w)).length;
          const commonB = pageName.split("-").filter((w) => bName.includes(w)).length;
          return commonB - commonA;
        })
        .slice(0, 5)
        .map((p) => {
          const siblingTitle = p.split("/").pop()!.replace(/\.md$/, "").replace(/-/g, " ");
          const linkTarget = p.replace(/\.md$/, "");
          return `- [[${linkTarget}|${siblingTitle}]]`;
        });

      if (!siblings.length) continue;

      content += "\n\n## Related\n\n" + siblings.join("\n") + "\n";
      const tmpPath = fullPath + ".tmp." + randomUUID().slice(0, 8);
      writeFileSync(tmpPath, content, "utf8");
      renameSync(tmpPath, fullPath);
      linked++;
    }

    const indexPage = folder;
    const indexPath = join(WIKI_DIR, `${indexPage}.md`);
    if (!existsSync(indexPath)) {
      const title = indexPage.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const pageLinks = pages
        .sort()
        .map((p) => {
          const pageTitle = p.split("/").pop()!.replace(/\.md$/, "").replace(/-/g, " ");
          const linkTarget = p.replace(/\.md$/, "");
          return `- [[${linkTarget}|${pageTitle}]]`;
        })
        .join("\n");

      const idxContent = serialize(
        {
          type: indexPage,
          source: "ingest-auto",
          confidence: "high",
          tags: [],
          aliases: [title.toLowerCase()],
          created: new Date().toISOString().split("T")[0],
          updated: new Date().toISOString().split("T")[0],
        },
        `# ${title}\n\n${pageLinks}`
      );
      const tmpPath = indexPath + ".tmp." + randomUUID().slice(0, 8);
      mkdirSync(dirname(indexPath), { recursive: true });
      writeFileSync(tmpPath, idxContent, "utf8");
      renameSync(tmpPath, indexPath);
      indexed++;
    }
  }

  if (linked > 0 || indexed > 0) {
    appendLog({ type: "link", title: `${linked} pages linked, ${indexed} indexes created` });
  }

  return { linked, indexed };
}

export function mergeProjectFolders(source: string, target: string): number {
  const sourceDir = join(WIKI_DIR, source);
  const targetDir = join(WIKI_DIR, target);
  if (!existsSync(sourceDir)) return 0;

  mkdirSync(targetDir, { recursive: true });
  let moved = 0;

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const srcPath = join(sourceDir, entry.name);
    const dstPath = join(targetDir, entry.name);
    renameSync(srcPath, dstPath);
    moved++;
  }

  // Only delete source dir if empty (avoids data loss from non-.md files or subdirs)
  try {
    const remaining = readdirSync(sourceDir);
    if (remaining.length === 0) {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  } catch {}

  if (moved > 0) {
    appendLog({ type: "merge", title: `${moved} pages merged from ${source} → ${target}` });
  }

  return moved;
}

const IDENTITY_KEYWORDS: Record<string, string[]> = {
  career: ["career", "role", "company", "worked at", "founder", "co-founder", "director", "manager", "lead", "position", "employment", "job", "clients include"],
  education: ["degree", "university", "college", "certification", "course", "graduated", "bachelor", "master", "phd", "diploma", "studied"],
  awards: ["award", "cyber lion", "cannes", "d&ad", "one show", "clio", "effie", "fwa", "awwwards", "webby", "won", "winner", "recognition", "honored"],
  testimonials: ["testimonial", "recommendation", "endorsement", "review", "client said", "feedback", "reference", "client feedback", "praise"],
  skills: ["skill", "proficient", "expert", "experienced", "technology", "stack", "framework", "language", "tool", "technique"],
  constraints: ["do not", "never", "avoid", "prefer not", "non-negotiable", "rule", "boundary", "policy", "must not"],
};

export function routeIdentityPages(): { career: number; education: number; awards: number; testimonials: number; skills: number; constraints: number } {
  const results = { career: 0, education: 0, awards: 0, testimonials: 0, skills: 0, constraints: 0 };
  const files = walkWikiFiles();

  for (const file of files) {
    const rel = file.replace(WIKI_DIR + "/", "");
    if (rel.startsWith("career/") || rel.startsWith("education/") || rel.startsWith("awards/")
      || rel.startsWith("testimonials/") || rel.startsWith("skills/") || rel.startsWith("constraints/")) continue;
    if (rel.includes("/") && !rel.startsWith("projects/tastemaker/")) continue;
    if (rel === "index.md" || rel === "log.md" || rel === "schema.md") continue;

    try {
      const content = readFileSync(file, "utf8");
      const parsed = parse(content);
      if (parsed.metadata.source === "ingest-manual") continue;
      const lower = parsed.body.toLowerCase();

      for (const [folder, keywords] of Object.entries(IDENTITY_KEYWORDS)) {
        const matches = keywords.filter((k) => lower.includes(k));
        if (matches.length >= 3) {
          const slug = rel.split("/").pop()!.replace(/\.md$/, "");
          const destRel = `${folder}/${slug}.md`;
          const destPath = join(WIKI_DIR, destRel);
          mkdirSync(join(WIKI_DIR, folder), { recursive: true });
          renameSync(file, destPath);
          results[folder as keyof typeof results]++;
          break;
        }
      }
    } catch {}
  }

  if (Object.values(results).some((n) => n > 0)) {
    const moved = Object.entries(results).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(", ");
    appendLog({ type: "route", title: `identity routing: ${moved}` });
  }

  return results;
}
