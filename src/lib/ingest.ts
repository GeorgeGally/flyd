import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { CACHE_DIR, RAW_DIR, WIKI_DIR, defaultModel } from "./config.js";
import { parse } from "./frontmatter.js";
import { query } from "./llm.js";
import {
  wikiExists,
  walkWikiFiles,
  writeWikiPage,
  createTopicPage,
  appendLog,
  saveIngestState,
  generateIndex,
  type IngestPlan,
} from "./wiki.js";

interface QueueEntry {
  id: string;
  capture_path: string;
  queued_at: string;
  body?: string;
  topics_matched?: string[];
}

const INGEST_QUEUE_PATH = join(CACHE_DIR, "ingest-queue.json");

function loadQueue(): QueueEntry[] {
  try {
    if (!existsSync(INGEST_QUEUE_PATH)) return [];
    return JSON.parse(readFileSync(INGEST_QUEUE_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveQueue(queue: QueueEntry[]): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(INGEST_QUEUE_PATH, JSON.stringify(queue, null, 2), "utf8");
}

function isTrivial(text: string): boolean {
  const stripped = text.replace(/[^\w\s]/g, " ").trim();
  const words = stripped.split(/\s+/).filter((w) => w.length > 2);
  return words.length < 10 || stripped.length < 100;
}

function extractTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const terms = new Set<string>();
  const wordRe = /\b[a-z]{3,}\b/g;
  let m;
  while ((m = wordRe.exec(lower)) !== null) {
    terms.add(m[0]);
  }
  return [...terms].filter((t) => !["the", "and", "for", "that", "this", "with", "from", "have", "what", "when", "were", "your", "will", "been", "they", "them", "then", "than", "some", "just", "like", "also", "about", "into", "over", "after", "which", "their", "other", "there", "would", "could", "these", "those", "being", "doing", "does", "more", "only", "very", "much", "such", "each", "where"].includes(t));
}

function matchWikiTopics(terms: string[]): string[] {
  if (!wikiExists()) return [];
  const indexContent = readFileSync(join(WIKI_DIR, "index.md"), "utf8").toLowerCase();
  return terms.filter((t) => indexContent.includes(t.toLowerCase()));
}

export function addToQueue(capturePath: string): boolean {
  if (!existsSync(join(RAW_DIR, capturePath))) return false;

  let body = "";
  try {
    const content = readFileSync(join(RAW_DIR, capturePath), "utf8");
    const parsed = parse(content);
    body = parsed.body;
  } catch {
    return false;
  }

  if (isTrivial(body)) return false;

  const terms = extractTerms(body);
  const matched = matchWikiTopics(terms);

  const queue = loadQueue();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  queue.push({ id, capture_path: capturePath, queued_at: new Date().toISOString(), body, topics_matched: matched });
  saveQueue(queue);
  return true;
}

export function getQueueSize(): number {
  return loadQueue().length;
}

export function getQueuedTopics(): Array<{ topic: string; count: number }> {
  const queue = loadQueue();
  if (!wikiExists()) return [];

  const topics = new Map<string, number>();
  const indexPath = join(WIKI_DIR, "index.md");
  let indexContent = "";
  try { indexContent = readFileSync(indexPath, "utf8").toLowerCase(); } catch {}

  for (const entry of queue) {
    const body = entry.body ?? "";
    if (!body) continue;
    const terms = extractTerms(body);
    for (const t of terms) {
      if (!indexContent.includes(t.toLowerCase())) {
        topics.set(t, (topics.get(t) ?? 0) + 1);
      }
    }
  }

  return [...topics.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));
}

export async function runBatchIngest(): Promise<IngestPlan | null> {
  const queue = loadQueue();
  if (!queue.length) return null;
  return runBatchIngestSlice(queue);
}

export async function runBatchIngestSlice(entries: QueueEntry[]): Promise<IngestPlan | null> {
  if (!entries.length) return null;

  if (!wikiExists()) return null;

  const captureBlocks = entries.map((e) => {
    const body = (e.body ?? "").slice(0, 1000);
    return `[capture: ${e.capture_path}]\n${body}`;
  }).join("\n\n---\n\n");

  const indexContent = existsSync(join(WIKI_DIR, "index.md"))
    ? readFileSync(join(WIKI_DIR, "index.md"), "utf8").slice(0, 2000)
    : "";

  const schemaContent = existsSync(join(WIKI_DIR, "schema.md"))
    ? readFileSync(join(WIKI_DIR, "schema.md"), "utf8").slice(0, 1000)
    : "";

  const system = `${schemaContent}\n\nYou maintain a personal wiki at ~/.flyd/wiki/. Follow the conventions in the schema above.`;

  const prompt = `Below is the wiki index and ${entries.length} new captures. Propose a batch plan.

## Wiki Index
${indexContent || "(empty)"}

## New Captures
${captureBlocks}

Analyze the captures and respond with a JSON plan:

{
  "newPages": [
    { "path": "folder/slug.md", "title": "Page Title", "body": "markdown content with [[wiki links]]", "tags": ["tag1", "tag2"] }
  ],
  "updatedPages": [
    { "path": "existing/path.md", "body": "full new markdown content replacing the old page" }
  ],
  "contradictions": [
    { "a": "path/a.md", "b": "path/b.md", "claim": "what they disagree on" }
  ],
  "crossLinks": [
    { "from": "path/a.md", "to": "path/b.md", "type": "related" }
  ]
}

## Folder routing

Route content to the folder that best matches the captures:

| Content type | Folder | Examples |
|---|---|---|
| Flyd tool — commands, internals, architecture, compound-engineering, pipelines | flyd/ | flyd/compound-engineering.md |
| Client work, products, companies — postraction, tastemaker, bridgestone, cowsite, radarboy (the company), news*, workspace*, editor-controller* | projects/{name}/ | projects/postraction/, projects/tastemaker/ |
| Radarboy3000 artist portfolio — creative works, art installations | projects/radarboy3000/ | projects/radarboy3000/twitter-tv.md |
| Standalone projects with 1 page only | projects/ | projects/reaktiv.md |
| Work history — roles, companies, dates, career milestones | career/ | career/radarboy-media-lab.md |
| Education — degrees, certifications, courses | education/ | education/creative-tech-degree.md |
| Awards — recognition, achievements, competition wins | awards/ | awards/cyber-lions-2023.md |
| Testimonials — endorsements, recommendations, client reviews | testimonials/ | testimonials/client-feedback.md |
| Skills — technical and soft skills, proficiencies | skills/ | skills/ruby-on-rails.md |
| Behavioral rules, constraints, non-negotiables | constraints/ | constraints/no-weekend-work.md |
| Individuals — collaborators, clients, radarboy the person (not the company or artist), george gally | people/ | people/george-gally.md |
| General concepts that genuinely don't fit above | topics/ | topics/facts.md |

## Linking rules

- Only cross-link pages within the SAME project or folder.
- NEVER link a flyd tool page to a project page. Flyd is a tool, not part of any project.
- NEVER write "Recent projects include..." or similar across-domain conflation.
- NEVER use #hashtag syntax in body text. Tags go in frontmatter YAML only.
- Only add [[wiki links]] when the source captures genuinely connect two pages.
- Each page should link to at least one sibling page if it shares a project prefix.

## Rules
- Max 5 new pages and 3 updates per batch.
- Check career/, education/, awards/, testimonials/, skills/ for match first — many captures contain identity data that should be routed there.
- Only create pages for genuinely new knowledge. Skip noise and trivial chat.
- If a capture belongs to an existing page, update it instead of creating a new one.
- If no meaningful knowledge in captures, return empty arrays.

Respond ONLY with the JSON object, no other text.`;

  try {
    const response = await query(prompt, defaultModel(), system);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const plan: IngestPlan = JSON.parse(jsonMatch[0]);
    plan.skippedCaptures = entries.length;

    return plan;
  } catch {
    return null;
  }
}

export async function executeIngestPlan(plan: IngestPlan): Promise<void> {
  for (const p of plan.newPages) {
    const content = createTopicPage({
      slug: p.path.replace(/^topics\//, "").replace(/\.md$/, ""),
      title: p.title,
      body: p.body,
      tags: p.tags,
      source: "ingest-auto",
      confidence: "high",
    });
    writeWikiPage(p.path, content);
  }

  for (const u of plan.updatedPages) {
    writeWikiPage(u.path, u.body);
  }

  saveIngestState(plan);

  const affected = [
    ...plan.newPages.map((p) => p.path),
    ...plan.updatedPages.map((p) => p.path),
  ];

  appendLog({
    type: "ingest",
    title: `${plan.newPages.length} new, ${plan.updatedPages.length} updated`,
    body: plan.contradictions.length
      ? `contradictions: ${plan.contradictions.map((c) => `${c.a} vs ${c.b}`).join(", ")}`
      : undefined,
    affected,
  });

  await generateIndex();
}

export function clearQueue(): void {
  saveQueue([]);
}

export function dequeueSlice(n: number): QueueEntry[] {
  const queue = loadQueue();
  const slice = queue.slice(0, n);
  saveQueue(queue.slice(n));
  return slice;
}

export function populateQueueFromRaw(limit = 50): number {
  if (!existsSync(RAW_DIR)) return 0;
  const files = readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, limit);

  let added = 0;
  for (const file of files) {
    if (addToQueue(file)) added++;
  }
  return added;
}
