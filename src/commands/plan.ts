import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { RAW_DIR, PLANS_DIR, PROJECT, defaultModel } from "../lib/config.js";
import { serialize } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";
import { search as qmdSearch, updateRaw, embedRaw } from "../lib/qmd.js";

const PLAN_HEAD = `You are an expert technical planner. Create a structured implementation plan.

Topic: `;

const PLAN_TAIL = `

Structure the plan with these sections:

## Goal

## Approach

## Files to touch

## Implementation steps
- [ ] Step 1:
- [ ] Step 2:

## Acceptance criteria
- [ ]
- [ ]

Rules:
- Be concrete and specific. Name exact files, functions, and patterns.
- Keep it actionable — each step should be clear enough to execute.
- If the work is very small (< 1 hour), keep it short (3-5 steps).
- If the work is large, break it into phases.`;

export async function runPlan(topic: string, model?: string): Promise<void> {
  const m = model ?? defaultModel();

  const memoryResults = await qmdSearch(topic, "flyd-raw", 10);
  const contextLines: string[] = [];
  for (const r of memoryResults) {
    contextLines.push(`[memory: ${r.path} (score=${r.score}%)]`);
  }
  const context = contextLines.length
    ? `\nRelevant memory context:\n${contextLines.join("\n")}\n`
    : "";

  const prompt = PLAN_HEAD + topic + "\n" + context + PLAN_TAIL;

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
  const datestamp = timestamp.slice(0, 10);
  const filename = `${datestamp}-${slug}-plan.md`;
  const filepath = join(PLANS_DIR, filename);

  const frontmatter = {
    source: "plan",
    type: "plan",
    topic,
    status: "draft",
    project: PROJECT.name,
    project_path: PROJECT.path,
    timestamp,
  };

  writeFileSync(filepath, serialize(frontmatter, result), "utf8");

  // Also save as capture for searchability
  const rawFilename = timestamp.replace(/[ :]/g, "-") + ".md";
  writeFileSync(join(RAW_DIR, rawFilename), serialize(frontmatter, result), "utf8");

  console.log(result);
  console.log(`\n---\nstored as ${filename}`);

  if (!process.env.VITEST) {
    await updateRaw();
    await embedRaw();
  }
}
