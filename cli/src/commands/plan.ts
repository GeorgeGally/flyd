import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { RAW_DIR, PLANS_DIR, PROJECT, defaultModel } from "../lib/config.js";
import { serialize } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";
import { search as qmdSearch, updateRaw, embedRaw } from "../lib/qmd.js";
import { buildRawEntries, extractKeywords } from "../lib/retrieval.js";

// A plan has a fixed shape so it can be read back, shown as an artefact, and
// handed to a fresh coding session: outcome, files to touch, approval gates,
// and phases each ending in checkable done_when points. The plan is written as
// a plain markdown file and mirrored into the capture archive, so the existing
// search finds it — no new store, ranking or governance layer.

const PLAN_HEAD = `You are an expert technical planner. Turn the request into a phased implementation plan.

Topic: `;

const PLAN_TAIL = `

Write the plan in exactly this shape, with these exact headings:

## Outcome
One or two sentences: the finished change, in plain terms.

## Files to touch
- path — why

## Approval gates
- what needs George's yes before it happens (landing, sending, anything outward)

## Phase 1 — <short name>
- [ ] step
- [ ] step
**Done when:**
- [ ] a checkable point
- [ ] a checkable point

## Phase 2 — <short name>
- [ ] step
**Done when:**
- [ ] a checkable point

Rules:
- Every phase ends with a **Done when:** list of checkable points — each one a reviewer can confirm, not a vibe.
- Be concrete: name exact files, functions and patterns.
- A plan never starts work by itself: name in Approval gates what needs George's approval, and leave landing to his /land.
- Keep small work to a single phase; break large work into a few ordered phases.`;

/** How many recalled captures the planner reads, and how much of each. */
const MEMORY_LIMIT = 5;
const MEMORY_EXCERPT_CHARS = 600;

export async function runPlan(topic: string, model?: string): Promise<void> {
  const m = model ?? defaultModel();

  const memoryResults = await qmdSearch(topic, "flyd-raw", 10);
  const memories = buildRawEntries(memoryResults, extractKeywords(topic))
    .slice(0, MEMORY_LIMIT)
    .map((entry) => `[memory: ${entry.path}]\n${entry.body.trim().slice(0, MEMORY_EXCERPT_CHARS)}`);
  const project = `\nProject: ${PROJECT.name}\nRepository folder: ${PROJECT.path}\n`;
  const context = memories.length
    ? `\nRelevant memory context:\n${memories.join("\n\n")}\n`
    : "";

  const prompt = PLAN_HEAD + topic + "\n" + project + context + PLAN_TAIL;

  console.log(`planning: "${topic}"\n`);

  const result = await query(prompt, m);

  // Save to plans dir
  mkdirSync(PLANS_DIR, { recursive: true });

  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const created = timestamp.slice(0, 10);
  const filename = `${created}-${slug}-plan.md`;
  const filepath = join(PLANS_DIR, filename);

  const frontmatter = {
    source: "plan",
    type: "plan",
    topic,
    status: "draft",
    project: PROJECT.name,
    repo_path: PROJECT.path,
    created,
    timestamp,
  };

  writeFileSync(filepath, serialize(frontmatter, result), "utf8");

  // Also save as a capture so the existing search finds the plan.
  const rawFilename = timestamp.replace(/[ :]/g, "-") + ".md";
  writeFileSync(join(RAW_DIR, rawFilename), serialize(frontmatter, result), "utf8");

  console.log(result);
  console.log(`\n---\nstored as ${filename}`);

  if (!process.env.VITEST) {
    await updateRaw();
    await embedRaw();
  }
}
